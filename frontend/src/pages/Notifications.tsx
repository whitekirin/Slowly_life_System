import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Tabs,
  Table,
  Tag,
  Space,
  Button,
  DatePicker,
  Select,
  Input,
  Card,
  Typography,
  Badge,
  message,
  Alert,
  Modal,
  InputNumber,
} from "antd";
import {
  SearchOutlined,
  ExportOutlined,
  BellOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  ShoppingCartOutlined,
} from "@ant-design/icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import * as XLSX from "xlsx";
import type { TabsProps, TableColumnsType } from "antd";
import { closeActiveNotice, enqueueNotice } from "./notificationsQueue";
import type { NoticeQueueState } from "./notificationsQueue";
import {
  createPurchaseOrder,
  getSuppliers,
  getUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../api";
import api from "../api";
import { isLiffMode } from "../liffSession";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

// --- Interfaces ---
interface SalesOrder {
  id: number;
  order_number: string;
  customer_id: string;
  status: string;
  shipping_date: string | null;
  estimated_arrival: string | null;
  items?: { id: number }[];
}

interface StockAlert {
  id: number;
  name: string;
  sku: string;
  stock_quantity: number;
  safety_stock: number;
  suggested_replenishment: number;
  cost_price: number;
  is_read?: boolean;
}

interface Product {
  id: number;
  name: string;
  sku: string;
  stock_quantity: number;
  safety_stock: number;
  cost_price: number;
}

interface Supplier {
  id: number;
  name: string;
}

interface ReplenishItem {
  product_id: number;
  name: string;
  sku: string;
  quantity: number;
  unit_price: number;
}

interface SystemNotification {
  id: string;
  title: string;
  content: string;
  is_read: boolean;
  created_at: string;
  type: "stock_alert" | "shipping_update" | "system" | "stock_take";
  // 後端存的站內通知才有；低庫存警示是前端即時算出來的，沒有這個欄位
  userNotificationId?: number;
}

interface UserNotification {
  id: number;
  title: string;
  content: string;
  notification_type: string;
  link?: string | null;
  is_read: boolean;
  created_at: string;
}

interface ShippingFilters {
  status: string;
  search: string;
  dateRange: [Dayjs, Dayjs] | null;
}

interface QueueNotice {
  id: string;
  title: string;
  content: string;
  durationMs: number;
}

const createNotice = (
  title: string,
  content: string,
  durationMs = 3000,
): QueueNotice => ({
  id: `${Date.now()}-${Math.random()}`,
  title,
  content,
  durationMs,
});

interface NotificationsProps {
  initialTab?: string;
}

const Notifications: React.FC<NotificationsProps> = ({
  initialTab = "shipping",
}) => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  const [activeTab, setActiveTab] = useState<string>(initialTab);
  const [shippingFilters, setShippingFilters] = useState<ShippingFilters>({
    status: "",
    search: "",
    dateRange: null,
  });
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [queueState, setQueueState] = useState<NoticeQueueState>({
    active: null,
    queue: [],
  });
  const timerRef = useRef<number | null>(null);
  const notifiedStockCountRef = useRef(0);

  const pushNotice = (title: string, content: string, durationMs = 3000) => {
    const notice = createNotice(title, content, durationMs);
    setQueueState((prev) => enqueueNotice(prev, notice));
  };

  const closeNotice = () => {
    setQueueState((prev) => closeActiveNotice(prev));
  };

  // --- Queries ---

  const shippingQuery = useQuery<SalesOrder[]>({
    queryKey: ["notifications", "shipping", shippingFilters],
    queryFn: async () => {
      // 走 api.ts 的 axios instance（相對路徑＋自動帶 token），寫死 localhost 在正式環境打不到
      const res = await api.get<SalesOrder[]>("/sales_orders/");
      return res.data;
    },
  });
  const shippingRaw = useMemo<SalesOrder[]>(
    () => shippingQuery.data ?? [],
    [shippingQuery.data],
  );
  const isShippingLoading = shippingQuery.isLoading;

  const stockQuery = useQuery<StockAlert[]>({
    queryKey: ["notifications", "stock-alerts"],
    queryFn: async () => {
      const res = await api.get<Product[]>("/products/");
      return res.data
        .filter((product) => product.stock_quantity <= product.safety_stock)
        .map((product) => {
          const safeStock = product.safety_stock > 0 ? product.safety_stock : 5;
          const target = Math.max(safeStock * 2, 10);
          return {
            id: product.id,
            name: product.name,
            sku: product.sku,
            stock_quantity: product.stock_quantity,
            safety_stock: product.safety_stock,
            suggested_replenishment: Math.max(
              0,
              target - product.stock_quantity,
            ),
            cost_price: product.cost_price,
          };
        });
    },
  });
  const stockAlerts = useMemo<StockAlert[]>(
    () => stockQuery.data ?? [],
    [stockQuery.data],
  );
  const isStockLoading = stockQuery.isLoading;

  const queryClient = useQueryClient();
  const suppliersQuery = useQuery<Supplier[]>({
    queryKey: ["suppliers"],
    queryFn: () => getSuppliers(),
  });

  const [selectedStockKeys, setSelectedStockKeys] = useState<React.Key[]>([]);
  const [isReplenishModalOpen, setIsReplenishModalOpen] = useState(false);
  const [replenishSupplier, setReplenishSupplier] = useState<string | undefined>();
  const [replenishItems, setReplenishItems] = useState<ReplenishItem[]>([]);

  const createPoMutation = useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: (data) => {
      message.success(`已建立採購單草稿 (${data.order_number})，請至「採購單」頁面確認`);
      queryClient.invalidateQueries({ queryKey: ["purchase_orders"] });
      setIsReplenishModalOpen(false);
      setSelectedStockKeys([]);
    },
    onError: (error: any) => {
      message.error(`建立採購單失敗: ${error.response?.data?.detail || error.message}`);
    },
  });

  const handleOpenReplenish = () => {
    const items = stockAlerts
      .filter((a) => selectedStockKeys.includes(a.id))
      .map((a) => ({
        product_id: a.id,
        name: a.name,
        sku: a.sku,
        quantity: a.suggested_replenishment,
        unit_price: a.cost_price ?? 0,
      }));
    setReplenishItems(items);
    setReplenishSupplier(undefined);
    setIsReplenishModalOpen(true);
  };

  const handleReplenishItemChange = (
    productId: number,
    field: "quantity" | "unit_price",
    value: number | null,
  ) => {
    setReplenishItems((prev) =>
      prev.map((item) =>
        item.product_id === productId ? { ...item, [field]: value ?? 0 } : item,
      ),
    );
  };

  const handleSubmitReplenish = () => {
    if (!replenishSupplier) {
      message.warning("請選擇供應商");
      return;
    }
    if (replenishItems.some((i) => i.quantity <= 0)) {
      message.warning("補貨數量需大於 0");
      return;
    }
    createPoMutation.mutate({
      supplier_name: replenishSupplier,
      status: "draft",
      items: replenishItems.map((i) => ({
        product_id: i.product_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
      })),
    });
  };

  const shippingData = useMemo(() => {
    return shippingRaw
      .filter((item) => {
        const itemStatus = (item.status ?? "").toLowerCase();
        if (
          shippingFilters.status &&
          itemStatus !== shippingFilters.status.toLowerCase()
        ) {
          return false;
        }
        if (shippingFilters.search) {
          const term = shippingFilters.search.toLowerCase();
          const orderNo = (item.order_number ?? "").toLowerCase();
          const customer = (item.customer_id ?? "").toLowerCase();
          if (!orderNo.includes(term) && !customer.includes(term)) {
            return false;
          }
        }
        if (shippingFilters.dateRange && item.shipping_date) {
          const [start, end] = shippingFilters.dateRange;
          const shippedAt = dayjs(item.shipping_date);
          if (
            shippedAt.isBefore(start.startOf("day")) ||
            shippedAt.isAfter(end.endOf("day"))
          ) {
            return false;
          }
        }
        return true;
      })
      .map((item) => ({
        ...item,
        items_count: item.items?.length ?? 0,
      }));
  }, [shippingRaw, shippingFilters]);

  const userNotificationsQuery = useQuery<UserNotification[]>({
    queryKey: ["notifications", "user"],
    queryFn: getUserNotifications,
  });

  const markReadMutation = useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", "user"] });
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
    },
  });

  const systemNotifications = useMemo<SystemNotification[]>(() => {
    const stored: SystemNotification[] = (userNotificationsQuery.data ?? []).map((n) => ({
      id: `user-${n.id}`,
      title: n.title,
      content: n.content,
      is_read: n.is_read,
      created_at: n.created_at,
      type: n.notification_type === "stock_take" ? "stock_take" : "system",
      userNotificationId: n.id,
    }));
    const alerts: SystemNotification[] = stockAlerts.map((item) => ({
      id: `stock-${item.id}`,
      title: `庫存警示：${item.name}`,
      content: `SKU ${item.sku} 目前庫存 ${item.stock_quantity}，低於安全庫存 ${item.safety_stock}`,
      is_read: readNotificationIds.includes(`stock-${item.id}`),
      created_at: new Date().toISOString(),
      type: "stock_alert",
    }));
    return [...stored, ...alerts];
  }, [userNotificationsQuery.data, stockAlerts, readNotificationIds]);

  useEffect(() => {
    const currentCount = stockAlerts.length;
    if (currentCount > 0 && currentCount !== notifiedStockCountRef.current) {
      const timeoutId = window.setTimeout(() => {
        pushNotice("庫存警示", `目前共有 ${currentCount} 筆低庫存通知`);
      }, 0);
      notifiedStockCountRef.current = currentCount;
      return () => window.clearTimeout(timeoutId);
    }
    notifiedStockCountRef.current = currentCount;
    return undefined;
  }, [stockAlerts.length]);

  useEffect(() => {
    if (!queueState.active) {
      return;
    }
    timerRef.current = window.setTimeout(() => {
      closeNotice();
    }, queueState.active.durationMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, [queueState.active]);

  // --- Columns ---

  const shippingColumns: TableColumnsType<
    SalesOrder & { items_count: number }
  > = [
    {
      title: "訂單編號 (Order No)",
      dataIndex: "order_number",
      key: "order_number",
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: "客戶 (Customer)",
      dataIndex: "customer_id",
      key: "customer_id",
    },
    {
      title: "出貨日期 (Shipped Date)",
      dataIndex: "shipping_date",
      key: "shipping_date",
      render: (date: string) =>
        date ? dayjs(date).format("YYYY-MM-DD HH:mm") : "-",
      sorter: (a: SalesOrder, b: SalesOrder) =>
        dayjs(a.shipping_date).unix() - dayjs(b.shipping_date).unix(),
    },
    {
      title: "預計到貨 (Est. Arrival)",
      dataIndex: "estimated_arrival",
      key: "estimated_arrival",
      render: (date: string) =>
        date ? (
          dayjs(date).format("YYYY-MM-DD")
        ) : (
          <Text type="secondary">Pending</Text>
        ),
    },
    {
      title: "物流狀態 (Status)",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        let color = "default";
        let icon = <ClockCircleOutlined />;
        if (status === "shipped") {
          color = "blue";
          icon = <ExclamationCircleOutlined />;
        }
        if (status === "completed") {
          color = "green";
          icon = <CheckCircleOutlined />;
        }
        return (
          <Tag icon={icon} color={color}>
            {status.toUpperCase()}
          </Tag>
        );
      },
      filters: [
        { text: "Shipped", value: "shipped" },
        { text: "Completed", value: "completed" },
      ],
      onFilter: (value, record) => record.status === String(value),
    },
  ];

  const stockColumns: TableColumnsType<StockAlert> = [
    {
      title: "商品名稱 (Product Name)",
      dataIndex: "name",
      key: "name",
      render: (text: string) => <Text strong>{text}</Text>,
    },
    {
      title: "SKU",
      dataIndex: "sku",
      key: "sku",
    },
    {
      title: "目前庫存 (Current Stock)",
      dataIndex: "stock_quantity",
      key: "stock_quantity",
      render: (val: number) => (
        <Text type="danger" strong>
          {val}
        </Text>
      ),
      sorter: (a: StockAlert, b: StockAlert) =>
        a.stock_quantity - b.stock_quantity,
    },
    {
      title: "安全庫存 (Safety Stock)",
      dataIndex: "safety_stock",
      key: "safety_stock",
    },
    {
      title: "建議補貨 (Suggested)",
      dataIndex: "suggested_replenishment",
      key: "suggested_replenishment",
      render: (val: number) => <Tag color="orange">+{val}</Tag>,
    },
    {
      title: "狀態",
      key: "status",
      render: () => <Tag color="red">Low Stock</Tag>,
    },
  ];

  // --- Handlers ---

  const handleExport = () => {
    if (!stockAlerts) return;
    if (stockAlerts.length === 0) {
      message.warning("目前沒有可匯出的低庫存資料");
      return;
    }
    const ws = XLSX.utils.json_to_sheet(stockAlerts);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "StockAlerts");
    XLSX.writeFile(wb, `Stock_Alerts_${dayjs().format("YYYYMMDD")}.xlsx`);
    message.success("Report exported successfully");
    pushNotice("匯出完成", "低庫存報表已完成匯出");
  };

  const handleMarkAllRead = async () => {
    setReadNotificationIds(systemNotifications.map((item) => item.id));
    await markAllNotificationsRead();
    queryClient.invalidateQueries({ queryKey: ["notifications", "user"] });
    queryClient.invalidateQueries({ queryKey: ["notifications", "unread"] });
    message.success("All notifications marked as read");
    pushNotice("通知更新", "已全部標示為已讀");
  };

  const unreadCount = systemNotifications.filter(
    (item) => !item.is_read,
  ).length;

  const items: TabsProps["items"] = [
    {
      key: "shipping",
      label: (
        <span>
          <ExportOutlined />
          出貨通知 (Shipping)
        </span>
      ),
      children: (
        <Space orientation="vertical" style={{ width: "100%" }} size="large">
          <Card>
            <Space wrap>
              <Input
                placeholder="Search Order No / Customer"
                prefix={<SearchOutlined />}
                onChange={(e) =>
                  setShippingFilters({
                    ...shippingFilters,
                    search: e.target.value,
                  })
                }
                style={{ width: 200 }}
              />
              <Select
                placeholder="Status"
                allowClear
                onChange={(val) =>
                  setShippingFilters({ ...shippingFilters, status: val ?? "" })
                }
                style={{ width: 150 }}
              >
                <Option value="shipped">Shipped</Option>
                <Option value="completed">Completed</Option>
              </Select>
              <RangePicker
                onChange={(dates) =>
                  setShippingFilters({
                    ...shippingFilters,
                    dateRange:
                      dates && dates[0] && dates[1]
                        ? [dates[0], dates[1]]
                        : null,
                  })
                }
              />
            </Space>
          </Card>

          <Table
            columns={shippingColumns}
            dataSource={shippingData}
            rowKey="id"
            loading={isShippingLoading}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      ),
    },
    {
      key: "stock",
      label: (
        <span>
          <Badge count={stockAlerts.length} offset={[10, 0]} size="small">
            <ExclamationCircleOutlined />
            庫存警示 (Stock Alerts)
          </Badge>
        </span>
      ),
      children: (
        <Space orientation="vertical" style={{ width: "100%" }} size="large">
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Title level={4} style={{ margin: 0 }}>
                低庫存商品列表 (Low Stock Items)
              </Title>
              <Space>
                {/* 轉採購單也是建立採購單的入口，LINE 裡用「填寫進貨單」 */}
                {!fromLine && (
                  <Button
                    icon={<ShoppingCartOutlined />}
                    disabled={selectedStockKeys.length === 0}
                    onClick={handleOpenReplenish}
                  >
                    轉採購單 ({selectedStockKeys.length})
                  </Button>
                )}
                {!fromLine && (
                  <Button
                    type="primary"
                    icon={<ExportOutlined />}
                    onClick={handleExport}
                  >
                    匯出報表 (Export)
                  </Button>
                )}
              </Space>
            </div>
          </Card>

          <Table
            columns={stockColumns}
            dataSource={stockAlerts}
            rowKey="id"
            // 勾選只是給「轉採購單」用的，LINE 裡沒有這個按鈕就不顯示勾選框
            rowSelection={fromLine ? undefined : {
              selectedRowKeys: selectedStockKeys,
              onChange: setSelectedStockKeys,
            }}
            loading={isStockLoading}
            pagination={{ pageSize: 10 }}
          />
        </Space>
      ),
    },
    {
      key: "system",
      label: (
        <span>
          <BellOutlined />
          系統通知 (System)
        </span>
      ),
      children: (
        <Space orientation="vertical" style={{ width: "100%" }} size="large">
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <Title level={4}>所有通知</Title>
              <Space>
                <Button onClick={handleMarkAllRead}>全部標示為已讀</Button>
                <Button
                  onClick={() =>
                    pushNotice("測試通知", "已加入一則測試通知", 2500)
                  }
                >
                  新增測試通知
                </Button>
              </Space>
            </div>
          </Card>
          <Table
            dataSource={systemNotifications}
            rowKey="id"
            columns={[
              {
                title: "標題",
                dataIndex: "title",
                key: "title",
                render: (text: string, row: SystemNotification) =>
                  row.is_read ? text : <Text strong>{text}</Text>,
              },
              {
                title: "內容",
                dataIndex: "content",
                key: "content",
                render: (text: string) => (
                  <span style={{ whiteSpace: "pre-line" }}>{text}</span>
                ),
              },
              {
                title: "時間",
                dataIndex: "created_at",
                key: "time",
                render: (time: string) =>
                  dayjs(time).format("YYYY-MM-DD HH:mm"),
              },
              {
                title: "狀態",
                dataIndex: "is_read",
                key: "status",
                render: (read: boolean, row: SystemNotification) =>
                  read ? (
                    <Tag>Read</Tag>
                  ) : (
                    <Space>
                      <Tag color="blue">Unread</Tag>
                      <Button
                        size="small"
                        type="link"
                        onClick={() =>
                          row.userNotificationId !== undefined
                            ? markReadMutation.mutate(row.userNotificationId)
                            : setReadNotificationIds((prev) => [...prev, row.id])
                        }
                      >
                        標示已讀
                      </Button>
                    </Space>
                  ),
              },
            ]}
          />
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: "0 24px" }}>
      <Title level={2}>通知中心</Title>
      {queueState.active ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title={queueState.active.title}
          description={queueState.active.content}
          action={
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={closeNotice}
              aria-label="close-notice"
            />
          }
        />
      ) : null}
      <Space style={{ marginBottom: 12 }}>
        <Badge count={unreadCount}>
          <Tag color="processing">未讀系統通知</Tag>
        </Badge>
      </Space>
      <Tabs activeKey={activeTab} items={items} onChange={setActiveTab} />

      <Modal
        title="低庫存補貨 → 建立採購單草稿"
        open={isReplenishModalOpen}
        onOk={handleSubmitReplenish}
        onCancel={() => setIsReplenishModalOpen(false)}
        confirmLoading={createPoMutation.isPending}
        okText="建立採購單"
        width={720}
      >
        <Space orientation="vertical" style={{ width: "100%" }} size="middle">
          <div>
            <Text strong>供應商 (Supplier)</Text>
            <Select
              style={{ width: "100%", marginTop: 8 }}
              placeholder="請選擇供應商"
              value={replenishSupplier}
              onChange={setReplenishSupplier}
              showSearch
              optionFilterProp="children"
            >
              {suppliersQuery.data?.map((s) => (
                <Option key={s.id} value={s.name}>
                  {s.name}
                </Option>
              ))}
            </Select>
          </div>
          <Table
            size="small"
            rowKey="product_id"
            dataSource={replenishItems}
            pagination={false}
            columns={[
              {
                title: "商品",
                dataIndex: "name",
                key: "name",
                render: (text: string, record: ReplenishItem) => (
                  <span>
                    {text} <Text type="secondary">({record.sku})</Text>
                  </span>
                ),
              },
              {
                title: "補貨數量",
                dataIndex: "quantity",
                key: "quantity",
                width: 140,
                render: (val: number, record: ReplenishItem) => (
                  <InputNumber
                    min={1}
                    value={val}
                    onChange={(v) =>
                      handleReplenishItemChange(record.product_id, "quantity", v)
                    }
                  />
                ),
              },
              {
                title: "預估單價",
                dataIndex: "unit_price",
                key: "unit_price",
                width: 140,
                render: (val: number, record: ReplenishItem) => (
                  <InputNumber
                    min={0}
                    value={val}
                    onChange={(v) =>
                      handleReplenishItemChange(record.product_id, "unit_price", v)
                    }
                  />
                ),
              },
            ]}
          />
        </Space>
      </Modal>
    </div>
  );
};

export default Notifications;
