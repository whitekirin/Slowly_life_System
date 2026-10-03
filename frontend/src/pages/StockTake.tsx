import React, { useState } from 'react';
import { Table, Button, InputNumber, Space, message, Tag, Typography, Drawer, Popconfirm, DatePicker, Select, Card, Row, Col, Input, Image, Upload, Descriptions, Modal, Form, Alert } from 'antd';
import type { UploadFile } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getStockTakes, createStockTake, getStockTake, updateStockTake, completeStockTake, deleteStockTake, UPLOAD_URL } from '../api';
import { allocateStockTakeTotal } from '../utils/stockTakeAllocation';
import { PlusOutlined, DeleteOutlined, EyeOutlined, CheckOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { useUser } from '../contexts/UserContext';
const { Title, Text } = Typography;
const { RangePicker } = DatePicker;
const { Option } = Select;

// 盤點項目的照片：Upload 需要自己持有 fileList（上傳中的檔案還沒有 url），
// 每次有檔案上傳完成或被移除時，把目前所有已完成的 url 整包存回後端。
const ItemPhotos = ({ images, readOnly, onChange }: { images?: string[] | null, readOnly: boolean, onChange: (urls: string[]) => void }) => {
    const [fileList, setFileList] = useState<UploadFile[]>(() =>
        (images || []).map((url, i) => ({ uid: `-${i + 1}`, name: `photo-${i + 1}`, status: 'done', url }))
    );

    if (readOnly) {
        if (!images || images.length === 0) return <>-</>;
        return (
            <Image.PreviewGroup>
                <Space wrap size={4}>
                    {images.map((url) => (
                        <Image key={url} src={url} width={50} height={50} style={{ objectFit: 'cover' }} />
                    ))}
                </Space>
            </Image.PreviewGroup>
        );
    }

    const collectUrls = (list: UploadFile[]) =>
        list
            .filter((f) => f.status === 'done')
            .map((f) => f.url || f.response?.url)
            .filter((url): url is string => !!url);

    return (
        <Upload
            action={UPLOAD_URL}
            listType="picture-card"
            accept="image/*"
            multiple
            fileList={fileList}
            onChange={(info) => {
                const list = info.fileList.map((f) =>
                    f.status === 'done' && !f.url && f.response?.url ? { ...f, url: f.response.url } : f
                );
                setFileList(list);
                if (info.file.status === 'done' || info.file.status === 'removed') {
                    onChange(collectUrls(list));
                } else if (info.file.status === 'error') {
                    message.error(`照片上傳失敗：${info.file.name}`);
                }
            }}
        >
            <div>
                <PlusOutlined />
                <div style={{ marginTop: 4, fontSize: 12 }}>上傳</div>
            </div>
        </Upload>
    );
};

const SHORTAGE_REASONS = ['遺失／找不到', '損壞／報廢', '出貨未登記', '被竊', '先前盤點或入庫錯誤', '其他'];

type PendingDiscrepancy = { group: any, value: number, diff: number };

const StockTake = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_stock_takes');
  const canEdit = hasPermission('edit_stock_takes');
    const [isDrawerOpen, setIsDrawerOpen] = useState(false);
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const [filters, setFilters] = useState<{ status?: string, dateRange?: [dayjs.Dayjs, dayjs.Dayjs] | null }>({});
    const queryClient = useQueryClient();

    // Queries
    const { data: stockTakes, isLoading } = useQuery({
        queryKey: ['stockTakes', filters],
        queryFn: () => getStockTakes({
            status: filters.status,
            start_date: filters.dateRange ? filters.dateRange[0].startOf('day').toISOString() : undefined,
            end_date: filters.dateRange ? filters.dateRange[1].endOf('day').toISOString() : undefined
        })
    });

    const { data: detailData, isLoading: isDetailLoading } = useQuery({
        queryKey: ['stockTake', selectedId],
        queryFn: () => getStockTake(selectedId!),
        enabled: !!selectedId
    });

    // Mutations
    const createMutation = useMutation({
        mutationFn: createStockTake,
        onSuccess: () => {
            message.success('盤點單已建立');
            queryClient.invalidateQueries({ queryKey: ['stockTakes'] });
        }
    });

    const updateMutation = useMutation({
        mutationFn: updateStockTake,
        onSuccess: () => {
            // message.success('儲存成功');
            // Silent update
            queryClient.invalidateQueries({ queryKey: ['stockTake', selectedId] });
        },
        onError: (err: any) => {
            message.error(`儲存失敗：${err?.response?.data?.detail ?? err?.message ?? '未知錯誤'}`);
        }
    });

    const completeMutation = useMutation({
        mutationFn: completeStockTake,
        onSuccess: () => {
            message.success('盤點完成，庫存已更新');
            queryClient.invalidateQueries({ queryKey: ['stockTakes'] });
            queryClient.invalidateQueries({ queryKey: ['stockTake', selectedId] });
            setIsDrawerOpen(false);
        },
        onError: (err: any) => {
            message.error(err?.response?.data?.detail ?? '完成盤點失敗');
        }
    });

    const deleteMutation = useMutation({
        mutationFn: deleteStockTake,
        onSuccess: () => {
            message.success('刪除成功');
            queryClient.invalidateQueries({ queryKey: ['stockTakes'] });
        }
    });

    const handleCreate = () => {
        createMutation.mutate({ title: `盤點 ${dayjs().format('YYYY-MM-DD HH:mm')}` });
    };

    const handleView = (id: number) => {
        setSelectedId(id);
        setIsDrawerOpen(true);
    };

    // 數量與系統庫存有差距時必須填原因：盤盈跳防呆確認、盤虧跳原因視窗。
    // 原因存在備註裡；完成盤點時後端會再檢查一次，並彙整差異通知所有 admin。
    const [pending, setPending] = useState<PendingDiscrepancy | null>(null);
    const [inputResetKey, setInputResetKey] = useState(0);
    const [reasonForm] = Form.useForm();

    // 同名商品在盤點中只填一個合計數量，依系統庫存比例分攤回各 SKU（見 allocateStockTakeTotal）
    const saveTotal = (group: any, value: number, note?: string) => {
        const allocated = allocateStockTakeTotal(group.items.map((i: any) => i.system_quantity), value);
        updateMutation.mutate({
            id: selectedId!,
            data: {
                items: group.items.map((i: any, idx: number) => ({
                    id: i.id,
                    actual_quantity: allocated[idx],
                    ...(note !== undefined && i.id === group.primary.id ? { note } : {}),
                }))
            }
        });
    };

    const handleSaveTotal = (group: any, value: number) => {
        if (pending) return; // Enter 之後 blur 會再觸發一次，視窗開著時忽略
        if (value === null || value === undefined || isNaN(value)) return;
        if (value < 0) {
            message.error('盤點數量不可為負數');
            setInputResetKey((k) => k + 1);
            return;
        }
        if (value === group.actual_quantity) return;
        const diff = value - group.system_quantity;
        if (diff === 0) {
            saveTotal(group, value);
            return;
        }
        reasonForm.resetFields();
        setPending({ group, value, diff });
    };

    // 完成前先在前端擋一次（後端 complete_stock_take 也會檢查），直接列出缺什麼
    const handleComplete = () => {
        const missingImage = detailRows.filter((r: any) => !r.has_image).map((r: any) => r.name);
        const missingReason = detailRows
            .filter((r: any) => r.actual_quantity !== r.system_quantity && !r.items.some((i: any) => i.note && i.note.trim()))
            .map((r: any) => r.name);
        if (missingImage.length || missingReason.length) {
            Modal.error({
                title: '還不能完成盤點',
                content: (
                    <>
                        {missingImage.length > 0 && <p>尚未上傳盤點照片：{missingImage.join('、')}</p>}
                        {missingReason.length > 0 && <p>數量有差異但未填原因：{missingReason.join('、')}</p>}
                    </>
                ),
            });
            return;
        }
        completeMutation.mutate(selectedId!);
    };

    const cancelPending = () => {
        setPending(null);
        setInputResetKey((k) => k + 1); // 還原成原本已存的數量
    };

    const confirmPending = async () => {
        if (!pending) return;
        const values = await reasonForm.validateFields();
        const note = pending.diff > 0
            ? `盤盈：${values.detail.trim()}`
            : `盤虧（${values.reason_type}）：${values.detail.trim()}`;
        saveTotal(pending.group, pending.value, note);
        setPending(null);
    };

    // 備註與照片屬於整個商品，存在同名群組的第一個 SKU 上
    const handleSaveNote = (group: any, note: string) => {
        if (note === (group.primary.note ?? '')) return;
        if (!note.trim() && group.actual_quantity !== group.system_quantity) {
            message.error('此商品盤點數量有差異，原因不可清空');
            setInputResetKey((k) => k + 1);
            return;
        }
        updateMutation.mutate({
            id: selectedId!,
            data: {
                items: [{ id: group.primary.id, note: note }]
            }
        });
    };

    const handleSaveImages = (group: any, images: string[]) => {
        updateMutation.mutate({
            id: selectedId!,
            data: {
                items: [{ id: group.primary.id, images }]
            }
        });
    };

    const columns = [
        { title: 'ID', dataIndex: 'id', key: 'id' },
        { title: '標題', dataIndex: 'title', key: 'title' },
        { title: '建立時間', dataIndex: 'created_at', key: 'created_at', render: (text: string) => dayjs(text).format('YYYY-MM-DD HH:mm') },
        { title: '盤點人', dataIndex: 'taker_name', key: 'taker_name', render: (name: string) => name || '-' },
        { title: '狀態', dataIndex: 'status', key: 'status', render: (status: string) => (
            <Tag color={status === 'completed' ? 'green' : 'orange'}>
                {status === 'completed' ? '已完成' : '草稿'}
            </Tag>
        )},
        {
            title: '操作',
            key: 'action',
            render: (_: any, record: any) => (
                <Space>
                    <Button icon={<EyeOutlined />} onClick={() => handleView(record.id)}>{canEdit && record.status !== 'completed' ? '查看/盤點' : '查看'}</Button>
                    {canEdit && record.status !== 'completed' && (
                         <Popconfirm title="確定刪除?" onConfirm={() => deleteMutation.mutate(record.id)}>
                            <Button danger icon={<DeleteOutlined />} />
                         </Popconfirm>
                    )}
                </Space>
            )
        }
    ];

    // 盤點以商品名稱為單位：同名的不同 SKU 合併成一列、只填一個合計數量
    const detailRows = React.useMemo(() => {
        if (!detailData?.items) return [];
        const items = detailData.items
            .filter((item: any) => item.system_quantity !== 0)
            .sort((a: any, b: any) => {
                const nameA = a.product?.name || '';
                const nameB = b.product?.name || '';
                if (nameA !== nameB) return nameA.localeCompare(nameB);
                return (a.product?.sku || '').localeCompare(b.product?.sku || '');
            });

        const groups = new Map<string, any[]>();
        items.forEach((item: any) => {
            const name = item.product?.name || '';
            if (!groups.has(name)) groups.set(name, []);
            groups.get(name)!.push(item);
        });

        return Array.from(groups.entries()).map(([name, groupItems]) => ({
            name,
            items: groupItems,
            primary: groupItems[0],
            image_url: groupItems.find((i: any) => i.product?.image_url)?.product?.image_url,
            system_quantity: groupItems.reduce((sum: number, i: any) => sum + i.system_quantity, 0),
            actual_quantity: groupItems.reduce((sum: number, i: any) => sum + (i.actual_quantity ?? i.system_quantity), 0),
            // 與後端完成盤點的檢查一致：同名任一 SKU 有照片就算有
            has_image: groupItems.some((i: any) => i.images && i.images.length > 0),
        }));
    }, [detailData]);

    const detailColumns = [
        {
            title: '圖片',
            dataIndex: 'image_url',
            key: 'image',
            render: (url: string, record: any) => (
                url ? (
                    <Image
                        src={url}
                        alt={record.name || 'product'}
                        width={50}
                        height={50}
                        style={{ objectFit: 'cover' }}
                        preview={{
                            mask: <EyeOutlined />,
                            src: url
                        }}
                    />
                ) : '-'
            )
        },
        { title: '商品名稱', dataIndex: 'name', key: 'product_name' },
        { title: '系統庫存', dataIndex: 'system_quantity', key: 'system_quantity' },
        {
            title: '實際盤點',
            key: 'actual_quantity',
            render: (_: any, record: any) => {
                const isCompleted = detailData?.status === 'completed' || !canEdit; // 沒有修改權限時同已完成，只能看
                if (isCompleted) return record.actual_quantity;

                return (
                    <InputNumber
                        key={`qty-${record.name}-${record.actual_quantity}-${inputResetKey}`}
                        min={0}
                        defaultValue={record.actual_quantity}
                        onBlur={(e) => handleSaveTotal(record, parseInt(e.target.value))}
                        onPressEnter={(e: any) => handleSaveTotal(record, parseInt(e.target.value))}
                    />
                );
            }
        },
        {
            title: '差異',
            key: 'diff',
            render: (_: any, record: any) => {
                const diff = record.actual_quantity - record.system_quantity;
                return (
                    <Text type={diff === 0 ? 'secondary' : diff < 0 ? 'danger' : 'success'}>
                        {diff > 0 ? `+${diff}` : diff}
                    </Text>
                );
            }
        },
        {
            title: '備註',
            key: 'note',
            width: 200,
            render: (_: any, record: any) => {
                const isCompleted = detailData?.status === 'completed' || !canEdit; // 沒有修改權限時同已完成，只能看
                if (isCompleted) return record.primary.note || '-';
                return (
                    <Input
                        key={`note-${record.name}-${record.primary.note ?? ''}-${inputResetKey}`}
                        status={record.actual_quantity !== record.system_quantity && !record.primary.note ? 'error' : undefined}
                        defaultValue={record.primary.note}
                        onBlur={(e) => handleSaveNote(record, e.target.value)}
                        onPressEnter={(e) => handleSaveNote(record, (e.target as HTMLInputElement).value)}
                        placeholder={record.actual_quantity !== record.system_quantity ? '請填寫差異原因' : '備註'}
                    />
                );
            }
        },
        {
            title: <span><Text type="danger">* </Text>盤點照片</span>,
            key: 'images',
            width: 220,
            render: (_: any, record: any) => {
                const isCompleted = detailData?.status === 'completed' || !canEdit; // 沒有修改權限時同已完成，只能看
                return (
                    <div style={!isCompleted && !record.has_image ? { border: '1px dashed #B25B4C', borderRadius: 8, padding: 4 } : undefined}>
                        <ItemPhotos
                            key={`${selectedId}-${record.primary.id}-${detailData?.status}`}
                            images={record.primary.images}
                            readOnly={isCompleted}
                            onChange={(urls) => handleSaveImages(record, urls)}
                        />
                        {!isCompleted && !record.has_image && (
                            <Text type="danger" style={{ fontSize: 12 }}>必填，請至少上傳一張</Text>
                        )}
                    </div>
                );
            }
        }
    ];

    return (
        <div style={{ padding: 24 }}>
            <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                <Title level={2}>庫存盤點</Title>
                {canCreate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate} loading={createMutation.isPending}>
                    發起盤點
                </Button>
                )}
            </div>
            
            <Card style={{ marginBottom: 24 }}>
                <Space wrap>
                    <RangePicker 
                        placeholder={['開始日期', '結束日期']}
                        onChange={(dates) => setFilters(prev => ({ ...prev, dateRange: dates as any }))}
                    />
                    <Select 
                        placeholder="狀態篩選" 
                        allowClear 
                        style={{ width: 120 }}
                        onChange={(value) => setFilters(prev => ({ ...prev, status: value }))}
                    >
                        <Option value="draft">草稿</Option>
                        <Option value="completed">已完成</Option>
                    </Select>
                    {/* <Button type="primary" icon={<SearchOutlined />}>搜尋</Button> */}
                </Space>
            </Card>

            <Table columns={columns} dataSource={stockTakes} rowKey="id" loading={isLoading} />

            <Drawer
                title={`盤點詳情 #${selectedId}`}
                width={1000}
                open={isDrawerOpen}
                onClose={() => setIsDrawerOpen(false)}
                extra={
                    canEdit && detailData?.status !== 'completed' && (
                        <Popconfirm title="確定完成盤點？庫存將會被更新。" onConfirm={handleComplete}>
                            <Button type="primary" icon={<CheckOutlined />}>完成盤點</Button>
                        </Popconfirm>
                    )
                }
            >
                {detailData && (
                    <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
                        <Descriptions.Item label="盤點人">{detailData.taker_name || '-'}</Descriptions.Item>
                        <Descriptions.Item label="建立時間">{dayjs(detailData.created_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
                        {detailData.status === 'completed' && (
                            <Descriptions.Item label="完成盤點人">{detailData.completed_by_name || '-'}</Descriptions.Item>
                        )}
                    </Descriptions>
                )}
                {detailData && (
                    <Table
                        columns={detailColumns}
                        dataSource={detailRows}
                        rowKey="name"
                        loading={isDetailLoading}
                        pagination={{ pageSize: 10 }}
                    />
                )}
            </Drawer>

            <Modal
                open={!!pending}
                title={pending && pending.diff > 0 ? '⚠️ 盤點數量比系統庫存多' : '盤點數量短少，請填寫原因'}
                okText="確認並儲存"
                cancelText="取消，重新輸入"
                onOk={confirmPending}
                onCancel={cancelPending}
                maskClosable={false}
                destroyOnHidden
            >
                {pending && (
                    <>
                        <Descriptions size="small" column={1} bordered style={{ marginBottom: 16 }}>
                            <Descriptions.Item label="商品">{pending.group.name}</Descriptions.Item>
                            <Descriptions.Item label="系統庫存">{pending.group.system_quantity}</Descriptions.Item>
                            <Descriptions.Item label="盤點數量">{pending.value}</Descriptions.Item>
                            <Descriptions.Item label="差異">
                                <Text type={pending.diff > 0 ? 'success' : 'danger'} strong>
                                    {pending.diff > 0 ? `+${pending.diff}` : pending.diff}
                                </Text>
                            </Descriptions.Item>
                        </Descriptions>
                        {pending.diff > 0 ? (
                            <Alert
                                type="warning"
                                showIcon
                                style={{ marginBottom: 16 }}
                                title="實際數量比系統多，常見原因是輸入錯誤或多打一位數。請再輸入一次數量確認，並說明多出來的原因。"
                            />
                        ) : (
                            <Alert
                                type="error"
                                showIcon
                                style={{ marginBottom: 16 }}
                                title="短少的原因會在完成盤點時通知管理員。"
                            />
                        )}
                        <Form form={reasonForm} layout="vertical" preserve={false}>
                            {pending.diff > 0 && (
                                <Form.Item
                                    name="confirm_quantity"
                                    label="再次輸入盤點數量"
                                    rules={[
                                        { required: true, message: '請再次輸入盤點數量' },
                                        {
                                            validator: (_, v) => v === pending.value
                                                ? Promise.resolve()
                                                : Promise.reject(new Error(`與剛才輸入的 ${pending.value} 不一致，請確認`)),
                                        },
                                    ]}
                                >
                                    <InputNumber min={0} style={{ width: '100%' }} />
                                </Form.Item>
                            )}
                            {pending.diff < 0 && (
                                <Form.Item name="reason_type" label="短少原因" rules={[{ required: true, message: '請選擇短少原因' }]}>
                                    <Select placeholder="請選擇" options={SHORTAGE_REASONS.map((r) => ({ label: r, value: r }))} />
                                </Form.Item>
                            )}
                            <Form.Item
                                name="detail"
                                label={pending.diff > 0 ? '多出原因' : '原因說明'}
                                rules={[{ required: true, whitespace: true, message: '請填寫原因說明' }]}
                            >
                                <Input.TextArea rows={3} maxLength={200} showCount placeholder="例如：退貨未入庫、上次盤點漏算…" />
                            </Form.Item>
                        </Form>
                    </>
                )}
            </Modal>
        </div>
    );
};

export default StockTake;
