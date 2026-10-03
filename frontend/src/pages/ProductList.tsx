import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, message, Tag, Tooltip, Typography, Popconfirm, Row, Col, Divider, Card, Select } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getProducts, createProduct, generateSku, updateProduct, deleteProduct, getCategories, getProductReceivingNotes } from '../api';
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, AlertOutlined, EyeOutlined } from '@ant-design/icons';

import { useUser } from '../contexts/UserContext';
const { Title } = Typography;
const { Option } = Select;
const { TextArea } = Input;

const ReadOnlyText: React.FC<{ value?: any; prefix?: React.ReactNode; suffix?: React.ReactNode; options?: { label: string; value: any }[] }> = ({ value, prefix, suffix, options }) => {
    if (value === null || value === undefined || value === '') return <span className="ant-form-text" style={{ color: '#8c8c8c' }}>-</span>;
    let display = value;
    if (options) {
        const opt = options.find(o => o.value === value);
        if (opt) display = opt.label;
    }
    return <span className="ant-form-text">{prefix}{display}{suffix}</span>;
};

const ImageDisplay: React.FC<{ url?: string }> = ({ url }) => {
    if (!url) return <div style={{ width: 100, height: 100, background: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ccc' }}>無圖片</div>;
    return (
        <div style={{ marginBottom: 8 }}>
            <img src={url} alt="Product" style={{ maxWidth: '200px', maxHeight: '200px', objectFit: 'contain', border: '1px solid #f0f0f0', borderRadius: 4 }} />
        </div>
    );
};

interface Product {
  id: number;
  sku: string;
  name: string;
  category_name?: string;
  cost_price: number;
  sales_price: number;
  stock_quantity: number;
  first_received_at?: string | null;
  unit: string;
  attributes?: any;
  image_url?: string;
  promotion_image_urls?: string[];
  promotion_copy?: string;
  purchase_url?: string;
  source_url?: string;
  exchange_rate?: number;
  price_rmb?: number;
  shipping_rmb?: number;
  shipping_rate_twd?: number;
  weight_kg?: number;
  batch_quantity?: number;
  min_price?: number;
  max_price?: number;
  pricing_strategy?: string;
  is_confirmed?: boolean;
  style?: string;
}

interface ProductGroup extends Partial<Product> {
  key: React.Key;
  children?: Product[];
  isGroup?: boolean;
  cost_price_display?: string;
  sales_price_display?: string;
  variant_count?: number;
}

const ProductList: React.FC = () => {
  const { hasPermission } = useUser();
  const canEdit = hasPermission('edit_products');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isViewMode, setIsViewMode] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [isGeneratingSku, setIsGeneratingSku] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [totalStock, setTotalStock] = useState<number>(0);
  const [originalVariantIds, setOriginalVariantIds] = useState<number[]>([]);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const { data: products, isLoading } = useQuery<Product[]>({ queryKey: ['products'], queryFn: getProducts });
  const { data: categories = [] } = useQuery<{ id: number; name: string }[]>({
    queryKey: ['categories'],
    queryFn: getCategories,
  });

  // Watch fields for auto-calculation
  // Removed global watchers
  
  // Auto-calculate Costs and Profits
  // Removed global useEffect for calculator
  
  const createMutation = useMutation({
    mutationFn: createProduct,
    onSuccess: () => {
      message.success('商品新增成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
        message.error('新增失敗');
    }
  });

  const updateMutation = useMutation({
    mutationFn: updateProduct,
    onSuccess: () => {
        message.success('商品更新成功');
        handleCloseModal();
        queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: () => {
        message.error('更新失敗');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => {
        message.success('商品刪除成功');
        queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error: any) => {
        const errorMessage = error.response?.data?.detail || '刪除失敗';
        message.error(errorMessage);
    }
  });

  const showReceivingNotes = isModalOpen && !!editingProduct && originalVariantIds.length > 0;
  const { data: receivingNotes = [] } = useQuery({
    queryKey: ['product_receiving_notes', originalVariantIds],
    queryFn: () => getProductReceivingNotes(originalVariantIds),
    enabled: showReceivingNotes,
  });

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    form.resetFields();
  };

  const handleOk = async () => {
    try {
        const values = await form.validateFields();
        const commonData = {
            name: values.name,
            category_name: values.category_name,
            image_url: values.image_url,
            promotion_image_urls: (values.promotion_images_text || '')
                .split('\n')
                .map((url: string) => url.trim())
                .filter((url: string) => !!url),
            promotion_copy: values.promotion_copy,
            purchase_url: values.purchase_url,
            source_url: values.source_url,
        };

        const variants = values.variants || [];
        
        // 1. Identify IDs in form
        const formIds = variants.map((v: any) => v.id).filter((id: any) => !!id);
        
        const promises = [];

        // Handle Updates and Creates
        for (const variant of variants) {
            const productData = {
                ...commonData,
                sku: variant.sku,
                stock_quantity: variant.stock_quantity,
                unit: variant.unit,
                cost_price: variant.cost_price,
                sales_price: variant.sales_price,
                
                // Individual Calculator fields
                exchange_rate: variant.exchange_rate,
                price_rmb: variant.price_rmb,
                shipping_rmb: variant.shipping_rmb,
                weight_kg: variant.weight_kg,
                shipping_rate_twd: variant.shipping_rate_twd,
                batch_quantity: variant.batch_quantity,
                
                min_price: variant.min_price,
                max_price: variant.max_price,
                pricing_strategy: variant.pricing_strategy,
                style: variant.style
            };

            if (variant.id) {
                promises.push(updateMutation.mutateAsync({ id: variant.id, data: productData }));
            } else {
                promises.push(createMutation.mutateAsync(productData));
            }
        }

        // Handle Deletions
        if (originalVariantIds.length > 0) {
            const toDelete = originalVariantIds.filter(id => !formIds.includes(id));
            for (const id of toDelete) {
                promises.push(deleteMutation.mutateAsync(id));
            }
        }

        await Promise.all(promises);
        
        message.success('商品儲存成功');
        handleCloseModal();
        queryClient.invalidateQueries({ queryKey: ['products'] });

    } catch (error) {
        console.error("Save failed:", error);
        message.error('儲存失敗，請檢查欄位');
    }
  };

  const handleView = (record: Product | ProductGroup) => {
    setIsViewMode(true); // Ensure view mode is set FIRST
    
    // If it's a group, we want to edit all children
    // If it's a single item (variant), we ALSO want to edit the whole group it belongs to
    
    const name = record.name;
    const groupItems = groupedData.find(g => g.name === name)?.children || [];
    
    // If no group found (shouldn't happen), fall back to single item
    const itemsToEdit = groupItems.length > 0 ? groupItems : [record as Product];
    
    // Construct initial values
    // Use the first item for common fields
    const firstItem = itemsToEdit[0];
    
    setEditingProduct(firstItem); // Use first item as "main" reference for ID if needed, though we will handle batch
    setOriginalVariantIds(itemsToEdit.map(i => i.id));
    setTotalStock(itemsToEdit.reduce((sum, item) => sum + (item.stock_quantity || 0), 0));
    
    const initialValues = {
        name: firstItem.name,
        category_name: firstItem.category_name,
        image_url: firstItem.image_url,
        promotion_images_text: (firstItem.promotion_image_urls || []).join('\n'),
        promotion_copy: firstItem.promotion_copy,
        purchase_url: firstItem.purchase_url,
        source_url: firstItem.source_url,
        variants: itemsToEdit.map(item => ({
            id: item.id,
            sku: item.sku,
            cost_price: item.cost_price,
            sales_price: item.sales_price,
            stock_quantity: item.stock_quantity,
            unit: item.unit,
            // Calculator fields
            exchange_rate: item.exchange_rate || 5.0,
            price_rmb: item.price_rmb,
            shipping_rmb: item.shipping_rmb,
            weight_kg: item.weight_kg,
            shipping_rate_twd: item.shipping_rate_twd,
            batch_quantity: item.batch_quantity || 1,
            
            min_price: item.min_price,
            max_price: item.max_price,
            pricing_strategy: item.pricing_strategy,
            style: item.style || item.attributes?.style
        }))
    };

    form.setFieldsValue(initialValues);
    setIsModalOpen(true);
  };

  const handleDelete = (id: number) => {
    deleteMutation.mutate(id);
  };

  const pricingStrategyLabels: Record<string, string> = {
    traffic: '引流款',
    profit: '毛利款',
  };

  const filteredProducts = products?.filter((p) => {
    // 商品的 Product 記錄在採購單一建立(含草稿)就會存在，但實體商品要等驗收入庫
    // 後才算真的「有庫存」——過濾掉尚未驗收過的項目，避免在這裡提前出現。
    if (!p.first_received_at) return false;
    const keyword = searchText.toLowerCase();
    // 也能用定價策略（引流款／毛利款）搜尋
    const strategyLabel = p.pricing_strategy ? pricingStrategyLabels[p.pricing_strategy] : undefined;
    return (
      p.name.toLowerCase().includes(keyword) ||
      p.sku.toLowerCase().includes(keyword) ||
      (strategyLabel?.includes(searchText) ?? false)
    );
  });

  // Group products by name
  const groupedData = React.useMemo(() => {
    if (!filteredProducts) return [];
    
    const groups: Record<string, Product[]> = {};
    
    filteredProducts.forEach(product => {
        const name = product.name;
        if (!groups[name]) {
            groups[name] = [];
        }
        groups[name].push(product);
    });
    
    return Object.entries(groups).map(([name, items], index) => {
        // If only one item, display as is
        if (items.length === 1) {
            return { ...items[0], key: items[0].id, isGroup: false };
        }
        
        const totalStock = items.reduce((sum, item) => sum + item.stock_quantity, 0);
        const minCost = Math.min(...items.map(i => i.cost_price));
        const maxCost = Math.max(...items.map(i => i.cost_price));
        const minPrice = Math.min(...items.map(i => i.sales_price));
        const maxPrice = Math.max(...items.map(i => i.sales_price));
        
        return {
            key: `group-${index}`,
            id: -index, 
            name: name,
            category_name: items[0].category_name,
            sku: name, 
            variant_count: items.length,
            cost_price: minCost,
            cost_price_display: minCost === maxCost ? `$${minCost}` : `$${minCost} - $${maxCost}`,
            sales_price: minPrice,
            sales_price_display: minPrice === maxPrice ? `$${minPrice}` : `$${minPrice} - $${maxPrice}`,
            stock_quantity: totalStock,
            unit: items[0].unit,
            children: items.map(item => ({ ...item, key: item.id, isGroup: false })),
            isGroup: true
        } as ProductGroup;
    });
  }, [filteredProducts]);

  const columns: any = [
    { 
        title: '名稱', 
        dataIndex: 'name', 
        key: 'name',
        render: (text: string, record: ProductGroup) => {
           if (record.isGroup) {
               return (
                 <span style={{ fontWeight: 'bold' }}>
                     {record.name} 
                     <span style={{ color: '#999', fontWeight: 'normal', fontSize: '0.85em', marginLeft: 8 }}>
                         ({record.variant_count} 款式)
                     </span>
                 </span>
               );
           }
           return text;
        }
    },
    {
      title: '分類',
      dataIndex: 'category_name',
      key: 'category_name',
      render: (text: string | undefined, record: ProductGroup) => {
        if (record.isGroup) {
          return record.category_name || '-';
        }
        return text || '-';
      }
    },
    { 
      title: 'SKU', 
      dataIndex: 'sku', 
      key: 'sku',
      render: (text: string, record: ProductGroup) => {
          if (record.isGroup) {
              return null;
          }
          return <b>{text}</b>;
      }
    },
    {
        title: '款式',
        dataIndex: 'style',
        key: 'style',
        render: (text: string, record: ProductGroup) => {
            if (record.isGroup) {
                return null;
            }
            return text || record.attributes?.style || '-';
        }
    },
    { 
      title: '成本', 
      dataIndex: 'cost_price', 
      key: 'cost_price',
      render: (val: number, record: ProductGroup) => {
          if (record.isGroup && record.cost_price_display) {
              return record.cost_price_display;
          }
          return `$${val}`;
      }
    },
    { 
      title: '售價', 
      dataIndex: 'sales_price', 
      key: 'sales_price',
      render: (val: number, record: ProductGroup) => {
          if (record.isGroup && record.sales_price_display) {
              return <span style={{ color: '#B25B4C' }}>{record.sales_price_display}</span>;
          }
          return <span style={{ color: '#B25B4C' }}>${val}</span>;
      }
    },
    { 
      title: '庫存', 
      dataIndex: 'stock_quantity', 
      key: 'stock_quantity',
      render: (val: number, record: ProductGroup) => {
        const color = val > 10 ? 'green' : 'red';
        return (
          <Space>
            <Tag color={color}>{val} {record.unit}</Tag>
            {val <= 10 && (
               <Tooltip title="低庫存警示">
                 <AlertOutlined style={{ color: '#B25B4C' }} />
               </Tooltip>
            )}
          </Space>
        );
      }
    },
    {
      title: '操作',
      key: 'action',
      render: (_: unknown, record: ProductGroup) => {
        return (
            <Space size="middle">
              <Button type="text" icon={<EyeOutlined />} onClick={() => handleView(record)} />
              {canEdit && (
              <Popconfirm title="確定刪除此商品(含所有款式)?" onConfirm={() => {
                  // If group, delete all children. If item, delete item.
                  if (record.isGroup && record.children) {
                      record.children.forEach(child => handleDelete(child.id));
                  } else {
                      handleDelete(record.id!);
                  }
              }} okText="是" cancelText="否">
                <Button type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
              )}
            </Space>
        );
      },
    },
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center' }}>
        <Title level={2} style={{ margin: 0 }}>商品管理中心</Title>
        <Space>
           <Input 
             placeholder="搜尋 SKU、名稱或策略（引流款/毛利款）..." 
             prefix={<SearchOutlined />} 
             style={{ width: 250 }}
             onChange={e => setSearchText(e.target.value)}
           />
        </Space>
      </div>
      
      <Table 
        dataSource={groupedData} 
        columns={columns} 
        rowKey="key" 
        loading={isLoading}
        pagination={{ pageSize: 5 }}
      />

      <Modal 
        title={isViewMode ? "商品詳情 (唯讀)" : (editingProduct ? "編輯商品" : "新增商品")} 
        open={isModalOpen} 
        onOk={handleOk} 
        onCancel={handleCloseModal}
        confirmLoading={updateMutation.isPending}
        width={800}
        footer={isViewMode ? [
            canEdit && <Button key="edit" type="primary" onClick={() => setIsViewMode(false)}>
                編輯
            </Button>,
            <Button key="close" onClick={handleCloseModal}>
                關閉
            </Button>
        ] : undefined}
      >
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={24}>
                <Form.Item name="name" label="商品名稱" rules={[{ required: true, message: '請輸入名稱' }]}>
                    {isViewMode ? <ReadOnlyText /> : <Input placeholder="例如: 2025新款T恤" />}
                </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
                <Form.Item name="category_name" label="商品分類">
                    {isViewMode ? (
                        <ReadOnlyText />
                    ) : (
                        <Select
                            allowClear
                            showSearch
                            placeholder="選擇或建立後再套用分類"
                            optionFilterProp="label"
                            options={categories.map((category) => ({
                                label: category.name,
                                value: category.name,
                            }))}
                        />
                    )}
                </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
                <Form.Item label="總庫存 (Total Stock)">
                    <span className="ant-form-text" style={{ fontWeight: 'bold' }}>{totalStock}</span>
                </Form.Item>
            </Col>
          </Row>

          <Row gutter={16}>
            <Col span={12}>
                <Form.Item name="image_url" label="圖片">
                    {isViewMode ? 
                        <Form.Item shouldUpdate noStyle>
                            {({ getFieldValue }) => <ImageDisplay url={getFieldValue('image_url')} />}
                        </Form.Item> 
                        : <Input placeholder="https://..." />
                    }
                </Form.Item>
            </Col>
            <Col span={12}>
                <Form.Item name="source_url" label="採購連結">
                    {isViewMode ? <ReadOnlyText /> : <Input placeholder="1688 / 淘寶連結" />}
                </Form.Item>
            </Col>
          </Row>

          {!isViewMode && (
            <Row gutter={16}>
              <Col span={12}>
                  <Form.Item name="promotion_images_text" label="會員推廣圖片">
                      <TextArea rows={4} placeholder="每行一張圖片網址，會員商品詳情頁將依序展示" />
                  </Form.Item>
              </Col>
              <Col span={12}>
                  <Form.Item name="promotion_copy" label="會員推廣文案">
                      <TextArea rows={4} placeholder="輸入會員前台彈窗與詳情頁要顯示的推廣文案" />
                  </Form.Item>
              </Col>
            </Row>
          )}

          {!isViewMode && (
            <Row gutter={16}>
              <Col span={12}>
                  <Form.Item name="purchase_url" label="會員購買連結">
                      <Input placeholder="https://... 會員前台立即購買用" />
                  </Form.Item>
              </Col>
            </Row>
          )}

          <Divider titlePlacement="left">商品款式 (SKU)</Divider>
          
          <Form.List name="variants">
            {(fields, { add, remove }) => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {fields.map(({ key, name, ...restField }) => (
                        <Card key={key} size="small" type="inner" title={
                            <Form.Item
                                shouldUpdate={(prev, curr) =>
                                    prev.variants?.[name]?.sku !== curr.variants?.[name]?.sku ||
                                    prev.variants?.[name]?.style !== curr.variants?.[name]?.style
                                }
                                noStyle
                            >
                                {({ getFieldValue }) => {
                                    const sku = getFieldValue(['variants', name, 'sku']);
                                    const style = getFieldValue(['variants', name, 'style']);
                                    return (sku || style) ? `${sku || ''}${sku && style ? ' - ' : ''}${style || ''}` : `款式 #${name + 1}`;
                        }}
                    </Form.Item>
                } extra={!isViewMode && <Button danger size="small" onClick={() => remove(name)}>移除</Button>}>
                    <Form.Item
                        {...restField}
                                name={[name, 'id']}
                                hidden
                            >
                                <Input />
                            </Form.Item>
                            
                            <Divider style={{ margin: '12px 0' }}><small style={{ color: '#999' }}>個別成本試算</small></Divider>
                            
                            <Row gutter={16}>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'exchange_rate']} label="匯率" initialValue={5.0}>
                                        {isViewMode ? <ReadOnlyText /> : <InputNumber style={{ width: '100%' }} step={0.1} />}
                                    </Form.Item>
                                </Col>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'price_rmb']} label="RMB單價">
                                        {isViewMode ? <ReadOnlyText prefix="¥" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="¥" />}
                                    </Form.Item>
                                </Col>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'batch_quantity']} label="訂購量" initialValue={1}>
                                        {isViewMode ? <ReadOnlyText /> : <InputNumber style={{ width: '100%' }} min={1} />}
                                    </Form.Item>
                                </Col>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'shipping_rmb']} label="境內運(RMB)" initialValue={0}>
                                        {isViewMode ? <ReadOnlyText prefix="¥" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="¥" />}
                                    </Form.Item>
                                </Col>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'weight_kg']} label="單件重(Kg)" initialValue={0}>
                                        {isViewMode ? <ReadOnlyText suffix="kg" /> : <InputNumber style={{ width: '100%' }} min={0} step={0.1} suffix="kg" />}
                                    </Form.Item>
                                </Col>
                                <Col span={4}>
                                    <Form.Item {...restField} name={[name, 'shipping_rate_twd']} label="集運(TWD/Kg)" initialValue={0}>
                                        {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="$" />}
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item shouldUpdate={(prev, curr) => {
                                const prevV = prev.variants?.[name];
                                const currV = curr.variants?.[name];
                                return (
                                    prevV?.price_rmb !== currV?.price_rmb ||
                                    prevV?.exchange_rate !== currV?.exchange_rate ||
                                    prevV?.batch_quantity !== currV?.batch_quantity ||
                                    prevV?.shipping_rmb !== currV?.shipping_rmb ||
                                    prevV?.weight_kg !== currV?.weight_kg ||
                                    prevV?.shipping_rate_twd !== currV?.shipping_rate_twd
                                );
                            }}>
                                {({ getFieldValue, setFieldsValue }) => {
                                    const variant = getFieldValue(['variants', name]) || {};
                                    const rate = variant.exchange_rate || 5.0;
                                    const pRmb = variant.price_rmb || 0;
                                    const qty = variant.batch_quantity || 1;
                                    const sRmb = variant.shipping_rmb || 0;
                                    const wKg = variant.weight_kg || 0;
                                    const sRateTwd = variant.shipping_rate_twd || 0;

                                    const totalCny = (pRmb * qty) + sRmb;
                                    const totalWeight = wKg * qty;
                                    const totalShippingTwd = Math.ceil(totalWeight * sRateTwd);
                                    const totalCostTwd = Math.ceil(totalCny * rate) + totalShippingTwd;
                                    const unitCostTwd = qty > 0 ? Math.ceil(totalCostTwd / qty) : 0;
                                    
                                    // Auto-update cost_price if it's 0 or empty, OR if we decide to always overwrite
                                    // For now, let's just show the calculated value and update the field
                                    // We need to be careful not to create infinite loops.
                                    // Ideally, we just display it, but user wants it to fill the field.
                                    
                                    // Let's use an effect-like approach? No, render function shouldn't have side effects.
                                    // But setFieldsValue is a side effect.
                                    // Better: Just display the calculated cost clearly, and have a button to "Apply"?
                                    // Or just trust the user to enter it? 
                                    // Requirement: "cost calculation part separately for each product".
                                    // Usually implies auto-calculation.
                                    
                                    // Safe way: Calculate here for display, but also sync to the form field in a useEffect or onChange handler.
                                    // Since we can't easily attach onChange to all those inputs inside Form.List without complex setup,
                                    // we can use a small component wrapper or just do it here with a check.
                                    
                                    const currentCost = getFieldValue(['variants', name, 'cost_price']);
                                    if (currentCost !== unitCostTwd && unitCostTwd > 0) {
                                         // This is risky in render. 
                                         // Let's just use the calculated value as the 'initialValue' or value if controlled?
                                         // Antd Form controls it.
                                         // Let's just display it for now.
                                         setTimeout(() => {
                                             const current = form.getFieldValue(['variants', name, 'cost_price']);
                                             if (current !== unitCostTwd) {
                                                form.setFieldValue(['variants', name, 'cost_price'], unitCostTwd);
                                             }
                                         }, 0);
                                    }

                                    return (
                                        <div style={{ background: '#f0f5ff', padding: '8px 12px', borderRadius: 4, marginBottom: 16, border: '1px solid #adc6ff' }}>
                                            <Space size="large">
                                                <span style={{ fontSize: 12, color: '#666' }}>訂貨金額: ¥{(pRmb * qty + sRmb).toFixed(2)}</span>
                                                <span style={{ fontSize: 12, color: '#666' }}>總集運費: ${Math.ceil(wKg * qty * sRateTwd)}</span>
                                                <span style={{ fontSize: 12, color: '#666' }}>進貨總成本: ${totalCostTwd}</span>
                                                <span style={{ fontSize: 14, fontWeight: 'bold', color: '#1d39c4' }}>
                                                    單品成本 (自動計算): ${unitCostTwd}
                                                </span>
                                            </Space>
                                        </div>
                                    );
                                }}
                            </Form.Item>

                            <Row gutter={16}>
                                <Col span={6}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'sku']}
                                        label="SKU"
                                        rules={[{ required: true, message: '請輸入SKU' }]}
                                    >
                                        {isViewMode ? <ReadOnlyText /> : <Input placeholder="自動生成..." disabled />}
                                    </Form.Item>
                                </Col>
                                <Col span={6}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'style']}
                                        label="款式"
                                    >
                                        {isViewMode ? <ReadOnlyText /> : <Input placeholder="例如: 紅色" />}
                                    </Form.Item>
                                </Col>
                                <Col span={6}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'unit']}
                                        label="單位"
                                        initialValue="個"
                                    >
                                        {isViewMode ? <ReadOnlyText /> : <Input />}
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={16}>
                                <Col span={8}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'cost_price']}
                                        label="成本"
                                    >
                                        {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} prefix="$" />}
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'sales_price']}
                                        label="售價"
                                    >
                                        {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} prefix="$" />}
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Form.Item shouldUpdate={(prev, curr) => {
                                const prevV = prev.variants?.[name];
                                const currV = curr.variants?.[name];
                                return (
                                    prevV?.cost_price !== currV?.cost_price ||
                                    prevV?.sales_price !== currV?.sales_price
                                );
                            }} noStyle>
                                {({ getFieldValue }) => {
                                    const variant = getFieldValue(['variants', name]) || {};
                                    const cost = variant.cost_price || 0;
                                    const sales = variant.sales_price || 0;
                                    const shopeeFee = Math.round(sales * 0.16 * 100) / 100;
                                    const grossProfit = sales - cost - shopeeFee;
                                    const grossMarginRate = sales > 0 ? (grossProfit / sales) * 100 : 0;

                                    return (
                                        <div style={{ background: '#f6ffed', padding: '8px 12px', borderRadius: 4, marginBottom: 16, border: '1px solid #b7eb8f' }}>
                                            <Space size="large">
                                                <span style={{ fontSize: 12, color: '#666' }}>蝦皮抽成(16%): ${shopeeFee.toFixed(0)}</span>
                                                <span style={{ fontSize: 14, fontWeight: 'bold', color: grossProfit >= 0 ? '#4F6B58' : '#B25B4C' }}>
                                                    毛利額: ${grossProfit.toFixed(0)}
                                                </span>
                                                <span style={{ fontSize: 14, fontWeight: 'bold', color: grossProfit >= 0 ? '#4F6B58' : '#B25B4C' }}>
                                                    毛利率: {grossMarginRate.toFixed(1)}%
                                                </span>
                                            </Space>
                                        </div>
                                    );
                                }}
                            </Form.Item>

                            <Row gutter={16}>
                                <Col span={8}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'min_price']}
                                        label="最低價"
                                    >
                                        {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} prefix="$" />}
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'max_price']}
                                        label="最高價"
                                    >
                                        {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} prefix="$" />}
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item
                                        {...restField}
                                        name={[name, 'pricing_strategy']}
                                        label="策略"
                                    >
                                        {isViewMode ? 
                                            <ReadOnlyText options={[{label: '引流款', value: 'traffic'}, {label: '毛利款', value: 'profit'}]} /> : 
                                            <Select placeholder="選擇">
                                                <Option value="traffic">引流款</Option>
                                                <Option value="profit">毛利款</Option>
                                            </Select>
                                        }
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Card>
                    ))}
                </div>
            )}
          </Form.List>
        </Form>

        {showReceivingNotes && receivingNotes.length > 0 && (
          <>
            <Divider titlePlacement="left">驗收備註</Divider>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--sl-fs) * 0.57)' }}>
              {receivingNotes.map((n, i) => {
                const variant = products?.find(p => p.id === n.product_id);
                const variantLabel = [variant?.sku, variant?.style || variant?.attributes?.style].filter(Boolean).join(' / ');
                return (
                  <Card key={`${n.source}-${n.product_id}-${i}`} size="small" styles={{ body: { padding: 'calc(var(--sl-fs) * 0.57) calc(var(--sl-fs) * 0.86)' } }}>
                    <Space size="small" wrap style={{ fontSize: 'calc(var(--sl-fs) * 0.857)', color: 'var(--sl-text-2)' }}>
                      <Tag style={{ margin: 0 }}>{n.source}</Tag>
                      {n.date && <span>{new Date(n.date).toLocaleDateString()}</span>}
                      {n.supplier_name && <span>{n.supplier_name}</span>}
                      {originalVariantIds.length > 1 && variantLabel && <span>{variantLabel}</span>}
                    </Space>
                    <div style={{ marginTop: '0.3em', whiteSpace: 'pre-wrap' }}>{n.note}</div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </Modal>
    </div>
  );
};

export default ProductList;
