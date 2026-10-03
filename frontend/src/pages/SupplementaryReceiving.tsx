import React, { useState } from 'react';
import { Table, Button, message, Tag, Typography, Modal, Descriptions, Form, InputNumber, Upload, Input, Tabs, Card, Alert, Select, Row, Col, Checkbox } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSupplementaryReceivings, receiveSupplementaryReceiving, UPLOAD_URL } from '../api';
import { CheckCircleOutlined, UploadOutlined } from '@ant-design/icons';

import { useUser } from '../contexts/UserContext';
const { Title, Text } = Typography;

// 跟 Receiving.tsx 的短收原因同一組選項
const RECEIVING_SHORTAGE_REASONS = ['供應商少寄／缺貨', '運送途中遺失', '商品損壞／瑕疵', '規格或款式不符', '其他'];

// 表單值就是上傳後的 URL 字串；移除檔案時清成 undefined（不是只拿掉縮圖）
const UrlUpload = ({ value, onChange, accept, label }: { value?: string; onChange?: (v?: string) => void; accept: string; label: string }) => (
    <Upload
        action={UPLOAD_URL}
        maxCount={1}
        accept={accept}
        listType={accept.startsWith('image') ? 'picture' : 'text'}
        defaultFileList={value ? [{ uid: '-1', name: label, status: 'done', url: value }] : []}
        onChange={(info) => {
            if (info.file.status === 'done') onChange?.(info.file.response.url);
            else if (info.file.status === 'removed') onChange?.(undefined);
            else if (info.file.status === 'error') message.error(`${label}上傳失敗`);
        }}
    >
        <Button icon={<UploadOutlined />}>上傳{label}</Button>
    </Upload>
);

const productLabel = (item: any) => item.product ? `${item.product.name}（${item.product.sku}）` : `商品 #${item.product_id}`;

