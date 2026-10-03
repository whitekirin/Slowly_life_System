import React, { useState, useEffect } from 'react';
import { Table, Button, message, Tag, Typography, Modal, Descriptions, Form, InputNumber, Upload, Input, Row, Col, Tabs, Collapse, Alert, Select, Checkbox } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getPurchaseOrders, updatePurchaseOrder, getProducts, UPLOAD_URL, getOutstandingShortages, createSupplementaryReceiving } from '../api';
import { CheckCircleOutlined, UploadOutlined, PlusOutlined } from '@ant-design/icons';
import { useUser } from '../contexts/UserContext';
import { VoidStatusTag, voidRowStyle } from '../components/VoidOrder';

const { Title } = Typography;

// 實收少於採購數量時必選的短收原因（跟盤點的 SHORTAGE_REASONS 同一個概念，選項換成進貨情境）
const RECEIVING_SHORTAGE_REASONS = ['供應商少寄／缺貨', '運送途中遺失', '商品損壞／瑕疵', '規格或款式不符', '其他'];

const ProductImage = ({ src, name }: { src?: string, name: string }) => {
    const [error, setError] = useState(false);

    if (!src || error) {
        return (
            <div style={{ width: 50, height: 50, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>
                <small style={{ color: '#999', fontSize: 10 }}>無圖片</small>
            </div>
        );
    }

    return (
        <img 
            src={src} 
            alt={name} 
            style={{ width: 50, height: 50, objectFit: 'cover', borderRadius: 4, display: 'block' }} 
            onError={() => setError(true)}
        />
    );
};

const UploadWrapper = ({ value, ...props }: any) => <Upload {...props} />;

const Receiving: React.FC = () => {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [mode, setMode] = useState<'receiving' | 'view'>('receiving');
  const [currentPO, setCurrentPO] = useState<any>(null);
  const [form] = Form.useForm();
  const watchedItems = Form.useWatch('items', form);
  const { hasPermission } = useUser();
  const canReceive = hasPermission('edit_receiving');
  const canCreateSupplement = hasPermission('create_supplementary_receivings');

  const { data: pos, isLoading } = useQuery({ queryKey: ['purchase_orders'], queryFn: getPurchaseOrders });
  const { data: products } = useQuery({ queryKey: ['products'], queryFn: getProducts });
  const { data: outstanding } = useQuery({ queryKey: ['supplementary_receivings', 'outstanding'], queryFn: getOutstandingShortages });
  const navigate = useNavigate();

  // 補驗收單只能從這裡建立：有短收還沒補齊的已驗收採購單才顯示按鈕
  const createSupplementMutation = useMutation({
    mutationFn: createSupplementaryReceiving,
    onSuccess: (sr: any) => {
      message.success(`已建立補驗收單 SR-${sr.id}，並已通知管理員`);
      queryClient.invalidateQueries({ queryKey: ['supplementary_receivings'] });
      navigate('/supplementary-receiving');
    },
    onError: (error: any) => {
      message.error(error?.response?.data?.detail || '建立補驗收單失敗');
    },
  });

  const confirmCreateSupplement = (po: any) => {
    const entry = outstanding?.find((o: any) => o.po_id === po.id);
    if (!entry) return;
    Modal.confirm({
      title: `為 PO-${po.id} 建立補驗收單？`,
      content: (
        <div>
          <p>以下短收品項會列入補驗收單，建立後會通知管理員：</p>
          <ul style={{ paddingLeft: 20, margin: 0 }}>
            {entry.items.map((i: any) => {
              const p = products?.find((prod: any) => prod.id === i.product_id);
              return <li key={i.product_id}>{p ? `${p.name}（${p.sku}）` : `商品 #${i.product_id}`}：待補 {i.remaining_quantity}</li>;
            })}
          </ul>
        </div>
      ),
      okText: '建立補驗收單',
      cancelText: '取消',
      onOk: () => createSupplementMutation.mutateAsync(po.id),
    });
  };

  // Filter POs
  const pendingPOs = pos?.filter((po: any) => po.status === 'completed');
  const historyPOs = pos?.filter((po: any) => po.status === 'received');

  const mutation = useMutation({
    mutationFn: updatePurchaseOrder,
    onSuccess: (_data: any, variables: any) => {
      const supplemented = variables?.data?.items?.some((i: any) => i.create_supplementary);
      message.success(supplemented ? '已完成進貨入庫，並已建立補驗收單、通知管理員' : '已完成進貨入庫');
      setIsModalOpen(false);
      setCurrentPO(null);
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['supplementary_receivings'] });
    },
    onError: (error: any) => {
        message.error(error?.response?.data?.detail || '入庫失敗');
    }
  });

  const handleOpenModal = (po: any, currentMode: 'receiving' | 'view' = 'receiving') => {
    setCurrentPO(po);
    setMode(currentMode);
    setIsModalOpen(true);
  };

  // Update form values when modal opens or currentPO changes
  useEffect(() => {
    if (isModalOpen && currentPO) {
        // Filter items to only show confirmed ones
        const confirmedItems = currentPO.items.filter((item: any) => {
            const product = products?.find((p: any) => p.id === item.product_id);
            return product?.is_confirmed === true;
        });

        const initialValues = {
            items: confirmedItems.map((item: any) => ({
                ...item,
                received_quantity: item.received_quantity ?? item.quantity, // Use existing received_quantity if available, else default to ordered
                note: item.note, // Load existing note from PO
                receiving_image: item.receiving_image,
                receiving_video: item.receiving_video
            }))
        };
        form.setFieldsValue(initialValues);
    }
  }, [isModalOpen, currentPO, form]); // Removed products to avoid reset on background refetch
  
  const handleOk = async () => {
      try {
          const values = await form.validateFields();
          
          // Filter only confirmed items
          const confirmedItems = currentPO.items.filter((item: any) => {
              const product = products?.find((p: any) => p.id === item.product_id);
              return product?.is_confirmed === true;
          });

          // Map the form values back to the confirmed items
          const updatedConfirmedItems = confirmedItems.map((item: any, index: number) => {
              const v = values.items[index];
              const isShort = v.received_quantity < item.quantity;
              return {
                  product_id: item.product_id,
                  quantity: item.quantity,
                  unit_price: item.unit_price,
                  received_quantity: v.received_quantity,
                  note: v.note,
                  // 短收原因後端會再檢查一次，入庫時彙整通知所有 admin
                  shortage_reason: isShort ? `${v.shortage_type}：${v.shortage_detail.trim()}` : null,
                  create_supplementary: isShort && !!v.create_supplementary,
                  receiving_image: v.receiving_image,
                  receiving_video: v.receiving_video
              };
          });
          
          mutation.mutate({ 
              id: currentPO.id, 
              data: { 
                  status: 'received',
                  items: updatedConfirmedItems
              } 
          });
      } catch (e: any) {
          console.error(e);
          const shortMissing = e?.errorFields?.some((f: any) => ['shortage_type', 'shortage_detail'].includes(f.name?.[2]));
          message.error(shortMissing ? '有品項實收少於採購數量，請填寫短收原因' : '驗收失敗，請檢查輸入資料');
      }
  };

  const columns = [
    { title: '訂單編號', dataIndex: 'id', key: 'id', render: (id: number) => `PO-${id}` },
    { title: '供應商', dataIndex: 'supplier_name', key: 'supplier_name' },
    // total_amount 是人民幣訂貨金額（同採購單的「總訂貨金額(RMB)」）
    { title: '總訂貨金額(RMB)', dataIndex: 'total_amount', key: 'total_amount', render: (val: number) => `¥${Number(val || 0).toFixed(2)}` },
    { title: '訂單日期', dataIndex: 'order_date', key: 'order_date', render: (date: string) => new Date(date).toLocaleDateString() },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string, record: any) => (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Tag color="geekblue">{status.toUpperCase()}</Tag>
          <VoidStatusTag record={record} />
        </div>
      )
    },
    {
      title: '操作',
      key: 'action',
      // 報廢審核中／已報廢的採購單留在清單上，但不能驗收
      render: (_: any, record: any) => (
        canReceive && !record.void_status ? (
          <Button 
              type="primary" 
              icon={<CheckCircleOutlined />} 
              onClick={() => handleOpenModal(record, 'receiving')}
          >
              驗收入庫
          </Button>
        ) : (
          <Button onClick={() => handleOpenModal(record, 'view')}>查看詳情</Button>
        )
      ),
    },
  ];

  const getProductDetails = (id: number) => products?.find((p: any) => p.id === id);

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2} style={{ marginBottom: 24 }}>進貨驗收作業</Title>
      
      <Tabs defaultActiveKey="1" items={[
        {
            key: '1',
            label: '待驗收',
            children: (
                <Table 
                    dataSource={pendingPOs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isLoading} 
                    pagination={{ pageSize: 5 }}
                    locale={{ emptyText: '目前沒有待驗收的採購單' }}
                />
            )
        },
        {
            key: '2',
            label: '驗收紀錄',
            children: (
                <Table 
                    dataSource={historyPOs} 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    columns={[
                        ...columns.filter(c => c.key !== 'action'),
                        { title: '驗收人', dataIndex: 'received_by', key: 'received_by' },
                        { 
                            title: '操作', 
                            key: 'action', 
                            render: (_: any, record: any) => (
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <Button onClick={() => handleOpenModal(record, 'view')}>查看詳情</Button>
                                    {canCreateSupplement && outstanding?.some((o: any) => o.po_id === record.id) && (
                                        <Button danger onClick={() => confirmCreateSupplement(record)}>建立補驗收單</Button>
                                    )}
                                </div>
                            )
                        }
                    ]} 
                    rowKey="id" 
                    loading={isLoading} 
                    pagination={{ pageSize: 5 }}
                />
            )
        }
      ]} />

      <Modal
        title={`${mode === 'receiving' ? '驗收確認' : '驗收詳情'} - PO-${currentPO?.id}`}
        open={isModalOpen}
        onOk={mode === 'receiving' ? handleOk : () => setIsModalOpen(false)}
        onCancel={() => setIsModalOpen(false)}
        width={900}
        okText={mode === 'receiving' ? "確認入庫" : "關閉"}
        cancelText="取消"
        cancelButtonProps={{ style: { display: mode === 'view' ? 'none' : 'inline-block' } }}
        confirmLoading={mutation.isPending}
        destroyOnHidden
      >
        {currentPO && (
            <Form form={form} component={false}>
                <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }} style={{ marginBottom: 16 }}>
                    <Descriptions.Item label="供應商">{currentPO.supplier_name}</Descriptions.Item>
                    <Descriptions.Item label="訂單日期">{new Date(currentPO.order_date).toLocaleDateString()}</Descriptions.Item>
                </Descriptions>
                
                <Form.List name="items">
                    {(fields) => (
                        <Collapse
                            defaultActiveKey={fields.map(f => f.key)}
                            items={fields.map(({ key, name, ...restField }) => {
                                    const item = form.getFieldValue(['items', name]);
                                    const product = getProductDetails(item.product_id);
                                    
                                    // Check if this is the first item with this name to show upload controls
                                    // Or better: Group by name visually?
                                    // The user said: "Same product name, just upload once".
                                    // We need to find all indices of items with the same product NAME in the form values.
                                    
                                    const allItems = form.getFieldValue('items');
                                    const sameNameItems = allItems.filter((i: any) => {
                                        const p = getProductDetails(i.product_id);
                                        return p?.name === product?.name;
                                    });
                                    
                                    const isFirstOfName = sameNameItems[0]?.product_id === item.product_id && 
                                                          allItems.findIndex((i: any) => i.product_id === item.product_id) === name; 
                                    // Wait, field.name is the index in the list.
                                    
                                    // Let's simplify: Just find the first index in the *current list* that has this product name.
                                    const firstIndexWithName = allItems.findIndex((i: any) => {
                                        const p = getProductDetails(i.product_id);
                                        return p?.name === product?.name;
                                    });
                                    
                                    const showUpload = name === firstIndexWithName;
                                    const liveReceived = watchedItems?.[name]?.received_quantity;
                                    const shortBy = mode === 'receiving'
                                        ? (liveReceived != null && liveReceived < item.quantity ? item.quantity - liveReceived : 0)
                                        : (item.received_quantity != null && item.received_quantity < item.quantity ? item.quantity - item.received_quantity : 0);

                                    const header = (
                                    <div className="sl-rcv-head">
                                        <div className="sl-rcv-info">
                                            <ProductImage src={product?.image_url} name={product?.name || 'Product'} />
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ fontWeight: 'bold' }}>{product?.sku}</div>
                                                <div style={{ fontSize: 12, color: '#666' }}>{product?.name}</div>
                                                {(product?.attributes?.style || product?.attributes?.size) && (
                                                    <div style={{ fontSize: 12, color: '#8B6545' }}>
                                                        {product?.attributes?.style && <Tag color="blue">{product.attributes.style}</Tag>}
                                                        {product?.attributes?.size && <Tag color="cyan">{product.attributes.size}</Tag>}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="sl-rcv-qty">
                                            {shortBy > 0 && <Tag color="red">短收 {shortBy}</Tag>}
                                            <div style={{ textAlign: 'right' }}>
                                                <div style={{ fontSize: 12, color: '#999' }}>採購數量</div>
                                                <div style={{ fontWeight: 'bold' }}>{item.quantity}</div>
                                            </div>
                                            <div style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ fontSize: 12, color: '#999' }}>實際驗收</div>
                                                {mode === 'receiving' ? (
                                                    <Form.Item
                                                        {...restField}
                                                        name={[name, 'received_quantity']}
                                                        rules={[
                                                            { required: true, message: '必填' },
                                                            {
                                                                validator: (_, value) =>
                                                                    value == null || value <= item.quantity
                                                                        ? Promise.resolve()
                                                                        : Promise.reject(new Error(`不可超過採購數量（${item.quantity}）`)),
                                                            },
                                                        ]}
                                                        style={{ margin: 0 }}
                                                    >
                                                        <InputNumber min={0} max={item.quantity} style={{ width: 100 }} />
                                                    </Form.Item>
                                                ) : (
                                                    <div style={{ fontWeight: 'bold', color: '#8B6545', fontSize: 16 }}>
                                                        {item.received_quantity}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );

                                return {
                                    key: key,
                                    label: header,
                                    children: (
                                        <div className="sl-rcv-body">
                                            {mode === 'receiving' ? (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                                    {shortBy > 0 && (
                                                        <div style={{ border: '1px solid #ffccc7', background: '#fff2f0', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                                                            <Alert
                                                                type="error"
                                                                showIcon
                                                                title={`實際驗收比採購數量少 ${shortBy}，請填寫短收原因，確認入庫後會通知管理員。`}
                                                            />
                                                            <Form.Item
                                                                {...restField}
                                                                name={[name, 'shortage_type']}
                                                                label="短收原因"
                                                                rules={[{ required: true, message: '請選擇短收原因' }]}
                                                                style={{ margin: 0 }}
                                                            >
                                                                <Select placeholder="請選擇" options={RECEIVING_SHORTAGE_REASONS.map((r) => ({ label: r, value: r }))} />
                                                            </Form.Item>
                                                            <Form.Item
                                                                {...restField}
                                                                name={[name, 'shortage_detail']}
                                                                label="原因說明"
                                                                rules={[{ required: true, whitespace: true, message: '請填寫原因說明' }]}
                                                                style={{ margin: 0 }}
                                                            >
                                                                <Input.TextArea rows={2} maxLength={200} showCount placeholder="例如：供應商說下批補寄、外箱破損 2 件…" />
                                                            </Form.Item>
                                                            {canCreateSupplement && (
                                                            <Form.Item
                                                                {...restField}
                                                                name={[name, 'create_supplementary']}
                                                                valuePropName="checked"
                                                                style={{ margin: 0 }}
                                                            >
                                                                <Checkbox>建立補驗收單（供應商會補寄這 {shortBy} 件，入庫後同時建立並通知管理員）</Checkbox>
                                                            </Form.Item>
                                                            )}
                                                        </div>
                                                    )}
                                                    <Form.Item
                                                        {...restField}
                                                        name={[name, 'note']}
                                                        label="驗收備註"
                                                        style={{ margin: 0 }}
                                                    >
                                                        <Input.TextArea placeholder="請輸入驗收備註" rows={2} />
                                                    </Form.Item>
                                                    {showUpload && (
                                                        <Row gutter={[16, 16]}>
                                                            <Col xs={24} sm={12}>
                                                                <Form.Item
                                                                    {...restField}
                                                                    name={[name, 'receiving_image']}
                                                                    label="上傳照片 (同商品共用)"
                                                                    style={{ margin: 0 }}
                                                                    rules={[{ required: true, message: '請上傳照片' }]}
                                                                >
                                                                    <UploadWrapper
                                                                        action={UPLOAD_URL}
                                                                        listType="picture"
                                                                        maxCount={1}
                                                                        accept="image/*"
                                                                        onChange={(info: any) => {
                                                                            if (info.file.status === 'done') {
                                                                                const url = info.file.response.url;
                                                                                const items = form.getFieldValue('items');
                                                                                // Update all items with same product name
                                                                                items.forEach((i: any, idx: number) => {
                                                                                    const p = getProductDetails(i.product_id);
                                                                                    if (p?.name === product?.name) {
                                                                                        items[idx].receiving_image = url;
                                                                                    }
                                                                                });
                                                                                form.setFieldsValue({ items });
                                                                                message.success('圖片上傳成功 (已套用至同商品)');
                                                                            } else if (info.file.status === 'removed') {
                                                                                // Clicking the file list's remove icon only took the
                                                                                // thumbnail out of Upload's own list — this field is a
                                                                                // plain URL string, not a fileList, so it never got
                                                                                // cleared without this branch (the old URL would keep
                                                                                // silently getting submitted after "deleting" the photo).
                                                                                const items = form.getFieldValue('items');
                                                                                items.forEach((i: any, idx: number) => {
                                                                                    const p = getProductDetails(i.product_id);
                                                                                    if (p?.name === product?.name) {
                                                                                        items[idx].receiving_image = undefined;
                                                                                    }
                                                                                });
                                                                                form.setFieldsValue({ items });
                                                                            }
                                                                        }}
                                                                        defaultFileList={
                                                                            item.receiving_image ? [
                                                                                {
                                                                                    uid: '-1',
                                                                                    name: 'image.png',
                                                                                    status: 'done',
                                                                                    url: item.receiving_image,
                                                                                }
                                                                            ] : []
                                                                        }
                                                                    >
                                                                        <Button icon={<UploadOutlined />}>上傳照片</Button>
                                                                    </UploadWrapper>
                                                                </Form.Item>
                                                            </Col>
                                                            <Col xs={24} sm={12}>
                                                                <Form.Item
                                                                    {...restField}
                                                                    name={[name, 'receiving_video']}
                                                                    label="上傳影片 (同商品共用)"
                                                                    style={{ margin: 0 }}
                                                                    rules={[{ required: true, message: '請上傳影片' }]}
                                                                >
                                                                    <UploadWrapper 
                                                                        action={UPLOAD_URL}
                                                                        maxCount={1}
                                                                        accept="video/*"
                                                                        onChange={(info: any) => {
                                                                            if (info.file.status === 'done') {
                                                                                const url = info.file.response.url;
                                                                                const items = form.getFieldValue('items');
                                                                                // Update all items with same product name
                                                                                items.forEach((i: any, idx: number) => {
                                                                                    const p = getProductDetails(i.product_id);
                                                                                    if (p?.name === product?.name) {
                                                                                        items[idx].receiving_video = url;
                                                                                    }
                                                                                });
                                                                                form.setFieldsValue({ items });
                                                                                message.success('影片上傳成功 (已套用至同商品)');
                                                                            } else if (info.file.status === 'removed') {
                                                                                const items = form.getFieldValue('items');
                                                                                items.forEach((i: any, idx: number) => {
                                                                                    const p = getProductDetails(i.product_id);
                                                                                    if (p?.name === product?.name) {
                                                                                        items[idx].receiving_video = undefined;
                                                                                    }
                                                                                });
                                                                                form.setFieldsValue({ items });
                                                                            }
                                                                        }}
                                                                        defaultFileList={
                                                                            item.receiving_video ? [
                                                                                {
                                                                                    uid: '-1',
                                                                                    name: 'video.mp4',
                                                                                    status: 'done',
                                                                                    url: item.receiving_video,
                                                                                }
                                                                            ] : []
                                                                        }
                                                                    >
                                                                        <Button icon={<UploadOutlined />}>上傳影片</Button>
                                                                    </UploadWrapper>
                                                                </Form.Item>
                                                            </Col>
                                                        </Row>
                                                    )}
                                                    {!showUpload && (
                                                        <div style={{ color: '#999', fontSize: 12 }}>
                                                            * 照片/影片已在上方同名商品處上傳
                                                        </div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                                                    {item.shortage_reason && (
                                                        <div>
                                                            <Typography.Text type="danger">短收原因:</Typography.Text>
                                                            <div style={{ marginTop: 4 }}>{item.shortage_reason}</div>
                                                        </div>
                                                    )}
                                                    {item.note && (
                                                        <div>
                                                            <Typography.Text type="secondary">備註:</Typography.Text>
                                                            <div style={{ marginTop: 4 }}>{item.note}</div>
                                                        </div>
                                                    )}
                                                    
                                                    <Row gutter={[16, 16]}>
                                                        {item.receiving_image && (
                                                            <Col xs={24} sm={12}>
                                                                <div style={{ marginBottom: 4 }}>照片:</div>
                                                                <img 
                                                                    src={item.receiving_image} 
                                                                    alt="Receiving" 
                                                                    style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', border: '1px solid #eee', borderRadius: 4 }} 
                                                                />
                                                                <div style={{ marginTop: 8 }}>
                                                                    <Button size="small" type="link" href={item.receiving_image} target="_blank" download>
                                                                        下載照片
                                                                    </Button>
                                                                </div>
                                                            </Col>
                                                        )}
                                                        {item.receiving_video && (
                                                            <Col xs={24} sm={12}>
                                                                <div style={{ marginBottom: 4 }}>影片:</div>
                                                                <video 
                                                                    src={item.receiving_video} 
                                                                    controls 
                                                                    style={{ maxWidth: '100%', maxHeight: '200px', borderRadius: 4 }} 
                                                                />
                                                                <div style={{ marginTop: 8 }}>
                                                                    <Button size="small" type="link" href={item.receiving_video} target="_blank" download>
                                                                        下載影片
                                                                    </Button>
                                                                </div>
                                                            </Col>
                                                        )}
                                                    </Row>
                                                    
                                                    {!item.receiving_image && !item.receiving_video && !item.note && !item.shortage_reason && (
                                                        <div style={{ color: '#ccc', textAlign: 'center', padding: '12px 0' }}>
                                                            無補充資訊
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                };
                            })}
                        />
                    )}
                </Form.List>
            </Form>
        )}
      </Modal>
    </div>
  );
};

export default Receiving;
