import React from 'react';
import { Table, Button, Card, Typography, Space, Spin, Alert, Tag, message } from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { archiveProductListing, getProductListingBatch, publishProductListing } from '../api';
import { ExportOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';

import { useUser } from '../contexts/UserContext';
import { isLiffMode } from '../liffSession';
const { Title, Text } = Typography;

interface ListedItem {
    id: number;
    product_sku: string;
    product_name: string;
    sales_price: number;
    stock_quantity: number;
    quantity: number;
}

interface ListingBatch {
    id: number;
    created_at: string;
    created_by_name: string;
    status: 'draft' | 'published' | 'archived';
    published_at?: string | null;
    archived_at?: string | null;
    items: ListedItem[];
}

const ProductListingResult: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  const { hasPermission } = useUser();
  const canEdit = hasPermission('edit_product_listings');
    const { batchId } = useParams<{ batchId: string }>();
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    const { data, isLoading, error } = useQuery<ListingBatch>({
        queryKey: ['productListingBatch', batchId],
        queryFn: () => getProductListingBatch(batchId!),
        enabled: !!batchId,
        refetchInterval: 5000, // 5秒自動更新一次
    });

    const refreshBatch = async () => {
        await queryClient.invalidateQueries({ queryKey: ['productListingBatch', batchId] });
        await queryClient.invalidateQueries({ queryKey: ['admin_new_products'] });
    };

    const publishMutation = useMutation({
        mutationFn: () => publishProductListing(batchId!),
        onSuccess: async () => {
            message.success('本批次商品已上線至主系統會員管理的新品模組。');
            await refreshBatch();
        },
        onError: (err: any) => {
            message.error(`發布失敗：${err.response?.data?.detail || err.message}`);
        }
    });

    const archiveMutation = useMutation({
        mutationFn: () => archiveProductListing(batchId!),
        onSuccess: async () => {
            message.success('本批次已封存，主系統新品模組將不再統計此批次商品。');
            await refreshBatch();
        },
        onError: (err: any) => {
            message.error(`封存失敗：${err.response?.data?.detail || err.message}`);
        }
    });

    const handleExportCSV = () => {
        if (!data || !data.items || data.items.length === 0) return;

        const headers = ['商品編號(SKU)', '商品名稱', '上架時間', '上架人員', '售價', '庫存數量'];
        const csvRows = [headers.join(',')];

        data.items.forEach(item => {
            const row = [
                `"${item.product_sku || ''}"`,
                `"${item.product_name || ''}"`,
                `"${dayjs(data.created_at).format('YYYY-MM-DD HH:mm:ss')}"`,
                `"${data.created_by_name || ''}"`,
                item.sales_price || 0,
                item.stock_quantity || 0
            ];
            csvRows.push(row.join(','));
        });

        const csvString = csvRows.join('\n');
        // Add BOM for UTF-8 Excel compatibility
        const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `上架批次_${batchId}_${dayjs().format('YYYYMMDDHHmmss')}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const columns = [
        {
            title: '商品編號',
            dataIndex: 'product_sku',
            key: 'product_sku',
        },
        {
            title: '商品名稱',
            dataIndex: 'product_name',
            key: 'product_name',
        },
        {
            title: '建立時間',
            key: 'created_at',
            render: () => data?.created_at ? dayjs(data.created_at).format('YYYY-MM-DD HH:mm:ss') : '-'
        },
        {
            title: '建立人員',
            key: 'created_by_name',
            render: () => data?.created_by_name || '-'
        },
        {
            title: '售價',
            dataIndex: 'sales_price',
            key: 'sales_price',
            render: (val: number) => `$${val?.toLocaleString() || 0}`
        },
        {
            title: '庫存數量',
            dataIndex: 'stock_quantity',
            key: 'stock_quantity',
        }
    ];

    if (isLoading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '50px' }}>
                <Spin size="large" tip="載入上架資料中..." />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div style={{ padding: '24px' }}>
                <Alert
                    message="發生錯誤"
                    description="無法取得上架批次資料，或是您沒有檢視權限 (403)。"
                    type="error"
                    showIcon
                    action={
                        <Button onClick={() => navigate('/product-status')}>返回上架頁</Button>
                    }
                />
            </div>
        );
    }

    return (
        <div style={{ padding: '24px' }}>
            <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div>
                        <Title level={3} style={{ margin: 0 }}>上架批次明細 (批次: #{data.id})</Title>
                        <Space style={{ marginTop: 8 }}>
                            <Tag color={data.status === 'published' ? 'green' : data.status === 'archived' ? 'default' : 'gold'}>
                                {data.status === 'published' ? '已發布' : data.status === 'archived' ? '已封存' : '待發布'}
                            </Tag>
                            {data.published_at && (
                                <Text type="secondary">
                                    發布時間：{dayjs(data.published_at).format('YYYY-MM-DD HH:mm:ss')}
                                </Text>
                            )}
                        </Space>
                    </div>
                    <Space>
                        {canEdit && data.status !== 'published' && (
                            <Button
                                type="primary"
                                loading={publishMutation.isPending}
                                onClick={() => publishMutation.mutate()}
                            >
                                上線到會員管理
                            </Button>
                        )}
                        {canEdit && data.status === 'published' && (
                            <Button
                                danger
                                loading={archiveMutation.isPending}
                                onClick={() => archiveMutation.mutate()}
                            >
                                封存批次
                            </Button>
                        )}
                        {!fromLine && (
                        <Button 
                            icon={<ExportOutlined />} 
                            onClick={handleExportCSV}
                        >
                            匯出 CSV
                        </Button>
                        )}
                        <Button 
                            icon={<ArrowLeftOutlined />} 
                            onClick={() => navigate('/product-status')}
                        >
                            返回上架頁
                        </Button>
                    </Space>
                </div>
                <Alert
                    type={data.status === 'published' ? 'success' : 'info'}
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={data.status === 'published' ? '此批次商品已納入主系統會員管理新品模組。' : '此批次目前尚未上線到會員管理新品模組。'}
                    description={data.status === 'published'
                        ? '管理者可於主系統「會員管理 > 新品總覽管理」查看這批商品的清單、統計與圖表。'
                        : '請確認批次商品內容後，再執行「上線到會員管理」。'}
                />
                
                <Table 
                    columns={columns} 
                    dataSource={data.items} 
                    rowKey="id"
                    pagination={{ pageSize: 50, showSizeChanger: true }} // 每頁50筆，支援超過5000筆的分頁
                    size="middle"
                />
            </Card>
        </div>
    );
};

export default ProductListingResult;