const SupplementaryReceiving: React.FC = () => {
  const { hasPermission } = useUser();
  const canReceive = hasPermission('edit_supplementary_receivings');
  const canCreate = hasPermission('create_supplementary_receivings');
    const queryClient = useQueryClient();
    const [current, setCurrent] = useState<any>(null);
    const [mode, setMode] = useState<'receiving' | 'view'>('receiving');
    const [form] = Form.useForm();
    const watchedItems = Form.useWatch('items', form);

    const { data: srs, isLoading } = useQuery({ queryKey: ['supplementary_receivings'], queryFn: getSupplementaryReceivings });
    const pending = srs?.filter((sr: any) => sr.status === 'pending');
    const history = srs?.filter((sr: any) => sr.status === 'received');

    const mutation = useMutation({
        mutationFn: receiveSupplementaryReceiving,
        onSuccess: (_data: any, variables: any) => {
            const supplemented = variables?.items?.some((i: any) => i.create_supplementary);
            message.success(supplemented ? '補驗收已入庫，並已再建立補驗收單、通知管理員' : '補驗收已入庫');
            setCurrent(null);
            queryClient.invalidateQueries({ queryKey: ['supplementary_receivings'] });
            queryClient.invalidateQueries({ queryKey: ['products'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        },
        onError: (error: any) => {
            message.error(error?.response?.data?.detail || '補驗收入庫失敗');
        },
    });

    const open = (sr: any, m: 'receiving' | 'view') => {
        setMode(m);
        setCurrent(sr);
    };

    const handleOk = async () => {
        try {
            const values = await form.validateFields();
            mutation.mutate({
                id: current.id,
                items: current.items.map((item: any, idx: number) => {
                    const v = values.items[idx];
                    return {
                        id: item.id,
                        received_quantity: v.received_quantity,
                        note: v.note,
                        // 後端會再檢查一次，仍短收時通知管理員
                        shortage_reason: v.received_quantity < item.quantity ? `${v.shortage_type}：${v.shortage_detail.trim()}` : null,
                        create_supplementary: v.received_quantity < item.quantity && !!v.create_supplementary,
                        receiving_image: v.receiving_image,
                        receiving_video: v.receiving_video,
                    };
                }),
            });
        } catch (e: any) {
            const shortMissing = e?.errorFields?.some((f: any) => ['shortage_type', 'shortage_detail'].includes(f.name?.[2]));
            message.error(shortMissing ? '有品項實收少於待補數量，請填寫短收原因' : '驗收失敗，請檢查輸入資料');
        }
    };

    const columns: any[] = [
        { title: '補驗收單', dataIndex: 'id', key: 'id', render: (id: number) => `SR-${id}` },
        { title: '原採購單', dataIndex: 'po_id', key: 'po_id', render: (id: number) => `PO-${id}` },
        { title: '供應商', dataIndex: 'supplier_name', key: 'supplier_name' },
        {
            title: '待補品項', key: 'items',
            render: (_: any, sr: any) => sr.items.map((i: any) => `${i.product?.name ?? `#${i.product_id}`} ×${i.quantity}`).join('、'),
        },
        { title: '建立人', dataIndex: 'created_by_name', key: 'created_by_name' },
        { title: '建立時間', dataIndex: 'created_at', key: 'created_at', render: (d: string) => new Date(d).toLocaleString() },
    ];

    const pendingColumns = [
        ...columns,
        {
            title: '操作', key: 'action',
            render: (_: any, sr: any) => canReceive
                ? <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => open(sr, 'receiving')}>補驗收入庫</Button>
                : <Button onClick={() => open(sr, 'view')}>查看詳情</Button>,
        },
    ];

    const historyColumns = [
        ...columns,
        { title: '驗收人', dataIndex: 'received_by_name', key: 'received_by_name' },
        {
            title: '結果', key: 'result',
            render: (_: any, sr: any) => sr.items.some((i: any) => (i.received_quantity ?? 0) < i.quantity)
                ? <Tag color="red">仍有短收</Tag>
                : <Tag color="green">已補齊</Tag>,
        },
        { title: '操作', key: 'action', render: (_: any, sr: any) => <Button onClick={() => open(sr, 'view')}>查看詳情</Button> },
    ];

    return (
        <div style={{ padding: 24 }}>
            <Title level={2} style={{ marginBottom: 8 }}>補驗收單</Title>
            <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
                補驗收單由「進貨驗收 → 驗收紀錄」中有短收的採購單建立，這裡只處理補收入庫。
            </Text>

            <Tabs defaultActiveKey="pending" items={[
                {
                    key: 'pending', label: `待補驗收${pending?.length ? `（${pending.length}）` : ''}`,
                    children: <Table dataSource={pending} columns={pendingColumns} rowKey="id" loading={isLoading} pagination={{ pageSize: 10 }} scroll={{ x: true }} locale={{ emptyText: '目前沒有待補驗收的單據' }} />,
                },
                {
                    key: 'history', label: '補驗收紀錄',
                    children: <Table dataSource={history} columns={historyColumns} rowKey="id" loading={isLoading} pagination={{ pageSize: 10 }} scroll={{ x: true }} />,
                },
            ]} />

            <Modal
                title={current ? `${mode === 'receiving' ? '補驗收確認' : '補驗收詳情'} - SR-${current.id}（PO-${current.po_id}）` : ''}
                open={!!current}
                onOk={mode === 'receiving' ? handleOk : () => setCurrent(null)}
                onCancel={() => setCurrent(null)}
                okText={mode === 'receiving' ? '確認入庫' : '關閉'}
                cancelText="取消"
                cancelButtonProps={{ style: { display: mode === 'view' ? 'none' : 'inline-block' } }}
                confirmLoading={mutation.isPending}
                width={800}
                destroyOnHidden
            >
                {current && (
                    <>
                        <Descriptions bordered size="small" column={2} style={{ marginBottom: 16 }}>
                            <Descriptions.Item label="供應商">{current.supplier_name}</Descriptions.Item>
                            <Descriptions.Item label="建立人">{current.created_by_name}</Descriptions.Item>
                            {mode === 'view' && <Descriptions.Item label="驗收人">{current.received_by_name}</Descriptions.Item>}
                            {mode === 'view' && current.received_at && <Descriptions.Item label="驗收時間">{new Date(current.received_at).toLocaleString()}</Descriptions.Item>}
                        </Descriptions>

                        {mode === 'receiving' ? (
                            <Form form={form} layout="vertical" preserve={false} initialValues={{ items: current.items.map((i: any) => ({ received_quantity: i.quantity })) }}>
                                {current.items.map((item: any, idx: number) => {
                                    const received = watchedItems?.[idx]?.received_quantity;
                                    const shortBy = received != null && received < item.quantity ? item.quantity - received : 0;
                                    return (
                                        <Card
                                            key={item.id}
                                            size="small"
                                            style={{ marginBottom: 12 }}
                                            title={productLabel(item)}
                                            extra={shortBy > 0 ? <Tag color="red">短收 {shortBy}</Tag> : null}
                                        >
                                            <Row gutter={16}>
                                                <Col xs={12} sm={6}>
                                                    <div style={{ fontSize: 12, color: '#999' }}>待補數量</div>
                                                    <div style={{ fontWeight: 'bold', fontSize: 16 }}>{item.quantity}</div>
                                                </Col>
                                                <Col xs={12} sm={18}>
                                                    <Form.Item
                                                        name={['items', idx, 'received_quantity']}
                                                        label="實際驗收"
                                                        rules={[{ required: true, message: '必填' }]}
                                                        style={{ marginBottom: 12 }}
                                                    >
                                                        <InputNumber min={0} max={item.quantity} style={{ width: 120 }} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                            {shortBy > 0 && (
                                                <div style={{ border: '1px solid #ffccc7', background: '#fff2f0', borderRadius: 6, padding: 12, marginBottom: 12 }}>
                                                    <Alert type="error" showIcon style={{ marginBottom: 12 }} title={`比待補數量少 ${shortBy}，請填寫短收原因，確認入庫後會通知管理員。`} />
                                                    <Form.Item name={['items', idx, 'shortage_type']} label="短收原因" rules={[{ required: true, message: '請選擇短收原因' }]}>
                                                        <Select placeholder="請選擇" options={RECEIVING_SHORTAGE_REASONS.map((r) => ({ label: r, value: r }))} />
                                                    </Form.Item>
                                                    <Form.Item name={['items', idx, 'shortage_detail']} label="原因說明" rules={[{ required: true, whitespace: true, message: '請填寫原因說明' }]} style={{ marginBottom: 8 }}>
                                                        <Input.TextArea rows={2} maxLength={200} showCount />
                                                    </Form.Item>
                                                    {canCreate && (
                                                    <Form.Item name={['items', idx, 'create_supplementary']} valuePropName="checked" style={{ marginBottom: 0 }}>
                                                        <Checkbox>再建立一張補驗收單（供應商會再補寄這 {shortBy} 件，入庫後同時建立並通知管理員）</Checkbox>
                                                    </Form.Item>
                                                    )}
                                                </div>
                                            )}
                                            <Form.Item name={['items', idx, 'note']} label="驗收備註" style={{ marginBottom: 12 }}>
                                                <Input.TextArea rows={2} placeholder="請輸入驗收備註" />
                                            </Form.Item>
                                            <Row gutter={16}>
                                                <Col xs={24} sm={12}>
                                                    <Form.Item name={['items', idx, 'receiving_image']} label="上傳照片" rules={[{ required: true, message: '請上傳照片' }]}>
                                                        <UrlUpload accept="image/*" label="照片" />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} sm={12}>
                                                    <Form.Item name={['items', idx, 'receiving_video']} label="上傳影片" rules={[{ required: true, message: '請上傳影片' }]}>
                                                        <UrlUpload accept="video/*" label="影片" />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        </Card>
                                    );
                                })}
                            </Form>
                        ) : (
                            current.items.map((item: any) => (
                                <Card key={item.id} size="small" style={{ marginBottom: 12 }} title={productLabel(item)}
                                    extra={(item.received_quantity ?? 0) < item.quantity ? <Tag color="red">短收 {item.quantity - (item.received_quantity ?? 0)}</Tag> : <Tag color="green">已補齊</Tag>}
                                >
                                    <p style={{ margin: '0 0 8px' }}>待補 {item.quantity} → 實收 <Text strong style={{ color: '#8B6545' }}>{item.received_quantity}</Text></p>
                                    {item.shortage_reason && <p style={{ margin: '0 0 8px' }}><Text type="danger">短收原因：</Text>{item.shortage_reason}</p>}
                                    {item.note && <p style={{ margin: '0 0 8px' }}><Text type="secondary">備註：</Text>{item.note}</p>}
                                    <Row gutter={16}>
                                        {item.receiving_image && (
                                            <Col xs={24} sm={12}>
                                                <img src={item.receiving_image} alt="補驗收照片" style={{ maxWidth: '100%', maxHeight: 200, objectFit: 'contain', border: '1px solid #eee', borderRadius: 4 }} />
                                            </Col>
                                        )}
                                        {item.receiving_video && (
                                            <Col xs={24} sm={12}>
                                                <video src={item.receiving_video} controls style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 4 }} />
                                            </Col>
                                        )}
                                    </Row>
                                </Card>
                            ))
                        )}
                    </>
                )}
            </Modal>
        </div>
    );
};

export default SupplementaryReceiving;
