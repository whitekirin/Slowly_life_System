import React, { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, message, Tag, Select, Typography, Row, Col, Divider, DatePicker, Checkbox, Upload, Tabs, Radio, Alert } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getReturnOrders, createReturnOrder, updateReturnOrder, getProducts, getSalesOrders, UPLOAD_URL } from '../api';
import { VoidOrderButton, VoidStatusTag, voidRowStyle } from '../components/VoidOrder';
import { PlusOutlined, EditOutlined, EyeOutlined, MinusCircleOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { useUser } from '../contexts/UserContext';
const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

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
        // Clicking the file list's remove icon only clears Upload's own
        // internal fileList — callers rely on onSuccess to sync the actual
        // form field, so removal has to go through the same path (with an
        // empty value) or the old URL keeps sitting in the form silently.
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

const ReturnList: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_returns');
  const canEdit = hasPermission('edit_returns');
  const canApprove = hasPermission('approve_returns');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isViewMode, setIsViewMode] = useState(false);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: ros, isLoading: isROLoading } = useQuery({ queryKey: ['return_orders'], queryFn: getReturnOrders });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: getProducts });
  const { data: salesOrders } = useQuery({ queryKey: ['sales_orders'], queryFn: getSalesOrders });

  // 經辦人顯示方式同出貨單的出貨人；實際寫入的值由後端依登入者決定
  const currentUserName = (() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    return user.full_name || user.username || 'System';
  })();
  // return = 退貨退款（要選退貨商品）；refund_only = 僅退款（不退商品，手填金額與原因）
  const returnType = Form.useWatch('return_type', form);
  const isRefundOnly = returnType === 'refund_only';

  // 已報廢的單移到退貨紀錄（不刪除，一直留著）
  const pendingROs = ros?.filter((ro: any) => ro.status === 'pending' && ro.void_status !== 'voided');
  const historyROs = ros?.filter((ro: any) => ro.status === 'completed' || ro.void_status === 'voided');

  const createMutation = useMutation({
    mutationFn: createReturnOrder,
    onSuccess: () => {
      message.success('退貨單建立成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['return_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] }); // Stock changes
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: any) => {
      message.error(`建立失敗: ${error.response?.data?.detail || error.message}`);
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateReturnOrder,
    onSuccess: () => {
      message.success('退貨單更新成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['return_orders'] });
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
    
    // If order_id exists, we need to populate with all items from the order
    // and mark the existing return items as selected.
    // However, if we just want to show the current state of Return Order,
    // we should just show the items that are IN the Return Order.
    // But the requirement implies a "Select from Order" flow.
    // For simplicity in Edit mode, we just load the Return Items as they are.
    // If the user wants to add more items from the Order, they might need to re-select the order or we handle it smarter.
    // Let's stick to showing what's saved for Edit mode, but maybe enable the "Order Selection" UI if order_id is present?
    // Actually, to support "Tick to select", we should probably load all SO items if order_id is present.
    
    let initialItems = [];
    if (record.order_id && salesOrders) {
        const so = salesOrders.find((s: any) => s.id === record.order_id);
        if (so) {
            // Merge SO items with Record items
            initialItems = so.items.map((soItem: any) => {
                const returnItem = record.items.find((ri: any) => ri.product_id === soItem.product_id);
                if (returnItem) {
                    return {
                        product_id: returnItem.product_id,
                        quantity: returnItem.quantity,
                        unit_price: returnItem.unit_price,
                        reason: returnItem.reason,
                        selected: true,
                        max_qty: soItem.quantity, // Original purchased qty
                        return_image: returnItem.return_image,
                        return_video: returnItem.return_video
                    };
                } else {
                    return {
                        product_id: soItem.product_id,
                        quantity: soItem.quantity,
                        unit_price: soItem.unit_price,
                        reason: '',
                        selected: false,
                        max_qty: soItem.quantity
                    };
                }
            });
        } else {
             // Fallback if SO not found (e.g. deleted?)
             initialItems = record.items.map((item: any) => ({ ...item, selected: true }));
        }
    } else {
        // Manual items
        initialItems = record.items.map((item: any) => ({ ...item, selected: true }));
    }

    form.setFieldsValue({
      return_number: record.return_number,
      order_id: record.order_id,
      customer_id: record.customer_id,
      status: record.status,
      return_type: record.return_type || 'return',
      total_refund_amount: record.total_refund_amount,
      handled_by: record.handled_by || currentUserName,
      return_date: record.return_date ? dayjs(record.return_date) : null,
      note: record.note,
      items: initialItems
    });
    setIsModalOpen(true);
  };

  const handleView = (record: any) => {
    setEditingId(record.id);
    setIsViewMode(true);
    form.setFieldsValue({
      return_number: record.return_number,
      order_id: record.order_id,
      customer_id: record.customer_id,
      status: record.status,
      return_type: record.return_type || 'return',
      total_refund_amount: record.total_refund_amount,
      handled_by: record.handled_by || '-',
      return_date: record.return_date ? dayjs(record.return_date) : null,
      note: record.note,
      items: record.items.map((item: any) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        reason: item.reason,
        selected: true,
        return_image: item.return_image,
        return_video: item.return_video
      }))
    });
    setIsModalOpen(true);
  };

  const handleOk = async () => {
    try {
      // 僅退款時商品區塊被隱藏，不驗證（也不送出）裡面的欄位
      const values = form.getFieldValue('return_type') === 'refund_only'
        ? await form.validateFields(['return_type', 'order_id', 'customer_id', 'status', 'return_date', 'note', 'total_refund_amount'])
        : await form.validateFields();
      
      let apiItems: any[] = [];
      let totalRefundAmount = 0;

      if (values.return_type === 'refund_only') {
        // 僅退款：不送商品，金額由使用者直接輸入
        totalRefundAmount = values.total_refund_amount;
      } else {
        // Filter only selected items
        const selectedItems = (values.items || []).filter((item: any) => item.selected);

        if (selectedItems.length === 0) {
            message.error('請至少選擇一項退貨商品；若只退款不退貨，請將退貨類型改為「僅退款」');
            return;
        }

        totalRefundAmount = selectedItems.reduce((sum: number, item: any) => {
          return sum + (item.quantity * item.unit_price);
        }, 0);

        // Clean up items for API
        apiItems = selectedItems.map((item: any) => ({
            product_id: item.product_id,
            quantity: item.quantity,
            unit_price: item.unit_price,
            reason: item.reason,
            return_image: item.return_image,
            return_video: item.return_video
        }));
      }

      const payload = {
        order_id: values.order_id,
        customer_id: values.customer_id,
        status: values.status,
        return_type: values.return_type,
        return_date: values.return_date ? values.return_date.toISOString() : null,
        total_refund_amount: totalRefundAmount,
        note: values.note,
        items: apiItems
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
    { title: '退貨單號', dataIndex: 'return_number', key: 'return_number', render: (text: string, record: any) => text || `RO-${record.id}` },
    { title: '類型', dataIndex: 'return_type', key: 'return_type', render: (val: string) => val === 'refund_only' ? <Tag color="purple">僅退款</Tag> : <Tag color="blue">退貨退款</Tag> },
    { title: '客戶編號', dataIndex: 'customer_id', key: 'customer_id' },
    { title: '關聯訂單', dataIndex: 'order_id', key: 'order_id', render: (val: any) => val ? (salesOrders?.find((so: any) => so.id === val)?.order_number || `SO-${val}`) : '-' },
    { title: '退款金額', dataIndex: 'total_refund_amount', key: 'total_refund_amount', render: (val: number) => `$${val}` },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string, record: any) => {
        let color = 'blue';
        let text = status.toUpperCase();
        if (status === 'pending') { color = 'orange'; text = '待處理'; }
        if (status === 'completed') { color = 'green'; text = '已完成'; }
        return <Space size={4} wrap><Tag color={color}>{text}</Tag><VoidStatusTag record={record} /></Space>;
      }
    },
    { title: '退貨日期', dataIndex: 'return_date', key: 'return_date', render: (date: string) => new Date(date).toLocaleDateString() },
    { title: '經辦人', dataIndex: 'handled_by', key: 'handled_by', render: (val: string) => val || '-' },
    {
      title: '操作',
      key: 'action',
      // 退貨單不能刪除，只能報廢；報廢審核中／已報廢、已完成或沒有修改權限的單只能查看
      render: (_: unknown, record: any) => (
        <Space wrap>
          {record.status === 'completed' || record.void_status || !canEdit ? (
             <Button type="text" icon={<EyeOutlined />} onClick={() => handleView(record)} />
          ) : (
             <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          )}
          <VoidOrderButton
            resourceType="return_order"
            record={record}
            resourceLabel={`退貨單 ${record.return_number || `RO-${record.id}`}（客戶：${record.customer_id || '-'}）`}
            canApprove={canApprove}
            canRequest={canEdit}
          />
        </Space>
      )
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>退貨作業</Title>
        {canCreate && <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditingId(null); setIsModalOpen(true); }}>建立退貨單</Button>}
      </div>

      <Tabs defaultActiveKey="1" items={[
        {
            key: '1',
            label: '待處理退貨',
            children: (
                <Table 
                    dataSource={pendingROs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isROLoading}
                    pagination={{ pageSize: 5 }} 
                    locale={{ emptyText: '目前沒有待處理退貨' }}
                />
            )
        },
        {
            key: '2',
            label: '退貨紀錄',
            children: (
                <Table 
                    dataSource={historyROs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isROLoading}
                    pagination={{ pageSize: 5 }}
                    locale={{ emptyText: '尚無退貨紀錄' }}
                />
            )
        }
      ]} />

      <Modal
        title={isViewMode ? "查看退貨單" : (editingId ? "編輯退貨單" : "建立退貨單")}
        open={isModalOpen}
        onOk={handleOk}
        onCancel={handleCloseModal}
        width={900}
        okText={editingId ? "更新" : "建立"}
        cancelText={isViewMode ? "關閉" : "取消"}
        okButtonProps={{ style: { display: isViewMode ? 'none' : '' } }}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ status: 'pending', return_type: 'return', items: [], return_date: dayjs(), handled_by: currentUserName }}>
          {editingId && (
            <Row gutter={16}>
               <Col span={24}>
                  <Form.Item name="return_number" label="退貨單號">
                     <ReadOnlyText />
                  </Form.Item>
               </Col>
            </Row>
          )}
          <Form.Item name="return_type" label="退貨類型">
            {isViewMode ? (
              <ReadOnlyText options={[
                { value: 'return', label: '退貨退款' },
                { value: 'refund_only', label: '僅退款（不退商品）' }
              ]} />
            ) : (
              <Radio.Group optionType="button" buttonStyle="solid" options={[
                { value: 'return', label: '退貨退款' },
                { value: 'refund_only', label: '僅退款（不退商品）' }
              ]} />
            )}
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="order_id" label="關聯訂單 (Sales Order)">
                {isViewMode ? (
                  <ReadOnlyText mapFn={(val) => val ? (salesOrders?.find((so: any) => so.id === val)?.order_number || `SO-${val}`) : '-'} />
                ) : (
                  <Select 
                    placeholder="選擇關聯訂單 (可選)" 
                    allowClear
                    showSearch
                    optionFilterProp="children"
                    onChange={(val) => {
                        const so = salesOrders?.find((s: any) => s.id === val);
                        if (so) {
                            form.setFieldsValue({ customer_id: so.customer_id });
                            // Populate items
                            const items = so.items.map((item: any) => ({
                                product_id: item.product_id,
                                quantity: item.quantity,
                                unit_price: item.unit_price,
                                reason: '',
                                selected: false,
                                max_qty: item.quantity
                            }));
                            form.setFieldsValue({ items });
                        } else {
                            // Reset items if no order selected or cleared
                            form.setFieldsValue({ items: [], customer_id: undefined });
                        }
                    }}
                  >
                    {salesOrders?.map((so: any) => (
                        <Option key={so.id} value={so.id}>{so.order_number} ({so.customer_id})</Option>
                    ))}
                  </Select>
                )}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item shouldUpdate={(prev, curr) => prev.order_id !== curr.order_id} style={{ marginBottom: 0 }}>
                {() => (
                  <Form.Item name="customer_id" label="客戶編號" rules={[{ required: true, message: '請輸入客戶編號' }]}>
                    {isViewMode ? <ReadOnlyText /> : <Input placeholder="輸入客戶編號" disabled={!!form.getFieldValue('order_id')} />}
                  </Form.Item>
                )}
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="狀態">
                {isViewMode ? (
                  <ReadOnlyText options={[
                    { value: 'pending', label: '待處理 (Pending)' },
                    { value: 'completed', label: '已完成 (Completed)' }
                  ]} />
                ) : (
                  <Select>
                    <Option value="pending">待處理 (Pending)</Option>
                    <Option value="completed">{isRefundOnly ? '已完成 (Completed) - 記錄退款支出' : '已完成 (Completed) - 將增加庫存'}</Option>
                  </Select>
                )}
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="return_date" label={isRefundOnly ? '退款日期' : '退貨日期'}>
                {isViewMode ? <ReadOnlyText mapFn={(d) => d ? dayjs(d).format('YYYY-MM-DD') : '-'} /> : <DatePicker style={{ width: '100%' }} />}
              </Form.Item>
            </Col>
            <Col span={8}>
               <Form.Item name="handled_by" label="經辦人">
                 {isViewMode ? <ReadOnlyText /> : <Input readOnly disabled style={{ cursor: 'default', color: 'rgba(0, 0, 0, 0.88)' }} />}
               </Form.Item>
            </Col>
            {isRefundOnly && (
            <Col span={8}>
               <Form.Item
                 name="total_refund_amount"
                 label="退款金額"
                 rules={[{ required: true, message: '請輸入退款金額' }, { type: 'number', min: 0.01, message: '退款金額必須大於 0' }]}
               >
                 {isViewMode ? <ReadOnlyText mapFn={v => `$${(v || 0).toLocaleString()}`} /> : <InputNumber min={0} prefix="$" style={{ width: '100%' }} placeholder="退款金額" />}
               </Form.Item>
            </Col>
            )}
          </Row>

          <Row gutter={16}>
            <Col span={24}>
               <Form.Item
                 name="note"
                 label={isRefundOnly ? '退款原因' : '備註'}
                 rules={isRefundOnly ? [{ required: true, whitespace: true, message: '僅退款必須填寫退款原因' }] : []}
               >
                 {isViewMode ? <ReadOnlyText /> : <TextArea rows={isRefundOnly ? 2 : 1} placeholder={isRefundOnly ? '例如：少寄贈品補償、價差退款、運費補貼' : '退貨原因/備註'} />}
               </Form.Item>
            </Col>
          </Row>

          {isRefundOnly && !isViewMode && (
            <Alert type="info" showIcon title="僅退款不會退回任何商品、不影響庫存；完成後只會在帳務記錄一筆退款支出。" />
          )}

          <div style={{ display: isRefundOnly ? 'none' : undefined }}>
          <Divider titlePlacement="left">退貨商品</Divider>
          
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                <Row gutter={16} style={{ marginBottom: 8, paddingLeft: 8 }}>
                  <Col span={1} style={{ paddingTop: 6 }}>
                      {/* Select All Checkbox */}
                      <Form.Item shouldUpdate style={{ marginBottom: 0 }}>
                        {() => {
                            const items = form.getFieldValue('items') || [];
                            // Check if at least one item is present to show checkbox logic effectively
                            const allSelected = items.length > 0 && items.every((item: any) => item.selected);
                            const indeterminate = items.some((item: any) => item.selected) && !allSelected;
                            
                            return (
                                <Checkbox 
                                    checked={allSelected}
                                    indeterminate={indeterminate}
                                    disabled={isViewMode || items.length === 0}
                                    onChange={(e) => {
                                        const newItems = items.map((item: any) => ({
                                            ...item,
                                            selected: e.target.checked
                                        }));
                                        form.setFieldsValue({ items: newItems });
                                    }}
                                />
                            );
                        }}
                      </Form.Item>
                  </Col>
                  <Col span={7}><Typography.Text strong>商品名稱</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>退貨數量</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>退款單價</Typography.Text></Col>
                  <Col span={6}><Typography.Text strong>原因</Typography.Text></Col>
                  <Col span={3}><Typography.Text strong>小計</Typography.Text></Col>
                  <Col span={1}></Col>
                </Row>
                
                {fields.length === 0 && !form.getFieldValue('order_id') && (
                     <div style={{ textAlign: 'center', padding: '20px', color: '#888', gridColumn: '1/-1' }}>
                         請先選擇關聯訂單以載入商品
                     </div>
                )}
                
                {fields.map(({ key, name, ...restField }) => (
                  <div key={key} style={{ borderBottom: '1px solid #f0f0f0', marginBottom: 16, paddingBottom: 16 }}>
                  <Row gutter={16} align="top">
                    <Col span={1} style={{ paddingTop: 6 }}>
                        <Form.Item
                            {...restField}
                            name={[name, 'selected']}
                            valuePropName="checked"
                            style={{ marginBottom: 0 }}
                        >
                            <Checkbox disabled={isViewMode} />
                        </Form.Item>
                    </Col>
                    <Col span={7}>
                      <Form.Item
                        {...restField}
                        name={[name, 'product_id']}
                        rules={[{ required: true, message: '請選擇商品' }]}
                        style={{ marginBottom: 0 }}
                      >
                        {isViewMode || form.getFieldValue('order_id') ? (
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
                                        unit_price: product.sales_price,
                                        selected: true
                                    };
                                    form.setFieldsValue({ items: newItems });
                                }
                            }}
                            style={{ width: '100%' }}
                          >
                            {products?.slice()
                              .sort((a: any, b: any) => a.name.localeCompare(b.name))
                              .map((p: any) => (
                              <Option key={p.id} value={p.id} label={`${p.name}${p.attributes?.style ? ` (${p.attributes.style})` : ''}`}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{p.name} {p.attributes?.style && `(${p.attributes.style})`}</span>
                                </div>
                              </Option>
                            ))}
                          </Select>
                        )}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item
                        shouldUpdate={(prev, curr) => {
                            return prev.items?.[name]?.max_qty !== curr.items?.[name]?.max_qty || prev.items?.[name]?.selected !== curr.items?.[name]?.selected;
                        }}
                        style={{ marginBottom: 0 }}
                      >
                        {() => {
                            const isSelected = form.getFieldValue(['items', name, 'selected']);
                            const maxQty = form.getFieldValue(['items', name, 'max_qty']);
                            return (
                                <Form.Item
                                    {...restField}
                                    name={[name, 'quantity']}
                                    rules={[{ required: true, message: '數量' }]}
                                    style={{ marginBottom: 0 }}
                                >
                                    {isViewMode ? <ReadOnlyText /> : (
                                        <InputNumber 
                                            min={1} 
                                            max={maxQty} 
                                            disabled={!isSelected} 
                                            placeholder="數量" 
                                            style={{ width: '100%' }} 
                                            addonAfter={maxQty ? `/ ${maxQty}` : undefined}
                                        />
                                    )}
                                </Form.Item>
                            );
                        }}
                      </Form.Item>
                    </Col>
                    <Col span={3}>
                      <Form.Item
                        shouldUpdate={(prev, curr) => prev.items?.[name]?.selected !== curr.items?.[name]?.selected}
                        style={{ marginBottom: 0 }}
                      >
                        {() => {
                             const isSelected = form.getFieldValue(['items', name, 'selected']);
                             return (
                                <Form.Item
                                    {...restField}
                                    name={[name, 'unit_price']}
                                    rules={[{ required: true, message: '單價' }]}
                                    style={{ marginBottom: 0 }}
                                >
                                    {isViewMode ? <ReadOnlyText mapFn={v => `$${v}`} /> : <InputNumber min={0} disabled={!isSelected} placeholder="單價" prefix="$" style={{ width: '100%' }} />}
                                </Form.Item>
                             );
                        }}
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                        <Form.Item
                            shouldUpdate={(prev, curr) => prev.items?.[name]?.selected !== curr.items?.[name]?.selected}
                            style={{ marginBottom: 0 }}
                        >
                            {() => {
                                const isSelected = form.getFieldValue(['items', name, 'selected']);
                                return (
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'reason']}
                                        style={{ marginBottom: 0 }}
                                    >
                                        {isViewMode ? <ReadOnlyText /> : <TextArea disabled={!isSelected} rows={2} placeholder="退貨原因" />}
                                    </Form.Item>
                                );
                            }}
                        </Form.Item>
                    </Col>
                    <Col span={3}>
                        <Form.Item
                            shouldUpdate={(prev, curr) => {
                                const prevItem = prev.items?.[name];
                                const currItem = curr.items?.[name];
                                return prevItem?.quantity !== currItem?.quantity || prevItem?.unit_price !== currItem?.unit_price;
                            }}
                            style={{ marginBottom: 0, paddingTop: 6 }}
                        >
                            {() => {
                                const qty = form.getFieldValue(['items', name, 'quantity']) || 0;
                                const price = form.getFieldValue(['items', name, 'unit_price']) || 0;
                                return <span style={isViewMode ? { fontWeight: 500, fontSize: '15px' } : {}}>${(qty * price).toLocaleString()}</span>;
                            }}
                        </Form.Item>
                    </Col>
                    <Col span={1} style={{ textAlign: 'center', paddingTop: 6 }}>
                      {!isViewMode && !form.getFieldValue('order_id') && <MinusCircleOutlined onClick={() => remove(name)} style={{ color: '#B25B4C', cursor: 'pointer' }} />}
                    </Col>
                  </Row>
                  
                  {/* Upload Controls Row */}
                  <Row gutter={16} style={{ marginTop: 8 }}>
                     <Col span={24}>
                         <Form.Item shouldUpdate={(prev, curr) => {
                             return prev.items?.[name]?.selected !== curr.items?.[name]?.selected || prev.items?.[name]?.product_id !== curr.items?.[name]?.product_id;
                         }}>
                             {() => {
                                 const isSelected = form.getFieldValue(['items', name, 'selected']);
                                 if (!isSelected && !isViewMode) return null;

                                 const productId = form.getFieldValue(['items', name, 'product_id']);
                                 const product = products?.find((p: any) => p.id === productId);
                                 const allItems = form.getFieldValue('items') || [];
                                 
                                 // Find first index of this product that is SELECTED
                                 // (If user returns multiple of same product with different reasons, maybe we want to allow upload for each?
                                 // But requirement says "same product name upload once".
                                 // However, in Return, we usually just have one line per product from the order.
                                 // If manual add, maybe duplicates.
                                 // Let's stick to "First index of this product" logic for consistency.)
                                 
                                 const firstIndexWithName = allItems.findIndex((i: any) => {
                                     const p = products?.find((p: any) => p.id === i.product_id);
                                     return p?.name === product?.name;
                                 });
                                 
                                 const showUpload = name === firstIndexWithName;

                                 if (isViewMode) {
                                     const img = form.getFieldValue(['items', name, 'return_image']);
                                     const vid = form.getFieldValue(['items', name, 'return_video']);
                                     if (!img && !vid) return null;
                                     return (
                                         <Space size="large" style={{ marginLeft: 40 }}>
                                             {img && (
                                                 <div>
                                                     <span style={{ marginRight: 8 }}>退貨照片:</span>
                                                     <img src={img} alt="return" style={{ maxHeight: 100, verticalAlign: 'middle' }} />
                                                     <Button type="link" href={img} target="_blank">下載</Button>
                                                 </div>
                                             )}
                                             {vid && (
                                                 <div>
                                                     <span style={{ marginRight: 8 }}>退貨影片:</span>
                                                     <a href={vid} target="_blank" rel="noreferrer">查看影片</a>
                                                 </div>
                                             )}
                                         </Space>
                                     );
                                 }

                                 if (!productId) return null;
                                 
                                 if (!showUpload) {
                                     return <div style={{ color: '#999', fontSize: 12, paddingLeft: 40 }}>* 照片/影片將使用同名商品之上傳檔案</div>;
                                 }

                                 return (
                                     <Space size="middle" style={{ paddingLeft: 40 }}>
                                         <Form.Item
                                              {...restField}
                                              name={[name, 'return_image']}
                                              label="退貨照片"
                                              style={{ marginBottom: 0 }}
                                          >
                                              <UploadWrapper
                                                  action={UPLOAD_URL}
                                                  listType="picture"
                                                  maxCount={1}
                                                  accept="image/*"
                                                  name="file" // Add name="file"
                                                  onSuccess={(url?: string) => {
                                                      const items = form.getFieldValue('items');
                                                      items.forEach((i: any, idx: number) => {
                                                          const p = products?.find((p: any) => p.id === i.product_id);
                                                          if (p?.name === product?.name) {
                                                              items[idx].return_image = url;
                                                          }
                                                      });
                                                      form.setFieldsValue({ items });
                                                      if (url) message.success('圖片上傳成功 (已套用至同商品)');
                                                  }}
                                                  onError={() => message.error('圖片上傳失敗')}
                                                  defaultFileList={
                                                      form.getFieldValue(['items', name, 'return_image']) ? [
                                                          {
                                                              uid: '-1',
                                                              name: 'image.png',
                                                              status: 'done',
                                                              url: form.getFieldValue(['items', name, 'return_image']),
                                                          }
                                                      ] : []
                                                  }
                                              >
                                                  <Button icon={<UploadOutlined />} size="small">上傳照片</Button>
                                              </UploadWrapper>
                                          </Form.Item>

                                          <Form.Item
                                              {...restField}
                                              name={[name, 'return_video']}
                                              label="退貨影片"
                                              style={{ marginBottom: 0 }}
                                          >
                                              <UploadWrapper
                                                  action={UPLOAD_URL}
                                                  maxCount={1}
                                                  accept="video/*"
                                                  name="file" // Add name="file"
                                                  onSuccess={(url?: string) => {
                                                      const items = form.getFieldValue('items');
                                                      items.forEach((i: any, idx: number) => {
                                                          const p = products?.find((p: any) => p.id === i.product_id);
                                                          if (p?.name === product?.name) {
                                                              items[idx].return_video = url;
                                                          }
                                                      });
                                                      form.setFieldsValue({ items });
                                                      if (url) message.success('影片上傳成功 (已套用至同商品)');
                                                  }}
                                                  onError={() => message.error('影片上傳失敗')}
                                                  defaultFileList={
                                                      form.getFieldValue(['items', name, 'return_video']) ? [
                                                          {
                                                              uid: '-1',
                                                              name: 'video.mp4',
                                                              status: 'done',
                                                              url: form.getFieldValue(['items', name, 'return_video']),
                                                          }
                                                      ] : []
                                                  }
                                              >
                                                  <Button icon={<UploadOutlined />} size="small">上傳影片</Button>
                                              </UploadWrapper>
                                          </Form.Item>
                                     </Space>
                                 );
                             }}
                         </Form.Item>
                     </Col>
                  </Row>
                  </div>
                ))}
                
                {/* Prompt when empty - removed duplicate */}
                
                <div style={{ textAlign: 'right', marginTop: 16, marginBottom: 0, paddingRight: 32 }}>
                   <Form.Item shouldUpdate style={{ marginBottom: 0 }}>
                     {() => {
                       const items = form.getFieldValue('items') || [];
                       const total = items.reduce((sum: number, item: any) => {
                         if (!item.selected) return sum;
                         const qty = item?.quantity || 0;
                         const price = item?.unit_price || 0;
                         return sum + (qty * price);
                       }, 0);
                       return (
                         <Space size="large">
                            <Title level={4} style={{ margin: 0 }}>總退款金額: ${total.toLocaleString()}</Title>
                         </Space>
                       );
                     }}
                   </Form.Item>
                </div>
              </>
            )}
          </Form.List>
          </div>
        </Form>
      </Modal>
    </div>
  );
};

export default ReturnList;
