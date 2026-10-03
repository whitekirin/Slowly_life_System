import React, { useMemo, useEffect } from 'react';
import { 
    Form, 
    Select, 
    Button, 
    Card, 
    Typography, 
    Space, 
    Row, 
    Col, 
    InputNumber, 
    message, 
    Divider, 
    Tag,
    Alert
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getProducts, createProductListing, getProductListingReservedQuantities } from '../api';
import { useNavigate } from 'react-router-dom';

import { useUser } from '../contexts/UserContext';
const { Title, Text } = Typography;

interface Product {
    id: number;
    name: string;
    stock_quantity: number;
    sku: string;
}

interface GroupedProduct {
    name: string;
    total_stock: number;
    total_reserved: number;
    total_available: number;
}

const ProductStatusManagement: React.FC = () => {
  const { hasPermission } = useUser();
  const canCreate = hasPermission('create_product_listings');
    const [form] = Form.useForm();
    const itemsValue = Form.useWatch('items', form) || [];
    
    // 取得庫存商品 (即時更新: refetchInterval 設定為 10秒，或在焦點回到視窗時更新)
    const { data: products, isLoading, refetch } = useQuery<Product[]>({
        queryKey: ['products'],
        queryFn: getProducts,
        refetchInterval: 10000, // 10秒自動更新一次庫存
    });

    // 每個商品目前在「已發布」批次中已佔用的數量：建立新批次時要先扣除，避免同一批庫存被重複上架
    const { data: reservedQuantities, refetch: refetchReserved } = useQuery<Record<number, number>>({
        queryKey: ['product-listing-reserved-quantities'],
        queryFn: getProductListingReservedQuantities,
        refetchInterval: 10000,
    });

    // 庫存整合邏輯：自動彙整相同品名（商品名稱）的庫存記錄，並扣除已發布批次佔用的數量
    const groupedProducts = useMemo(() => {
        if (!products) return [];
        const groups: Record<string, GroupedProduct> = {};

        products.forEach(p => {
            if (!p.name) return;
            if (!groups[p.name]) {
                groups[p.name] = { name: p.name, total_stock: 0, total_reserved: 0, total_available: 0 };
            }
            const reserved = reservedQuantities?.[p.id] || 0;
            groups[p.name].total_stock += (p.stock_quantity || 0);
            groups[p.name].total_reserved += reserved;
            groups[p.name].total_available += Math.max(0, (p.stock_quantity || 0) - reserved);
        });

        // 只回傳可上架數量大於 0 的商品
        return Object.values(groups).filter(g => g.total_available > 0);
    }, [products, reservedQuantities]);

    const navigate = useNavigate();

    // 監聽表單變化，即時驗證機制
    const handleValuesChange = (changedValues: any, allValues: any) => {
        if (!products || !groupedProducts.length) return;

        const items = allValues.items || [];
        
        // 檢查是否有選擇超過最新庫存數量的情況
        let hasError = false;
        items.forEach((item: any, index: number) => {
            if (item && item.name) {
                const group = groupedProducts.find(g => g.name === item.name);
                if (group) {
                    if (item.quantity > group.total_available) {
                        message.warning(`「${item.name}」的選擇數量 (${item.quantity}) 已超過可上架數量 (${group.total_available})，系統已自動調整。`);

                        // 自動將超過的數量修正為最大可上架數量
                        const newItems = [...items];
                        newItems[index].quantity = group.total_available;
                        form.setFieldsValue({ items: newItems });
                        hasError = true;
                    }
                } else {
                    // 如果商品已無庫存
                    message.error(`「${item.name}」目前已無庫存！`);
                    const newItems = [...items];
                    newItems[index].quantity = undefined;
                    form.setFieldsValue({ items: newItems });
                    hasError = true;
                }
            }
        });
        
        if (hasError) {
            // 可以觸發 form 的驗證更新
            form.validateFields();
        }
    };

    const createListingMutation = useMutation({
        mutationFn: createProductListing,
        onSuccess: (data) => {
            message.success('上架批次已建立，尚未上線到主系統會員管理的新品模組。');
            form.resetFields();
            navigate(`/product-listing-result/${data.id}`);
        },
        onError: (err: any) => {
            message.error(`上架失敗: ${err.response?.data?.detail || err.message}`);
        }
    });

    const onFinish = (values: any) => {
        if (!products) return;

        const payloadItems: { product_id: number, quantity: number }[] = [];

        values.items.forEach((item: any) => {
            if (!item || !item.name || !item.quantity) return;

            let remainingToAssign = item.quantity;
            // 每個商品（sku）可上架數量 = 目前庫存 - 已在「已發布」批次中佔用的數量
            const matchingProducts = products
                .filter(p => p.name === item.name)
                .map(p => ({ p, available: (p.stock_quantity || 0) - (reservedQuantities?.[p.id] || 0) }))
                .filter(({ available }) => available > 0);

            for (const { p, available } of matchingProducts) {
                if (remainingToAssign <= 0) break;

                const qtyToTake = Math.min(remainingToAssign, available);
                payloadItems.push({
                    product_id: p.id,
                    quantity: qtyToTake
                });
                remainingToAssign -= qtyToTake;
            }

            if (remainingToAssign > 0) {
                message.warning(`「${item.name}」的可上架數量不足，部分數量無法分配`);
            }
        });

        if (payloadItems.length === 0) {
            message.error('無法產生上架資料，請確認商品是否有可上架的庫存');
            return;
        }

        createListingMutation.mutate({ items: payloadItems });
    };

    // 取得選定項目的剩餘可上架數量計算
    const getRemainingStock = (itemName: string, currentIndex: number, currentQty: number) => {
        const group = groupedProducts.find(g => g.name === itemName);
        if (!group) return 0;

        return Math.max(0, group.total_available - (currentQty || 0));
    };

    return (
        <div style={{ padding: '24px' }}>
            <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Title level={2} style={{ margin: 0 }}>上架批次管理</Title>
                <Button onClick={() => { refetch(); refetchReserved(); }} loading={isLoading}>
                    手動更新庫存
                </Button>
            </div>
            
            <Alert 
                message="作業說明" 
                description="此功能用於建立本次要上線的商品批次清單。系統會依目前庫存扣除已在「已發布」批次中的數量，協助整理可上架商品與數量；完成後仍需在批次明細頁執行上線，商品才會納入主系統會員管理的新品模組。批次一旦封存，數量會歸還可上架庫存。"
                type="info" 
                showIcon 
                style={{ marginBottom: 24 }} 
            />

            <Form 
                form={form} 
                name="dynamic_form_item" 
                onFinish={onFinish}
                onValuesChange={handleValuesChange}
                initialValues={{ items: [{}] }}
            >
                <Card title="本次發布商品清單">
                    <Form.List name="items">
                        {(fields, { add, remove }) => (
                            <>
                                {fields.map(({ key, name, ...restField }, index) => {
                                    const currentItem = itemsValue[name] || {};
                                    const selectedName = currentItem.name;
                                    const selectedQty = currentItem.quantity || 0;
                                    const group = groupedProducts.find(g => g.name === selectedName);
                                    
                                    // 產生數量的下拉選單選項 (1 ~ 可上架數量)
                                    const quantityOptions = [];
                                    if (group && group.total_available > 0) {
                                        for (let i = 1; i <= group.total_available; i++) {
                                            quantityOptions.push({ label: i.toString(), value: i });
                                        }
                                    }

                                    return (
                                        <Card 
                                            key={key} 
                                            size="small" 
                                            style={{ marginBottom: 16, background: '#fafafa' }}
                                        >
                                            <Row gutter={16} align="middle">
                                                <Col span={8}>
                                                    <Form.Item
                                                        {...restField}
                                                        name={[name, 'name']}
                                                        label="商品名稱"
                                                        rules={[{ required: true, message: '請選擇商品' }]}
                                                        style={{ marginBottom: 0 }}
                                                    >
                                                        <Select
                                                            showSearch
                                                            placeholder="搜尋或選擇商品..."
                                                            loading={isLoading}
                                                            onChange={() => {
                                                                // 切換商品時重置數量
                                                                const currentItems = form.getFieldValue('items') || [];
                                                                if (currentItems[name]) {
                                                                    currentItems[name].quantity = undefined;
                                                                    form.setFieldsValue({ items: currentItems });
                                                                }
                                                            }}
                                                            filterOption={(input, option) =>
                                                                (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                                                            }
                                                            options={groupedProducts.map(g => ({
                                                                label: g.total_reserved > 0
                                                                    ? `${g.name} (庫存: ${g.total_stock}，已上架中: ${g.total_reserved}，可上架: ${g.total_available})`
                                                                    : `${g.name} (庫存: ${g.total_stock})`,
                                                                value: g.name
                                                            }))}
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={6}>
                                                    <Form.Item
                                                        {...restField}
                                                        name={[name, 'quantity']}
                                                        label="上架數量"
                                                        rules={[{ required: true, message: '請選擇數量' }]}
                                                        style={{ marginBottom: 0 }}
                                                    >
                                                        <Select
                                                            placeholder="選擇數量"
                                                            disabled={!selectedName || quantityOptions.length === 0}
                                                            options={quantityOptions}
                                                            showSearch
                                                        />
                                                    </Form.Item>
                                                </Col>
                                                <Col span={8}>
                                                    {selectedName && group && (
                                                        <Space split={<Divider type="vertical" />}>
                                                            <Text type="secondary">
                                                                庫存總量: <Tag color="blue">{group.total_stock}</Tag>
                                                            </Text>
                                                            {group.total_reserved > 0 && (
                                                                <Text type="secondary">
                                                                    已上架中: <Tag color="purple">{group.total_reserved}</Tag>
                                                                </Text>
                                                            )}
                                                            <Text type="secondary">
                                                                已選數量: <Tag color="orange">{selectedQty}</Tag>
                                                            </Text>
                                                            <Text type="secondary">
                                                                剩餘可上架: <Tag color={getRemainingStock(selectedName, index, selectedQty) > 0 ? "green" : "red"}>
                                                                    {getRemainingStock(selectedName, index, selectedQty)}
                                                                </Tag>
                                                            </Text>
                                                        </Space>
                                                    )}
                                                </Col>
                                                <Col span={2} style={{ textAlign: 'right' }}>
                                                    {fields.length > 1 && (
                                                        <Button 
                                                            type="text" 
                                                            danger 
                                                            icon={<DeleteOutlined />} 
                                                            onClick={() => remove(name)}
                                                        />
                                                    )}
                                                </Col>
                                            </Row>
                                        </Card>
                                    );
                                })}
                                <Form.Item>
                                    <Button 
                                        type="dashed" 
                                        onClick={() => add()} 
                                        block 
                                        icon={<PlusOutlined />}
                                        size="large"
                                    >
                                        新增商品項目
                                    </Button>
                                </Form.Item>
                            </>
                        )}
                    </Form.List>
                    
                    <Divider />
                    
                    <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
                        <Space>
                            <Button onClick={() => form.resetFields()}>
                                重置表單
                            </Button>
                            {canCreate ? (
                            <Button type="primary" htmlType="submit" icon={<SaveOutlined />} size="large">
                                建立批次
                            </Button>
                            ) : (
                                <Text type="secondary">沒有新增上架批次的權限，只能試算可上架數量</Text>
                            )}
                        </Space>
                    </Form.Item>
                </Card>
            </Form>
        </div>
    );
};

export default ProductStatusManagement;
