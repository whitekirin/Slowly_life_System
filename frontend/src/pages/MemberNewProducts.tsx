import React, { useMemo, useState } from 'react';
import {
  Alert,
  Breadcrumb,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { TableProps } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import dayjs, { Dayjs } from 'dayjs';
import * as XLSX from 'xlsx';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import {
  exportAdminNewProducts,
  getAdminNewProductBatches,
  getAdminNewProductsList,
  getAdminNewProductsOverview,
} from '../api';
import { isLiffMode } from '../liffSession';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;

type SortBy = 'first_published_at' | 'sales_volume' | 'category_name';
type SortOrder = 'asc' | 'desc';
type Scope = 'all' | 'current_month';

interface AdminNewProductItem {
  product_id: number;
  product_sku: string;
  product_name: string;
  category_name: string;
  sales_price: number;
  stock_quantity: number;
  stock_status: string;
  batch_id: number;
  batch_ids: number[];
  first_published_at: string;
  last_published_at: string;
  sales_volume: number;
  purchase_url?: string | null;
}

interface AdminPublishedBatchItem {
  product_id: number;
  product_sku: string;
  product_name: string;
  category_name: string;
  quantity: number;
}

interface AdminPublishedBatch {
  batch_id: number;
  published_at: string;
  created_at: string;
  created_by_name: string;
  product_count: number;
  total_quantity: number;
  items: AdminPublishedBatchItem[];
}

interface AdminNewProductCategoryBreakdown {
  category_name: string;
  product_count: number;
}

interface AdminNewProductMonthlyTrend {
  month: string;
  product_count: number;
  sales_volume: number;
}

interface AdminNewProductSalesRanking {
  product_name: string;
  sales_volume: number;
}

interface AdminNewProductOverviewResponse {
  current_month_label: string;
  total_online_products: number;
  current_month_total: number;
  total_sales_volume: number;
  total_in_stock_products: number;
  average_sales_volume: number;
  category_options: string[];
  category_breakdown: AdminNewProductCategoryBreakdown[];
  monthly_launch_trend: AdminNewProductMonthlyTrend[];
  top_selling_products: AdminNewProductSalesRanking[];
}

interface AdminNewProductListResponse {
  scope: Scope;
  current_month_label: string;
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  items: AdminNewProductItem[];
}

const CHART_COLORS = ['#8B6545', '#4F6B58', '#B07F45', '#8E8171', '#A07A57', '#7D9384'];

const buildExportFileName = (scope: Scope) =>
  `${scope === 'current_month' ? '本月上線新品' : '累計上線新品'}_${dayjs().format('YYYYMMDDHHmmss')}.xlsx`;

const MemberNewProducts: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [minSales, setMinSales] = useState<number | null>(null);
  const [maxSales, setMaxSales] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<number | undefined>(undefined);
  const [sortBy, setSortBy] = useState<SortBy>('first_published_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [currentMonthPage, setCurrentMonthPage] = useState(1);
  const [currentMonthPageSize, setCurrentMonthPageSize] = useState(10);
  const [allPage, setAllPage] = useState(1);
  const [allPageSize, setAllPageSize] = useState(10);

  const queryFilters = useMemo(
    () => ({
      start_date: dateRange?.[0]?.format('YYYY-MM-DD'),
      end_date: dateRange?.[1]?.format('YYYY-MM-DD'),
      category,
      min_sales: minSales ?? undefined,
      max_sales: maxSales ?? undefined,
      sort_by: sortBy,
      sort_order: sortOrder,
      batch_id: batchId,
    }),
    [batchId, category, dateRange, maxSales, minSales, sortBy, sortOrder],
  );

  const overviewQuery = useQuery<AdminNewProductOverviewResponse>({
    queryKey: ['admin_new_products', 'overview', queryFilters],
    queryFn: () => getAdminNewProductsOverview(queryFilters),
  });

  const currentMonthListQuery = useQuery<AdminNewProductListResponse>({
    queryKey: ['admin_new_products', 'list', 'current_month', queryFilters, currentMonthPage, currentMonthPageSize],
    queryFn: () =>
      getAdminNewProductsList({
        scope: 'current_month',
        page: currentMonthPage,
        page_size: currentMonthPageSize,
        ...queryFilters,
      }),
  });

  const allListQuery = useQuery<AdminNewProductListResponse>({
    queryKey: ['admin_new_products', 'list', 'all', queryFilters, allPage, allPageSize],
    queryFn: () =>
      getAdminNewProductsList({
        scope: 'all',
        page: allPage,
        page_size: allPageSize,
        ...queryFilters,
      }),
  });

  const batchesQuery = useQuery<AdminPublishedBatch[]>({
    queryKey: ['admin_new_products', 'batches'],
    queryFn: getAdminNewProductBatches,
  });

  const selectBatch = (value: number | undefined) => {
    setBatchId(value);
    setCurrentMonthPage(1);
    setAllPage(1);
  };

  const tableColumns: TableProps<AdminNewProductItem>['columns'] = [
    {
      title: '商品編號',
      dataIndex: 'product_sku',
      key: 'product_sku',
      width: 150,
    },
    {
      title: '商品名稱',
      dataIndex: 'product_name',
      key: 'product_name',
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '分類',
      dataIndex: 'category_name',
      key: 'category_name',
      width: 140,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '上架批次',
      key: 'batch_ids',
      width: 140,
      render: (_: unknown, record: AdminNewProductItem) => (
        <Space size={[4, 4]} wrap>
          {(record.batch_ids?.length ? record.batch_ids : [record.batch_id]).map((id) => (
            <Tag
              key={id}
              color={id === batchId ? 'purple' : 'geekblue'}
              style={{ cursor: 'pointer' }}
              onClick={() => selectBatch(id)}
            >
              #{id}
            </Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '首次上線時間',
      dataIndex: 'first_published_at',
      key: 'first_published_at',
      width: 180,
      render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
    },
    {
      title: '累計銷量',
      dataIndex: 'sales_volume',
      key: 'sales_volume',
      width: 120,
      render: (value: number) => `${value} 件`,
    },
    {
      title: '庫存狀態',
      key: 'stock_status',
      width: 150,
      render: (_: unknown, record: AdminNewProductItem) => (
        <Space direction="vertical" size={2}>
          <Tag color={record.stock_quantity > 0 ? (record.stock_quantity <= 10 ? 'gold' : 'green') : 'default'}>
            {record.stock_status}
          </Tag>
          <Text type="secondary">庫存 {record.stock_quantity}</Text>
        </Space>
      ),
    },
    {
      title: '售價',
      dataIndex: 'sales_price',
      key: 'sales_price',
      width: 120,
      render: (value: number) => <Text style={{ color: '#B25B4C', fontWeight: 700 }}>${value.toLocaleString()}</Text>,
    },
  ];

  const handleResetFilters = () => {
    setDateRange(null);
    setCategory(undefined);
    setMinSales(null);
    setMaxSales(null);
    setBatchId(undefined);
    setSortBy('first_published_at');
    setSortOrder('desc');
    setCurrentMonthPage(1);
    setCurrentMonthPageSize(10);
    setAllPage(1);
    setAllPageSize(10);
  };

  const handleExport = async (scope: Scope) => {
    try {
      const result = await exportAdminNewProducts({ scope, ...queryFilters });
      if (!result.items || result.items.length === 0) {
        message.warning('目前沒有符合條件的資料可匯出。');
        return;
      }

      const rows = result.items.map((item: AdminNewProductItem) => ({
        商品編號: item.product_sku,
        商品名稱: item.product_name,
        分類: item.category_name,
        首次上線時間: dayjs(item.first_published_at).format('YYYY-MM-DD HH:mm:ss'),
        最後上線時間: dayjs(item.last_published_at).format('YYYY-MM-DD HH:mm:ss'),
        累計銷量: item.sales_volume,
        庫存數量: item.stock_quantity,
        庫存狀態: item.stock_status,
        售價: item.sales_price,
        批次編號: (item.batch_ids?.length ? item.batch_ids : [item.batch_id]).join(', '),
        購買連結: item.purchase_url || '',
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, scope === 'current_month' ? 'CurrentMonth' : 'AllProducts');
      XLSX.writeFile(wb, buildExportFileName(scope));
      message.success('匯出成功。');
    } catch (error: any) {
      message.error(`匯出失敗：${error.response?.data?.detail || error.message}`);
    }
  };

  const overview = overviewQuery.data;
  const isInitialLoading =
    overviewQuery.isLoading || currentMonthListQuery.isLoading || allListQuery.isLoading;
  const isError = overviewQuery.isError || currentMonthListQuery.isError || allListQuery.isError;

  return (
    <div>
      <Breadcrumb style={{ margin: '0 0 16px 0' }}>
        <Breadcrumb.Item><Link to="/">首頁</Link></Breadcrumb.Item>
        <Breadcrumb.Item>會員管理 (Members)</Breadcrumb.Item>
        <Breadcrumb.Item>新品總覽管理</Breadcrumb.Item>
      </Breadcrumb>

      <div style={{ display: 'grid', gap: 16 }}>
        <Card
          title="累計上線新品總覽面板"
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={() => {
                overviewQuery.refetch();
                batchesQuery.refetch();
                currentMonthListQuery.refetch();
                allListQuery.refetch();
              }}>
                重新整理
              </Button>
              {!fromLine && (
                <Button icon={<DownloadOutlined />} onClick={() => handleExport('all')}>
                  匯出累計清單
                </Button>
              )}
            </Space>
          }
        >
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <div>
              <Title level={4} style={{ marginBottom: 4 }}>主系統會員管理新品模組</Title>
              <Text type="secondary">
                提供累計上線新品完整清單、本月上線新品清單與累計總覽分析；所有功能僅限主系統管理端使用。
              </Text>
            </div>

            <Row gutter={[12, 12]}>
              <Col xs={24} md={12} xl={4}>
                <RangePicker
                  style={{ width: '100%' }}
                  value={dateRange}
                  onChange={(value) => {
                    setDateRange(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={24} md={12} xl={4}>
                <Select
                  allowClear
                  style={{ width: '100%' }}
                  placeholder="商品分類"
                  value={category}
                  options={(overview?.category_options || []).map((item) => ({ label: item, value: item }))}
                  onChange={(value) => {
                    setCategory(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={12} md={6} xl={3}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  placeholder="最低銷量"
                  value={minSales}
                  onChange={(value) => {
                    setMinSales(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={12} md={6} xl={3}>
                <InputNumber
                  style={{ width: '100%' }}
                  min={0}
                  placeholder="最高銷量"
                  value={maxSales}
                  onChange={(value) => {
                    setMaxSales(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={24} md={12} xl={4}>
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: '100%' }}
                  placeholder="上架批次"
                  value={batchId}
                  options={(batchesQuery.data || []).map((batch) => ({
                    label: `#${batch.batch_id}（${dayjs(batch.published_at).format('YYYY-MM-DD')}，${batch.product_count} 項）`,
                    value: batch.batch_id,
                  }))}
                  onChange={(value?: number) => selectBatch(value)}
                />
              </Col>
              <Col xs={12} md={6} xl={3}>
                <Select
                  style={{ width: '100%' }}
                  value={sortBy}
                  options={[
                    { label: '依上線時間', value: 'first_published_at' },
                    { label: '依累計銷量', value: 'sales_volume' },
                    { label: '依商品分類', value: 'category_name' },
                  ]}
                  onChange={(value: SortBy) => {
                    setSortBy(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={12} md={6} xl={3}>
                <Select
                  style={{ width: '100%' }}
                  value={sortOrder}
                  options={[
                    { label: '由高到低 / 新到舊', value: 'desc' },
                    { label: '由低到高 / 舊到新', value: 'asc' },
                  ]}
                  onChange={(value: SortOrder) => {
                    setSortOrder(value);
                    setCurrentMonthPage(1);
                    setAllPage(1);
                  }}
                />
              </Col>
              <Col xs={24} md={12} xl={24} style={{ textAlign: 'right' }}>
                <Button onClick={handleResetFilters}>清除篩選</Button>
              </Col>
            </Row>

            {isError && (
              <Alert
                type="error"
                showIcon
                message="資料載入失敗"
                description="請稍後再試，或確認目前帳號是否具備會員管理權限。"
              />
            )}

            {!isError && isInitialLoading && (
              <Alert type="info" showIcon message="資料載入中..." />
            )}

            {!isError && overview && (
              <>
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={12} xl={6}>
                    <Card bordered={false}>
                      <Statistic title="累計上線新品總數" value={overview.total_online_products} suffix="項" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card bordered={false}>
                      <Statistic title={`${overview.current_month_label} 上線新品`} value={overview.current_month_total} suffix="項" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card bordered={false}>
                      <Statistic title="累計銷量表現" value={overview.total_sales_volume} suffix="件" />
                    </Card>
                  </Col>
                  <Col xs={24} md={12} xl={6}>
                    <Card bordered={false}>
                      <Statistic title="平均單品銷量" value={overview.average_sales_volume} precision={2} suffix="件" />
                    </Card>
                  </Col>
                </Row>

                <Row gutter={[16, 16]}>
                  <Col xs={24} xl={8}>
                    <Card title="分類佔比">
                      {overview.category_breakdown.length === 0 ? (
                        <Empty description="目前沒有可視化資料" />
                      ) : (
                        <div style={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer>
                            <PieChart>
                              <Pie
                                data={overview.category_breakdown}
                                dataKey="product_count"
                                nameKey="category_name"
                                outerRadius={90}
                                label
                              >
                                {overview.category_breakdown.map((entry, index) => (
                                  <Cell key={entry.category_name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                ))}
                              </Pie>
                              <Tooltip />
                              <Legend />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="月度上線趨勢">
                      {overview.monthly_launch_trend.length === 0 ? (
                        <Empty description="目前沒有可視化資料" />
                      ) : (
                        <div style={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer>
                            <LineChart data={overview.monthly_launch_trend}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="month" />
                              <YAxis allowDecimals={false} />
                              <Tooltip />
                              <Legend />
                              <Line type="monotone" dataKey="product_count" name="上線數量" stroke="#8B6545" strokeWidth={2} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>
                  </Col>
                  <Col xs={24} xl={8}>
                    <Card title="整體銷量表現">
                      {overview.top_selling_products.length === 0 ? (
                        <Empty description="目前沒有可視化資料" />
                      ) : (
                        <div style={{ width: '100%', height: 280 }}>
                          <ResponsiveContainer>
                            <BarChart data={overview.top_selling_products}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="product_name" hide />
                              <YAxis allowDecimals={false} />
                              <Tooltip />
                              <Legend />
                              <Bar dataKey="sales_volume" name="累計銷量" fill="#4F6B58" />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Card>
                  </Col>
                </Row>
              </>
            )}
          </Space>
        </Card>

        <Card
          title="已上線批次"
          extra={batchId !== undefined && (
            <Button onClick={() => selectBatch(undefined)}>顯示全部批次商品</Button>
          )}
        >
          <Table<AdminPublishedBatch>
            rowKey="batch_id"
            dataSource={batchesQuery.data || []}
            loading={batchesQuery.isLoading}
            locale={{ emptyText: '目前沒有已上線的批次。' }}
            pagination={{ pageSize: 5, showSizeChanger: false }}
            rowClassName={(record) => (record.batch_id === batchId ? 'ant-table-row-selected' : '')}
            expandable={{
              expandedRowRender: (record) => (
                <Table<AdminPublishedBatchItem>
                  rowKey="product_id"
                  size="small"
                  pagination={false}
                  dataSource={record.items}
                  columns={[
                    { title: '商品編號', dataIndex: 'product_sku', key: 'product_sku', width: 150 },
                    { title: '商品名稱', dataIndex: 'product_name', key: 'product_name' },
                    {
                      title: '分類',
                      dataIndex: 'category_name',
                      key: 'category_name',
                      width: 140,
                      render: (value: string) => <Tag color="blue">{value}</Tag>,
                    },
                    { title: '上架數量', dataIndex: 'quantity', key: 'quantity', width: 120 },
                  ]}
                />
              ),
            }}
            columns={[
              {
                title: '批次',
                dataIndex: 'batch_id',
                key: 'batch_id',
                width: 100,
                render: (value: number) => <Text strong>#{value}</Text>,
              },
              {
                title: '上線時間',
                dataIndex: 'published_at',
                key: 'published_at',
                width: 180,
                render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
              },
              { title: '建立者', dataIndex: 'created_by_name', key: 'created_by_name', width: 140 },
              {
                title: '商品數',
                dataIndex: 'product_count',
                key: 'product_count',
                width: 100,
                render: (value: number) => `${value} 項`,
              },
              {
                title: '上架總數量',
                dataIndex: 'total_quantity',
                key: 'total_quantity',
                width: 120,
                render: (value: number) => `${value} 件`,
              },
              {
                title: '操作',
                key: 'actions',
                width: 160,
                render: (_: unknown, record: AdminPublishedBatch) => (
                  <Button
                    size="small"
                    type={record.batch_id === batchId ? 'primary' : 'default'}
                    onClick={() => selectBatch(record.batch_id === batchId ? undefined : record.batch_id)}
                  >
                    {record.batch_id === batchId ? '取消篩選' : '只看此批次'}
                  </Button>
                ),
              },
            ]}
            scroll={{ x: 800 }}
          />
        </Card>

        <Card
          title={overview?.current_month_label ? `${overview.current_month_label} 上線新品清單` : '本月上線新品清單'}
          extra={fromLine ? null : (
            <Button icon={<DownloadOutlined />} onClick={() => handleExport('current_month')}>
              匯出本月清單
            </Button>
          )}
        >
          <Table<AdminNewProductItem>
            rowKey="product_id"
            columns={tableColumns}
            dataSource={currentMonthListQuery.data?.items || []}
            locale={{ emptyText: isInitialLoading ? '載入中...' : '本月沒有符合條件的新品資料。' }}
            pagination={{
              current: currentMonthPage,
              pageSize: currentMonthPageSize,
              total: currentMonthListQuery.data?.total || 0,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              onChange: (page, pageSize) => {
                setCurrentMonthPage(page);
                setCurrentMonthPageSize(pageSize);
              },
            }}
            scroll={{ x: 980 }}
          />
        </Card>

        <Card title="累計上線新品完整清單">
          <Table<AdminNewProductItem>
            rowKey="product_id"
            columns={tableColumns}
            dataSource={allListQuery.data?.items || []}
            locale={{ emptyText: isInitialLoading ? '載入中...' : '目前沒有符合條件的累計新品資料。' }}
            pagination={{
              current: allPage,
              pageSize: allPageSize,
              total: allListQuery.data?.total || 0,
              showSizeChanger: true,
              pageSizeOptions: ['10', '20', '50'],
              onChange: (page, pageSize) => {
                setAllPage(page);
                setAllPageSize(pageSize);
              },
            }}
            scroll={{ x: 980 }}
          />
        </Card>
      </div>
    </div>
  );
};

export default MemberNewProducts;
