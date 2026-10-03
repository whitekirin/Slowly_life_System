import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, message, Tag, Select, Typography, Row, Col, Divider, DatePicker, Upload, Tabs, Tooltip, Image } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSalesOrders, createSalesOrder, updateSalesOrder, getProducts, UPLOAD_URL } from '../api';
import { VoidOrderButton, VoidStatusTag, voidRowStyle } from '../components/VoidOrder';
import { useUser } from '../contexts/UserContext';
import PickingTab from './PickingTab';
import { PlusOutlined, EditOutlined, EyeOutlined, MinusCircleOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

const { Title } = Typography;
const { Option } = Select;

const UploadWrapper = ({ value, onSuccess, onError, ...props }: any) => {
  const defaultFileList = value ? [
    {
      uid: '-1',
      name: 'file',
      status: 'done',
      url: value,
    }
  ] : [];

  // Filter out onChange passed by Form.Item
  const { onChange, ...rest } = props;

  const handleChange = (info: any) => {
    if (info.file.status === 'done') {
        const url = info.file.response.url;
        if (onSuccess) onSuccess(url);
    } else if (info.file.status === 'error') {
        if (onError) onError(info);
        else message.error('上傳失敗');
    } else if (info.file.status === 'removed') {
        if (onSuccess) onSuccess(undefined);
    }
  };

  return <Upload key={value} defaultFileList={defaultFileList} onChange={handleChange} {...rest} />;
};

const ReadOnlyText: React.FC<{ value?: any; options?: any[]; mapFn?: (val: any) => React.ReactNode }> = ({ value, options, mapFn }) => {
  let displayValue = value;
  if (mapFn) {
    displayValue = mapFn(value);
  } else if (options) {
    const opt = options.find(o => o.value === value);
    displayValue = opt ? opt.label : value;
  }
  
  // Check if it's an image/video url
  if (typeof value === 'string' && (value.startsWith('http') || value.startsWith('/'))) {
       if (value.match(/\.(jpeg|jpg|gif|png)$/i)) {
           return <img src={value} alt="img" style={{ maxWidth: 100, maxHeight: 100, objectFit: 'contain' }} />;
       }
       if (value.match(/\.(mp4|mov)$/i)) {
           return <a href={value} target="_blank" rel="noopener noreferrer">查看影片</a>;
       }
  }

  return <span style={{ fontWeight: 500, fontSize: '15px' }}>{displayValue}</span>;
};

const MediaView: React.FC<{ value?: string; kind: 'image' | 'video' }> = ({ value, kind }) => {
  if (!value) return <Typography.Text type="secondary">未上傳</Typography.Text>;
  if (kind === 'image') return <Image src={value} width={100} style={{ objectFit: 'contain' }} />;
  return <video src={value} controls style={{ maxWidth: 240, maxHeight: 160 }} />;
};

const Shipping: React.FC = () => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { hasPermission } = useUser();
  // 只有撿貨權限的人（沒有 view_shipping）只看得到撿貨分頁
  const canViewShipping = hasPermission('view_shipping');
  const canCreateShipping = hasPermission('create_shipping');
  const canEditShipping = hasPermission('edit_shipping');
  const canApproveShipping = hasPermission('approve_shipping');

  const { data: sos, isLoading: isSOLoading } = useQuery({ queryKey: ['sales_orders'], queryFn: getSalesOrders, enabled: canViewShipping });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: getProducts, enabled: canViewShipping });
  // 蝦皮出貨 QRcode 只在平台選蝦皮時出現
  const platform = Form.useWatch('platform', form);
  // 出貨人顯示方式同採購單的採購者；實際寫入的值由後端依登入者決定
  const currentUserName = (() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.full_name || user.username || 'System';
  })();

  // 待出貨＝尚未出貨的單（舊的 pending，以及撿貨中／撿貨完成）
  const pendingSOs = sos?.filter((so: any) => ['pending', 'picking', 'picked'].includes(so.status));
  const historySOs = sos?.filter((so: any) => so.status === 'shipped' || so.status === 'completed');

  // 建立待出貨單時庫存就已扣除；彙整每個商品被哪些待出貨單扣了多少，顯示在商品旁避免誤判可用庫存
  const pendingReserved: Record<number, { orderId: number; orderNumber: string; qty: number }[]> = {};
  // 已報廢的單庫存已加回，不再佔用
  pendingSOs?.filter((so: any) => so.void_status !== 'voided').forEach((so: any) => {
    so.items?.forEach((item: any) => {
      (pendingReserved[item.product_id] ||= []).push({
        orderId: so.id,
        orderNumber: so.order_number || `SO-${so.id}`,
        qty: item.quantity,
      });
    });
  });

  // 某列商品「本單還能出幾件」：資料庫庫存（已扣掉所有待出貨單，含編輯中的本單）
  // + 本單原本就扣掉的數量 − 本單其他列已選的數量。避免同商品重複加列時看起來還有庫存。
  const getAvailableForRow = (rowIndex: number) => {
    const items: any[] = form.getFieldValue('items') || [];
    const pid = items[rowIndex]?.product_id;
    const product = products?.find((p: any) => p.id === pid);
    if (!product) return null;
    const editingOrder = editingId ? sos?.find((so: any) => so.id === editingId) : null;
    const originalQty = (editingOrder?.items || [])
      .filter((i: any) => i.product_id === pid)
      .reduce((sum: number, i: any) => sum + i.quantity, 0);
    const otherRowsQty = items
      .filter((item: any, idx: number) => idx !== rowIndex && item?.product_id === pid)
      .reduce((sum: number, item: any) => sum + (item?.quantity || 0), 0);
    return { product, originalQty, otherRowsQty, available: product.stock_quantity + originalQty - otherRowsQty };
  };

  // 上傳的照片/影片套用到同商品的所有列；新增但尚未填寫的列在 Form.List 中是 undefined
  const applyMediaToSameProduct = (rowIndex: number, field: 'shipping_image' | 'shipping_video', url: string | undefined) => {
    const items: any[] = form.getFieldValue('items') || [];
    const currentPid = items[rowIndex]?.product_id;
    const newItems = items.map((item: any, idx: number) => {
      if (idx === rowIndex || (currentPid !== undefined && item?.product_id === currentPid)) {
        return { ...item, [field]: url };
      }
      return item;
    });
    form.setFieldsValue({ items: newItems });
  };

  const createMutation = useMutation({
    mutationFn: createSalesOrder,
    onSuccess: () => {
      message.success('出貨單建立成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
      queryClient.invalidateQueries({ queryKey: ['picking_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Stock changes
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: any) => {
      message.error(`建立失敗: ${error.response?.data?.detail || error.message}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateSalesOrder,
    onSuccess: () => {
      message.success('出貨單更新成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['sales_orders'] });
      queryClient.invalidateQueries({ queryKey: ['picking_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: any) => {
      message.error(`更新失敗: ${error.response?.data?.detail || error.message}`);
    }
  });

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setIsViewMode(false);
    form.resetFields();
  };

  const handleEdit = (record: any) => {
    setEditingId(record.id);
    setIsViewMode(false);
    form.setFieldsValue({
      order_number: record.order_number,
      customer_id: record.customer_id,
      platform: record.platform,
      status: record.status,
      shipped_by: record.shipped_by || currentUserName,
      shipping_date: record.shipping_date ? dayjs(record.shipping_date) : dayjs(),
      shopee_qrcode_image: record.shopee_qrcode_image,
      items: record.items.map((item: any) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        shipping_image: item.shipping_image,
        shipping_video: item.shipping_video
      }))
    });
    setIsModalOpen(true);
  };

  const handleView = (record: any) => {
    setEditingId(record.id);
    setIsViewMode(true);
    form.setFieldsValue({
      order_number: record.order_number,
      customer_id: record.customer_id,
      platform: record.platform,
      status: record.status,
      shipped_by: record.shipped_by,
      shipping_date: record.shipping_date ? dayjs(record.shipping_date) : null,
      shopee_qrcode_image: record.shopee_qrcode_image,
      items: record.items.map((item: any) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        shipping_image: item.shipping_image,
        shipping_video: item.shipping_video
      }))
    });
    setIsModalOpen(true);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      
      const totalAmount = values.items.reduce((sum: number, item: any) => {
        return sum + (item.quantity * item.unit_price);
      }, 0);

      const payload = {
        customer_id: values.customer_id,
        platform: values.platform,
        status: values.status,
        shipping_date: values.shipping_date ? values.shipping_date.toISOString() : null,
        total_amount: totalAmount,
        shopee_qrcode_image: values.platform === 'shopee' ? (form.getFieldValue('shopee_qrcode_image') || null) : null,
        items: values.items
      };

      if (editingId) {
        updateMutation.mutate({ id: editingId, data: payload });
      } else {
        createMutation.mutate(payload);
      }
    } catch (error) {
      console.error("Validation Failed:", error);
    }
  };

  const columns = [
    { title: '出貨單號', dataIndex: 'order_number', key: 'order_number', render: (text: string, record: any) => text || `SO-${record.id}` },
    { title: '商家 (Platform)', dataIndex: 'platform', key: 'platform', render: (text: string) => <Tag>{text?.toUpperCase() || 'MANUAL'}</Tag> },
    { title: '客戶編號', dataIndex: 'customer_id', key: 'customer_id' },
    { title: '總數量', dataIndex: 'total_quantity', key: 'total_quantity' },
    { title: '總金額', dataIndex: 'total_amount', key: 'total_amount', render: (val: number) => `$${val}` },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string, record: any) => {
        let color = 'blue';
        let text = status.toUpperCase();
        if (status === 'pending') { color = 'orange'; text = '待出貨'; }
        if (status === 'picking') { color = 'processing'; text = '撿貨中'; }
        if (status === 'picked') { color = 'cyan'; text = '撿貨完成'; }
        if (status === 'shipped') { color = 'green'; text = '已出貨'; }
        return <Space size={4} wrap><Tag color={color}>{text}</Tag><VoidStatusTag record={record} /></Space>;
      }
    },
    { title: '訂單日期', dataIndex: 'order_date', key: 'order_date', render: (date: string) => new Date(date).toLocaleDateString() },
    {
      title: '操作',
      key: 'action',
      // 出貨單不能刪除，只能報廢；報廢審核中／已報廢、已出貨或沒有修改權限的單只能查看
      render: (_: unknown, record: any) => (
        <Space wrap>
          {record.status === 'shipped' || record.status === 'completed' || record.void_status || !canEditShipping ? (
             <Button type="text" icon={<EyeOutlined />} onClick={() => handleView(record)} />
          ) : (
             <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          )}
          <VoidOrderButton
            resourceType="sales_order"
            record={record}
            resourceLabel={`出貨單 ${record.order_number || `SO-${record.id}`}（客戶：${record.customer_id}）`}
            canApprove={canApproveShipping}
            canRequest={canEditShipping}
          />
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>出貨作業</Title>
        {canCreateShipping && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingId(null); setIsModalOpen(true); }}>建立出貨單</Button>
        )}
      </div>

      <Tabs defaultActiveKey={canViewShipping ? "1" : "3"} items={[
        {
            key: '1',
            label: '待出貨訂單',
            children: (
                <Table 
                    dataSource={pendingSOs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isSOLoading}
                    pagination={{ pageSize: 5 }} 
                    locale={{ emptyText: '目前沒有待出貨訂單' }}
                />
            )
        },
        {
            key: '2',
            label: '出貨紀錄',
            children: (
                <Table 
                    dataSource={historySOs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isSOLoading}
                    pagination={{ pageSize: 5 }}
                    locale={{ emptyText: '尚無出貨紀錄' }}
                />
            )
        },
        {
            key: '3',
            label: '撿貨人員',
            children: <PickingTab />
        }
      ].filter(tab => canViewShipping || tab.key === '3')} />

      <Modal
        title={isViewMode ? "查看出貨單" : (editingId ? "編輯出貨單" : "建立出貨單")}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={handleCloseModal}
        width={800}
        okText={editingId ? "更新" : "建立"}
        cancelText={isViewMode ? "關閉" : "取消"}
        okButtonProps={{ style: { display: isViewMode ? 'none' : '' } }}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ status: 'picking', items: [{}], shipping_date: dayjs(), shipped_by: currentUserName }}>
          {editingId && (
            <Row gutter={16}>
               <Col span={24}>
                  <Form.Item name="order_number" label="出貨單號">
                     <ReadOnlyText />
                  </Form.Item>
               </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="platform" label="商家 (Platform)" rules={[{ required: true, message: '請選擇商家' }]}>
                {isViewMode ? (
                  <ReadOnlyText options={[
                    { value: 'shopee', label: '蝦皮 (Shopee)' },
                    { value: 'amazon', label: 'Amazon' },
                    { value: 'manual', label: '手動/其他 (Manual)' }
                  ]} />
                ) : (
                  <Select placeholder="選擇商家/平台">
                      <Option value="shopee">蝦皮 (Shopee)</Option>
                      <Option value="amazon">Amazon</Option>
                      <Option value="manual">手動/其他 (Manual)</Option>
                  </Select>
                )}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="customer_id" label="客戶編號" rules={[{ required: true, message: '請輸入客戶編號' }]}>
                {isViewMode ? <ReadOnlyText /> : <Input placeholder="輸入客戶編號" />}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="狀態">
                {isViewMode ? (
                  <ReadOnlyText options={[
                    { value: 'pending', label: '待出貨 (Pending)' },
                    { value: 'picking', label: '撿貨中' },
                    { value: 'picked', label: '撿貨完成' },
                    { value: 'shipped', label: '已出貨 (Shipped)' }
                  ]} />
                ) : !editingId ? (
                  // 新出貨單一律從撿貨中開始，由撿貨人員在撿貨分頁推進
                  <ReadOnlyText options={[{ value: 'picking', label: '撿貨中' }]} />
                ) : (
                  <Select>
                    <Option value="pending">待出貨 (Pending)</Option>
                    {/* 撿貨中／撿貨完成依逐項撿貨狀態自動決定，這裡不提供手動選撿貨完成 */}
                    <Option value="picking">撿貨中</Option>
                    <Option value="picked" disabled>撿貨完成（全部商品撿完時自動）</Option>
                    <Option value="shipped">已出貨 (Shipped) - 記錄出貨與收入</Option>
                  </Select>
                )}
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="shipping_date" label="出貨日期">
                {isViewMode ? <ReadOnlyText mapFn={(d) => d ? dayjs(d).format('YYYY-MM-DD') : '-'} /> : <DatePicker style={{ width: '100%' }} />}
              </Form.Item>
            </Col>
            <Col span={8}>
               <Form.Item name="shipped_by" label="出貨人">
                 {isViewMode ? <ReadOnlyText /> : <Input readOnly disabled style={{ cursor: 'default', color: 'rgba(0, 0, 0, 0.88)' }} />}
               </Form.Item>
            </Col>
            {platform === 'shopee' && (
            <Col span={8}>
              <Form.Item name="shopee_qrcode_image" label="蝦皮出貨 QRcode">
                {isViewMode ? (
                  <MediaView kind="image" />
                ) : (
                  <UploadWrapper
                    action={UPLOAD_URL}
                    listType="picture"
                    maxCount={1}
                    accept="image/*"
                    name="file"
                    onSuccess={(url: string | undefined) => {
                      form.setFieldsValue({ shopee_qrcode_image: url });
                      if (url) message.success('QRcode 上傳成功');
                    }}
                  >
                    <Button icon={<UploadOutlined />} size="small">上傳 QRcode</Button>
                  </UploadWrapper>
                )}
              </Form.Item>
            </Col>
            )}
          </Row>

          <Divider titlePlacement="left">出貨商品</Divider>
          
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {/* 欄名列：手機上欄位會換行排，對不齊，輸入框本身有提示文字，所以窄畫面隱藏 */}
                <Row className="sl-hide-narrow" gutter={16} style={{ marginBottom: 8, paddingLeft: 8 }}>
                  <Col span={8}><Typography.Text strong>商品名稱</Typography.Text></Col>
                  <Col span={5}><Typography.Text strong>庫存</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>數量</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>單價</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>小計</Typography.Text></Col>
                  <Col span={2}></Col>
                </Row>
                {fields.map(({ key, name, ...restField }) => (
                  <Row key={key} gutter={16} style={{ marginBottom: 12 }} align="middle">
                    <Col span={8}>
                      <Form.Item
                        {...restField}
                        name={[name, 'product_id']}
                        rules={[{ required: true, message: '請選擇商品' }]}
                        style={{ marginBottom: 0 }}
                      >
                        {isViewMode ? (
                          <ReadOnlyText mapFn={(val) => {
                             const p = products?.find((x: any) => x.id === val);
                             return p ? `${p.name} ${p.attributes?.style ? `(${p.attributes.style})` : ''}` : val;
                          }} />
                        ) : (
                          <Select 
                            placeholder="選擇商品" 
                            showSearch
                            optionFilterProp="children"
                            filterOption={(input, option: any) => {
                                const label = option?.label || '';
                                return label.toLowerCase().includes(input.toLowerCase());
                            }}
                            onChange={(value) => {
                                const product = products?.find((p: any) => p.id === value);
                                if (product) {
                                    const items = form.getFieldValue('items');
                                    const newItems = [...items];
                                    newItems[name] = { 
                                        ...newItems[name], 
                                        unit_price: product.sales_price 
                                    };
                                    form.setFieldsValue({ items: newItems });
                                }
                            }}
                            style={{ width: '100%' }}
                          >
                            {products?.slice()
                              .sort((a: any, b: any) => a.name.localeCompare(b.name))
                              .filter((p: any) => p.stock_quantity > 0 || !!editingId)
                              .map((p: any) => (
                              <Option key={p.id} value={p.id} label={`${p.name}${p.attributes?.style ? ` (${p.attributes.style})` : ''}`}>
                                {p.name} {p.attributes?.style && `(${p.attributes.style})`}
                              </Option>
                            ))}
                          </Select>
                        )}
                      </Form.Item>
                    </Col>
                    <Col span={5}>
                      <Form.Item
                        shouldUpdate={(prev, curr) => prev.items !== curr.items}
                        style={{ marginBottom: 0 }}
                      >
                        {() => {
                          if (isViewMode) return <span>-</span>;
                          const info = getAvailableForRow(name);
                          if (!info) return <Typography.Text type="secondary">-</Typography.Text>;
                          const { product, originalQty, otherRowsQty, available } = info;
                          const pid = product.id;
                          const reservations = pendingReserved[pid] || [];
                          const reservedQty = reservations.reduce((sum, r) => sum + r.qty, 0);
                          return (
                            <Space direction="vertical" size={0}>
                              <Tooltip
                                title={
                                  <>
                                    <div>目前庫存：{product.stock_quantity}</div>
                                    {originalQty > 0 && <div>＋ 本單原已扣除：{originalQty}</div>}
                                    {otherRowsQty > 0 && <div>－ 本單其他列已選：{otherRowsQty}</div>}
                                  </>
                                }
                              >
                                <span style={{ color: available > 0 ? 'green' : 'red', cursor: 'help' }}>
                                  可出貨 {Math.max(available, 0)}
                                </span>
                              </Tooltip>
                              {reservedQty > 0 && (
                                <Tooltip
                                  title={
                                    <>
                                      <div>以下待出貨單已先扣除庫存：</div>
                                      {reservations.map((r) => (
                                        <div key={r.orderId}>
                                          {r.orderNumber}：{r.qty} 件{r.orderId === editingId ? '（本單）' : ''}
                                        </div>
                                      ))}
                                    </>
                                  }
                                >
                                  <Tag color="orange" style={{ marginInlineEnd: 0, cursor: 'help' }}>
                                    待出貨已扣 {reservedQty}
                                  </Tag>
                                </Tooltip>
                              )}
                            </Space>
                          );
                        }}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item
                        {...restField}
                        name={[name, 'quantity']}
                        rules={[
                          { required: true, message: '數量' },
                          {
                            validator: (_, value) => {
                              const info = getAvailableForRow(name);
                              if (!value || !info || value <= info.available) return Promise.resolve();
                              return Promise.reject(new Error(`超過可出貨 ${Math.max(info.available, 0)}`));
                            },
                          },
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        {isViewMode ? <ReadOnlyText /> : <InputNumber min={1} placeholder="數量" style={{ width: '100%' }} />}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item
                        {...restField}
                        name={[name, 'unit_price']}
                        rules={[{ required: true, message: '單價' }]}
                        style={{ marginBottom: 0 }}
                      >
                        {isViewMode ? <ReadOnlyText mapFn={v => `$${v}`} /> : <InputNumber min={0} placeholder="單價" prefix="$" style={{ width: '100%' }} />}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                        <Form.Item
                            shouldUpdate={(prev, curr) => {
                                const prevItem = prev.items?.[name];
                                const currItem = curr.items?.[name];
                                return prevItem?.quantity !== currItem?.quantity || prevItem?.unit_price !== currItem?.unit_price;
                            }}
                            style={{ marginBottom: 0 }}
                        >
                            {() => {
                                const qty = form.getFieldValue(['items', name, 'quantity']) || 0;
                                const price = form.getFieldValue(['items', name, 'unit_price']) || 0;
                                return <span style={isViewMode ? { fontWeight: 500, fontSize: '15px' } : {}}>${(qty * price).toLocaleString()}</span>;
                            }}
                        </Form.Item>
                    </Col>
                    <Col span={2} style={{ textAlign: 'center' }}>
                      {!isViewMode && <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#B25B4C', cursor: 'pointer' }} />}
                    </Col>
                    <Col span={24} style={{ marginTop: 8 }}>
                      {isViewMode ? (
                        <Space size="large" align="start">
                          <Form.Item name={[name, 'shipping_image']} label="出貨照片" style={{ marginBottom: 0 }}>
                            <MediaView kind="image" />
                          </Form.Item>
                          <Form.Item name={[name, 'shipping_video']} label="出貨影片" style={{ marginBottom: 0 }}>
                            <MediaView kind="video" />
                          </Form.Item>
                        </Space>
                      ) : (
                      <Space>
                        <Form.Item
                          {...restField}
                          name={[name, 'shipping_image']}
                          label="出貨照片"
                          style={{ marginBottom: 0 }}
                        >
                          <UploadWrapper
                            action={UPLOAD_URL}
                            listType="picture"
                            maxCount={1}
                            accept="image/*"
                            name="file"
                            onSuccess={(url: string) => {
                                applyMediaToSameProduct(name, 'shipping_image', url);
                                if (url) message.success('圖片上傳成功 (已套用至同商品)');
                            }}
                          >
                            <Button icon={<UploadOutlined />} size="small">上傳照片</Button>
                          </UploadWrapper>
                        </Form.Item>

                        <Form.Item
                          {...restField}
                          name={[name, 'shipping_video']}
                          label="出貨影片"
                          style={{ marginBottom: 0 }}
                        >
                          <UploadWrapper 
                            action={UPLOAD_URL}
                            maxCount={1}
                            accept="video/*"
                            name="file"
                            onSuccess={(url: string) => {
                                applyMediaToSameProduct(name, 'shipping_video', url);
                                if (url) message.success('影片上傳成功 (已套用至同商品)');
                            }}
                          >
                            <Button icon={<UploadOutlined />} size="small">上傳影片</Button>
                          </UploadWrapper>
                        </Form.Item>
                      </Space>
                      )}
                    </Col>
                  </Row>
                ))}
                
                {!isViewMode && (
                  <Form.Item style={{ marginTop: 16 }}>
                    <Button type="dashed" onClick={() => add({})} icon={<PlusOutlined />}>
                      新增商品
                    </Button>
                  </Form.Item>
                )}

                <div style={{ textAlign: 'right', marginTop: 16, marginBottom: 0, paddingRight: 32 }}>
                   <Form.Item shouldUpdate style={{ marginBottom: 0 }}>
                     {() => {
                       const items = form.getFieldValue('items') || [];
                       const total = items.reduce((sum: number, item: any) => {
                         const qty = item?.quantity || 0;
                         const price = item?.unit_price || 0;
                         return sum + (qty * price);
                       }, 0);
                       const totalQty = items.reduce((sum: number, item: any) => {
                          return sum + (item?.quantity || 0);
                       }, 0);
                       return (
                         <Space size="large">
                            <Title level={4} style={{ margin: 0 }}>總數量: {totalQty}</Title>
                            <Title level={4} style={{ margin: 0 }}>總金額: ${total.toLocaleString()}</Title>
                         </Space>
                       );
                     }}
                   </Form.Item>
                </div>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
};

export default Shipping;
