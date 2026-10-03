import React, { useState, useEffect, useMemo } from 'react';
import { Table, Button, Modal, Form, Input, InputNumber, Space, message, Popconfirm, Tag, Select, Typography, Row, Col, Card, Divider, Switch, Collapse, DatePicker, Upload, Tabs, Progress, Alert } from 'antd';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, deletePurchaseOrder, getProducts, ensureProduct, getSuppliers, getCategories, generateSku, getAttributes, ensureAttributeOption, UPLOAD_URL, getMyChangeRequests, type ChangeRequest, type ChangeRequestAction } from '../api';
import ChangeRequestModal from '../components/ChangeRequestModal';
import { VoidOrderButton, VoidStatusTag, voidRowStyle } from '../components/VoidOrder';
import { useUser } from '../contexts/UserContext';
import { calculatePurchaseOrder, type POItemInput } from '../utils/poCalculations';
import { parsePurchaseSheetFile, type ImportedPORow } from '../utils/poImport';
import { SupplierOptionLabel, SupplierRiskAlert, showSupplierRiskModal, confirmHighRiskSupplier } from '../components/SupplierRating';
import { PlusOutlined, EditOutlined, DownloadOutlined, DeleteOutlined, EyeOutlined, UploadOutlined, LockOutlined, AuditOutlined, FileExcelOutlined } from '@ant-design/icons';
import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import { isLiffMode } from '../liffSession';

const { Title } = Typography;
const { Option } = Select;
const { RangePicker } = DatePicker;
const NEW_SUPPLIER_PREFIX = '__new_supplier__:';

// 查看已完成/已入庫的採購單時，欄位改用純文字顯示而非灰階 disabled 輸入框——
// Form.Item 會自動把目前值當成 `value` prop 注入，不需要另外手動傳。
const ReadOnlyText: React.FC<{ value?: any; prefix?: React.ReactNode; suffix?: React.ReactNode; options?: { label: string; value: any }[] }> = ({ value, prefix, suffix, options }) => {
    const resolve = (v: any) => {
        if (!options) return v;
        const opt = options.find(o => o.value === v);
        return opt ? opt.label : v;
    };
    if (Array.isArray(value)) {
        if (value.length === 0) return <span className="ant-form-text" style={{ color: '#8c8c8c' }}>-</span>;
        return <span className="ant-form-text">{value.map(resolve).join('、')}</span>;
    }
    if (value === null || value === undefined || value === '') {
        return <span className="ant-form-text" style={{ color: '#8c8c8c' }}>-</span>;
    }
    return <span className="ant-form-text">{prefix}{resolve(value)}{suffix}</span>;
};

// showUploadList={false} 的縮圖按鈕沒有自己的檔案列表可以顯示進度，
// 所以進度條要自己拿 info.file.percent 追蹤——跟驗收頁面（Receiving.tsx）
// 用 antd 內建 file list 顯示進度是同一個上傳流程，只是這裡的 UI 是單一縮圖。
const VariantImageUpload: React.FC<{ value?: string; disabled?: boolean; onUploaded: (url: string) => void }> = ({ value, disabled, onUploaded }) => {
    const [percent, setPercent] = useState<number | null>(null);

    return (
        <Upload
            action={UPLOAD_URL}
            accept="image/*"
            showUploadList={false}
            disabled={disabled}
            onChange={(info) => {
                if (info.file.status === 'uploading') {
                    setPercent(Math.round(info.file.percent ?? 0));
                } else if (info.file.status === 'done') {
                    setPercent(null);
                    onUploaded(info.file.response.url);
                    message.success('圖片上傳成功');
                } else if (info.file.status === 'error') {
                    // showUploadList={false} means antd never renders its own
                    // error state — without this branch a failed request
                    // (wrong UPLOAD_URL host, CORS block, backend down) looks
                    // to the user like nothing happened at all after picking
                    // a file.
                    setPercent(null);
                    message.error('圖片上傳失敗，請確認網路連線或稍後再試');
                }
            }}
        >
            {percent !== null ? (
                <Progress type="circle" percent={percent} size={30} />
            ) : value ? (
                <img src={value} style={{ width: 30, height: 30, objectFit: 'cover' }} />
            ) : (
                <Button size="small" icon={<UploadOutlined />} disabled={disabled} />
            )}
        </Upload>
    );
};

const PurchaseOrderList: React.FC = () => {
  // 從 LINE 開啟時隱藏跟 LINE 專用功能衝突、或在 LINE 內建瀏覽器用不了的功能（匯入／匯出等）
  const fromLine = isLiffMode();
  // 從 LINE 開啟時，建立／編輯採購單彈窗改用 LINE 版的排版（theme/slowlife.css 的 .sl-po-line、.sl-liff-*）；電腦上不加任何 class
  const lineCls = (cls: string) => (fromLine ? cls : undefined);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // Guards against double-clicking "新增商品" while its own generateSku() call
  // is still in flight — the button had no loading/disabled state, so a second
  // click during that gap (worse now that the network hop can be slow) fired
  // a second, independent add and produced a duplicated product entry.
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  // Same re-entrancy guard as isAddingProduct, but per-product-group since
  // "新增款式" exists once per product — keyed by the group's index.
  const [addingVariantFor, setAddingVariantFor] = useState<Set<number>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { hasPermission } = useUser();
  // 以核准權限或簽呈臨時權限打開「已完成」採購單的編輯
  const [unlockedEdit, setUnlockedEdit] = useState(false);
  const [requestTarget, setRequestTarget] = useState<any>(null);

  const { data: pos, isLoading: isPOLoading } = useQuery({ queryKey: ['purchase_orders'], queryFn: getPurchaseOrders });

  // 已完成（待驗收）的採購單是鎖定的：核准權限可直接改，其他人要送簽呈拿臨時權限
  const canCreatePOs = hasPermission('create_purchase_orders');
  const canEditPOs = hasPermission('edit_purchase_orders');
  const canApprove = hasPermission('approve_purchase_orders');
  const { data: myRequests } = useQuery({
    queryKey: ['change_requests', 'mine', 'purchase_order'],
    queryFn: () => getMyChangeRequests('purchase_order'),
    enabled: canEditPOs && !canApprove,
  });
  const activeGrant = (poId: number, action: ChangeRequestAction): ChangeRequest | undefined =>
    myRequests?.find(r => r.resource_id === poId && r.action === action && r.effective_status === 'active');
  const hasPendingRequest = (poId: number) =>
    !!myRequests?.some(r => r.resource_id === poId && r.effective_status === 'pending');

  const filteredPOs = pos?.filter((po: any) => {
    if (!dateRange || !dateRange[0] || !dateRange[1]) return true;
    const poDate = dayjs(po.order_date);
    return poDate.isAfter(dateRange[0].startOf('day')) && poDate.isBefore(dateRange[1].endOf('day'));
  });

  const draftPOs = filteredPOs?.filter((po: any) => po.status === 'draft');
  const completedPOs = filteredPOs?.filter((po: any) => po.status === 'completed' || po.status === 'received');

  const { data: products } = useQuery({ queryKey: ['products'], queryFn: getProducts });
  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: getCategories });
  const { data: attributes } = useQuery({ queryKey: ['attributes'], queryFn: getAttributes });
  const attributeOptionLabels = useMemo(() => (
    (attributes || []).flatMap((attr: any) => (attr.options || []).map((opt: any) => ({ label: opt.value, value: opt.id })))
  ), [attributes]);
  const { data: suppliers } = useQuery({ 
    queryKey: ['suppliers'], 
    queryFn: () => getSuppliers() 
  });

  // Watch for status changes to disable form
  const status = Form.useWatch('status', form);
  const findSupplier = (name?: string) => suppliers?.find((s: any) => s.name === name);
  const canCreateSuppliers = hasPermission('create_suppliers');
  // 供應商下拉框目前輸入的搜尋字；查無此供應商時提供「新增」選項。
  // 新名稱先只記在採購項目上，等採購單改成已完成、該商品款式勾了確認，後端才正式建立供應商（只有名稱，細節之後到供應商管理補）
  const [supplierSearch, setSupplierSearch] = useState('');
  const formItems = Form.useWatch('items', form);
  const pendingSupplierNames: string[] = Array.from(new Set(
    (formItems || []).map((group: any) => group?.supplier_name).filter((n: any): n is string => !!n && !findSupplier(n))
  ));
  const supplierOptions = (search: string) => {
    const options: any[] = suppliers?.map((s: any) => ({ value: s.name, label: <SupplierOptionLabel supplier={s} /> })) || [];
    pendingSupplierNames.forEach((n) => options.push({ value: n, label: <span>{n} <Tag color="gold">待建立</Tag></span> }));
    const name = search.trim();
    if (canCreateSuppliers && name && !findSupplier(name) && !pendingSupplierNames.includes(name)) {
      options.push({ value: NEW_SUPPLIER_PREFIX + name, label: <span><PlusOutlined /> 新增供應商「{name}」</span> });
    }
    return options;
  };
  const handleSupplierChange = (itemName: number, value: string) => {
    setSupplierSearch('');
    if (!value?.startsWith(NEW_SUPPLIER_PREFIX)) {
      showSupplierRiskModal(findSupplier(value));
      return;
    }
    const supplierName = value.slice(NEW_SUPPLIER_PREFIX.length);
    form.setFieldValue(['items', itemName, 'supplier_name'], supplierName);
    message.info(`「${supplierName}」會在採購單改成已完成、且該商品款式勾選確認後，才正式新增到供應商管理`);
  };

  // Determine if we are in "View Mode" (Opened a Completed/Received PO)
  // We use the original status from the data source, not the current form value.
  const currentPO = pos?.find((p: any) => p.id === editingId);
  const originalStatus = currentPO?.status;
  // 報廢審核中／已報廢，或沒有修改權限：任何狀態的單都只能查看
  const isViewMode = ((originalStatus === 'completed' || originalStatus === 'received') && !unlockedEdit)
    || (!!editingId && (!!currentPO?.void_status || !canEditPOs));
  const editGrant = editingId && unlockedEdit && !canApprove ? activeGrant(editingId, 'edit') : undefined;
  
  // Logic for disabling fields:
  // 1. If in View Mode (opened a completed PO), everything is disabled (including Status and Update button).
  // 2. If in Edit Mode, but user switches Status to 'completed', then content fields should be disabled to preview "Locked" state,
  //    BUT Status field and Update button must remain ENABLED to allow saving.
  
  // Global disable (for View Mode)
  const isGlobalDisabled = isViewMode;

  // Content disable (for fields other than Status/Update button)
  // Disabled if View Mode OR if user selected 'completed'/'received' in the form
  // 以權限解鎖編輯已完成的採購單時，狀態維持「已完成」也要能改內容
  const isContentDisabled = isViewMode || status === 'received' || (status === 'completed' && !unlockedEdit);

  const createMutation = useMutation({
    mutationFn: createPurchaseOrder,
    onSuccess: () => {
      message.success('採購單建立成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: () => {
      message.error('建立失敗');
    }
  });

  const updateMutation = useMutation({
    mutationFn: updatePurchaseOrder,
    onSuccess: () => {
      message.success('採購單更新成功');
      handleCloseModal();
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      queryClient.invalidateQueries({ queryKey: ['change_requests'] });
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || '更新失敗');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deletePurchaseOrder,
    onSuccess: () => {
      message.success('採購單已刪除');
      queryClient.invalidateQueries({ queryKey: ['purchase_orders'] });
    },
    onError: (error: any) => {
      message.error(error.response?.data?.detail || '刪除失敗');
    }
  });

  const ensureProductMutation = useMutation({
    mutationFn: ensureProduct,
  });

  // 已完成採購單的「修改／申請修改」按鈕（採購單不能刪除，報廢另外處理）
  const renderLockedActions = (record: any) => {
    const canEdit = canApprove || !!activeGrant(record.id, 'edit');
    return (
      <>
        {canEdit && <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record, true)}>修改</Button>}
        {!canApprove && (hasPendingRequest(record.id)
          ? <Tag color="gold">簽呈審核中</Tag>
          : <Button type="text" icon={<AuditOutlined />} onClick={() => setRequestTarget(record)}>申請修改</Button>)}
      </>
    );
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingId(null);
    setUnlockedEdit(false);
    form.resetFields();
  };

  const handleEdit = (record: any, unlock = false) => {
    setEditingId(record.id);
    setUnlockedEdit(unlock);
    
    // Map items to form format
    // Group items by name and source_url to reconstruct "Product Families"
    const groupedItems: Record<string, any> = {};

    record.items.forEach((item: any) => {
        const product = products?.find((p: any) => p.id === item.product_id);
        if (!product) return;

        // 舊資料的項目沒有自己的供應商，沿用整張單的
        const supplierName = item.supplier_name ?? record.supplier_name;
        // Create a unique key for grouping (Supplier + Name + Source URL)
        const key = `${supplierName}-${product.name}-${product.source_url}`;

        if (!groupedItems[key]) {
            // Initialize Group
            groupedItems[key] = {
                supplier_name: supplierName,
                name: product.name,
                category: product.category_name ?? product.attributes?.category,
                source_url: product.source_url,
                image_url: product.image_url, // Use the first image as group image? Or keep per variant?
                exchange_rate: product.exchange_rate,
                price_rmb: product.price_rmb, // Default price
                shipping_rmb: product.shipping_rmb,
                weight_kg: product.weight_kg,
                shipping_rate_twd: product.shipping_rate_twd,
                sales_price: product.sales_price,
                pricing_strategy: product.pricing_strategy,
                min_price: product.min_price,
                max_price: product.max_price,
                is_confirmed: product.is_confirmed, // If any confirmed? Or assume group level? 
                // Wait, confirmed is per item. But for UI simplicity, maybe per group?
                // Let's keep it simple: If one is confirmed, show checked? 
                // Or better: move confirmation to variant level? 
                // Requirement said "Purchase Order items in form are now collapsible".
                // Let's keep common fields at group level.
                variants: []
            };
        }

        // Add Variant
        groupedItems[key].variants.push({
            sku: product.sku,
            style: product.attributes?.style,
            size: product.attributes?.size,
            batch_quantity: item.quantity,
            note: item.note,
            image_url: product.image_url,
            // Override price/weight if different from group?
            // For now, just keep them in variant too to be safe
            price_rmb: product.price_rmb,
            weight_kg: product.weight_kg,
            shipping_rmb: product.shipping_rmb,
            sales_price: product.sales_price,
            is_confirmed: product.is_confirmed,
            attribute_option_ids: product.attribute_options?.map((opt: any) => opt.id) || []
        });
    });

    form.setFieldsValue({
        purchaser_name: record.purchaser_name,
        status: record.status,
        tariff: record.tariff,
        items: Object.values(groupedItems)
    });
    
    // If status is completed or received, we might be in 'view' mode, 
    // but user wants to ensure everything is disabled (read-only) initially.
    // The state `isCompleted` derived from `status` form value will handle the disabling in the render.
    // However, if we just opened it, the form value is set above.
    // The `useWatch` hook will update `status` and `isCompleted` in the next render cycle, 
    // so the UI will correctly disable fields.
    
    setIsModalOpen(true);
  };

  const handleCreate = async () => {
      setEditingId(null);
      form.resetFields(); // Clear previous values
      
      // Initialize with default structure
      const defaultItem = { 
          exchange_rate: 5.0, 
          variants: [{ batch_quantity: 1, sku: '' }] 
      };

      try {
          const res = await generateSku();
          defaultItem.variants[0].sku = res.sku;
      } catch (e) {
          console.error("Failed to generate SKU", e);
      }
      
      form.setFieldsValue({ 
          status: 'draft', 
          purchaser_name: getPurchaserName(),
          items: [defaultItem] 
      });
      
      setIsModalOpen(true);
  };

  // Auto-fill purchaser from local storage
  const getPurchaserName = () => {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return user.full_name || user.username || 'System';
  };

  // 匯入進貨單 Excel：只把輸入欄填進編輯清單，公式欄交給下面的試算重新計算。
  // 不會送出建立，使用者確認後自己按「建立」。
  const buildItemsFromImport = async (rows: ImportedPORow[]) => {
      return Promise.all(rows.map(async (row) => {
          // 同連結＋同款式的商品已經存在就沿用它的 SKU（回購），並帶上原本的屬性與圖片，
          // 否則 ensureProduct 會用空的屬性清單把原商品的屬性清掉
          const existing = products?.find((p: any) =>
              (row.sku && p.sku === row.sku) ||
              (!row.sku && row.source_url && p.source_url?.trim() === row.source_url && (p.attributes?.style ?? p.style) === row.style));
          const sku = existing?.sku || row.sku || (await generateSku()).sku;
          return {
              supplier_name: row.supplier_name,
              category: row.category,
              name: row.name,
              source_url: row.source_url,
              exchange_rate: row.exchange_rate ?? 5.0,
              price_rmb: row.price_rmb,
              shipping_rmb: row.shipping_rmb,
              weight_kg: row.weight_kg,
              shipping_rate_twd: row.shipping_rate_twd,
              sales_price: row.sales_price,
              pricing_strategy: row.pricing_strategy,
              min_price: row.min_price,
              max_price: row.max_price,
              variants: [{
                  sku,
                  style: row.style,
                  size: row.size ?? existing?.attributes?.size,
                  batch_quantity: row.quantity,
                  is_confirmed: row.is_confirmed ?? false,
                  image_url: row.image_url || existing?.image_url,
                  attribute_option_ids: existing?.attribute_options?.map((opt: any) => opt.id) || [],
              }],
              _reused: !!existing,
          };
      }));
  };

  const handleImportSheet = async (file: File) => {
      if (isImporting) return;
      setIsImporting(true);
      try {
          const parsed = await parsePurchaseSheetFile(file);
          if (parsed.rows.length === 0) {
              message.error(`匯入失敗：${parsed.warnings[0] || '沒有可匯入的資料'}`);
              return;
          }

          let imported;
          try {
              imported = await buildItemsFromImport(parsed.rows);
          } catch {
              message.error('SKU 產生失敗，請稍後再匯入一次（可能是網路暫時不穩）');
              return;
          }
          const reusedCount = imported.filter(i => i._reused).length;
          const items = imported.map(({ _reused, ...item }) => item);

          const warnings = [...parsed.warnings];
          const unknownCategories = [...new Set(parsed.rows.map(r => r.category).filter((c): c is string =>
              !!c && !categories?.some((cat: any) => cat.name === c)))];
          const unknownSuppliers = [...new Set(parsed.rows.map(r => r.supplier_name).filter((n): n is string => !!n && !findSupplier(n)))];
          if (unknownSuppliers.length) warnings.push(`供應商管理裡還沒有這些供應商，採購單改成已完成、且該商品款式勾選確認後會自動新增：${unknownSuppliers.join('、')}`);
          if (unknownCategories.length) warnings.push(`系統沒有這些類別，請改選或先到類別管理新增：${unknownCategories.join('、')}`);
          if (reusedCount) warnings.push(`${reusedCount} 項商品的連結與款式和現有商品相同，已沿用原本的 SKU（建立時會更新該商品的價格資料）`);

          setEditingId(null);
          setUnlockedEdit(false);
          form.resetFields();
          form.setFieldsValue({
              status: 'draft',
              purchaser_name: getPurchaserName(),
              tariff: parsed.tariff,
              items,
          });
          setIsModalOpen(true);

          message.success(`已匯入 ${items.length} 項商品，請確認每項商品的供應商與內容後再按「建立」`);
          if (warnings.length) {
              Modal.warning({
                  title: '匯入完成，有幾點需要確認',
                  width: 560,
                  content: <ul style={{ paddingLeft: '1.5em', margin: 0 }}>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>,
              });
          }
      } catch (e) {
          console.error(e);
          message.error('無法讀取檔案，請確認是 Excel（.xlsx）格式');
      } finally {
          setIsImporting(false);
      }
  };

  const importButton = (
      <Upload
          accept=".xlsx,.xls,.csv"
          showUploadList={false}
          beforeUpload={(file) => { handleImportSheet(file); return Upload.LIST_IGNORE; }}
          disabled={isImporting}
      >
          <Button icon={<FileExcelOutlined />} loading={isImporting}>匯入採購單</Button>
      </Upload>
  );

  // Removed useEffect for auto-generating SKU as it is now handled in handleCreate
  // preventing race conditions on first load.


  const handleExportExcel = (record: any) => {
    // Prepare data for export
    // If record is provided, export single PO. If not (e.g. from main list), maybe export all? 
    // Requirement says "In the operation area", so it likely means exporting the list of items in the PO being edited/viewed?
    // OR exporting the list of POs?
    // User said: "In the operation area help me add an export button". Usually this means exporting the *current list view* or *current PO detail*.
    // Given the context of "Import button next to Create PO", the export button "In the operation area" (Table actions?) might be for exporting PO details.
    
    // Let's implement Export for the Table List first (Export all POs summary)
    // AND Export for specific PO items (in the actions column or inside modal).
    
    // User said "In the operation place help me add export button".
    // I'll add a global export button next to Create PO for exporting the PO List.
    // And maybe an export button for each PO to export its items?
    
    // Let's start with exporting the PO List since it's "next to Create PO" contextually? 
    // Wait, "next to Create PO" is for Import.
    // "In the operation place" (操作的地方) usually refers to the Actions column in the table.
    
    // Let's add Export to the Actions column for each PO to export its items.
    
    const items = record.items.map((item: any) => {
        // We need to merge with product details to get full info
        const product = products?.find((p: any) => p.id === item.product_id) || {};
        
        // Calculations for export
        const rate = product.exchange_rate || 5.0;
        const pRmb = product.price_rmb || 0;
        const qty = item.quantity || 1;
        const sRmb = product.shipping_rmb || 0;
        const wKg = product.weight_kg || 0;
        const sRateTwd = product.shipping_rate_twd || 0;
        const salesPrice = product.sales_price || 0;

        const orderAmountCny = (pRmb * qty) + sRmb;
        const totalWeight = parseFloat((wKg * qty).toFixed(4));
        const shippingFeeTwd = Math.round(totalWeight * sRateTwd * 100) / 100;
        const totalCostTwd = Math.round(((orderAmountCny * rate) + shippingFeeTwd) * 100) / 100;
        // Unit cost: round to 2 decimals
        const unitCostTwd = qty > 0 ? Math.round((totalCostTwd / qty) * 100) / 100 : 0;
        const shopeeFee = Math.round(salesPrice * 0.16 * 100) / 100;
        const profit = Math.round((salesPrice - unitCostTwd - shopeeFee) * 100) / 100;
        const margin = salesPrice > 0 ? ((profit / salesPrice) * 100).toFixed(1) + '%' : '0%';

        return {
            '供應商': item.supplier_name ?? record.supplier_name,
            '類別': product.attributes?.category,
            '商品名稱': product.name,
            '訂貨連結': product.source_url,
            '款式': item.style || product.attributes?.style,
            '尺寸': item.size || product.attributes?.size,
            '訂貨單價(CNY)': product.price_rmb,
            '訂購數量': item.quantity,
            '境內運費(選填)': product.shipping_rmb,
            '每件重量(Kg)': product.weight_kg,
            '訂貨金額(CNY)': orderAmountCny,
            'CNY匯率': product.exchange_rate,
            '1公斤集運費(NTD)': product.shipping_rate_twd,
            '集運費(NTD)': shippingFeeTwd,
            '進貨成本(NTD)': totalCostTwd,
            '單品成本 (NTD)': unitCostTwd,
            '預計售價 (台幣售價)': product.sales_price,
            '蝦皮金流抽成(16%)': shopeeFee,
            '毛利率': margin,
            '訂購確認': product.is_confirmed ? 'TRUE' : 'FALSE',
            '定價策略': product.pricing_strategy,
            '最低價': product.min_price,
            '最高價': product.max_price,
            'SKU': product.sku || item.sku, // Keep SKU at the end or wherever useful
            '圖片連結': product.image_url,
            '單位': product.unit,
        };
    });

    const ws = XLSX.utils.json_to_sheet(items);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `PO-${record.id}`);
    XLSX.writeFile(wb, `PurchaseOrder_${record.id}.xlsx`);
  };

  const handleAddProduct = async (addFn: (val: any) => void) => {
      if (isAddingProduct) return; // already in flight from a previous click
      setIsAddingProduct(true);
      try {
          const result = await generateSku();
          const items = form.getFieldValue('items') || [];
          addFn({
              // 預設沿用上一項的供應商，同一家多項商品時不用每次重選
              supplier_name: items[items.length - 1]?.supplier_name,
              exchange_rate: 5.0,
              variants: [{
                  batch_quantity: 1,
                  sku: result.sku,
              }]
          });
      } catch {
          // SKU generation failed (e.g. a transient network blip) — the SKU
          // field is read-only, so silently adding a variant with no SKU
          // used to leave it permanently unfixable until the whole variant
          // was deleted and re-added. Surface the failure immediately instead
          // of only discovering it at submit time via the "必須先選擇SKU" check.
          message.error('SKU 產生失敗，請稍後再試一次「新增商品」(可能是網路暫時不穩)');
      } finally {
          setIsAddingProduct(false);
      }
  };

  const handleOk = async () => {
    try {
        const values = await form.validateFields();
        // Ant Design's nested Form.List (variants inside items) can leave a
        // ghost entry in a newly-added item's variants array under certain
        // conditions — confirmed via live debugging on 2026-09-20:
        // handleAddProduct only fired once and only ever supplied one
        // variant, yet the resulting form value had two. JSON.stringify
        // renders that ghost as "{}", but that's misleading — it can mean
        // "every field present with value undefined" just as easily as
        // "zero keys" (JSON.stringify silently drops undefined-valued keys),
        // so checking Object.keys(v).length isn't enough. Check that at
        // least one field actually holds a real value instead.
        values.items.forEach((group: any) => {
            group.variants = (group.variants || []).filter((v: any) =>
                v && Object.values(v).some((val) => val !== undefined && val !== null && val !== '')
            );
        });

        // Strict SKU Validation
        for (let i = 0; i < values.items.length; i++) {
            const group = values.items[i];
            const variants = group.variants || [];
            if (variants.length === 0) {
                 // Should have at least one variant if it's a valid item structure? 
                 // Or maybe just check if there are variants.
                 // If no variants, it might be an empty group, which should be removed or alerted.
                 // But typically the UI initializes with one variant.
            }

            for (let j = 0; j < variants.length; j++) {
                const variant = variants[j];
                if (!variant.sku) {
                    message.error('此項目必須先選擇SKU才能建立採購單');
                    // Focus on the specific SKU field
                    form.scrollToField(['items', i, 'variants', j, 'sku']);
                    return;
                }
            }
        }

        // 1. Prepare inputs for calculation
        const inputs: POItemInput[] = [];
        for (const group of values.items) {
            const variants = group.variants || [];
            const rate = group.exchange_rate || 5.0;
            const sRateTwd = group.shipping_rate_twd || 0;
            
            for (const variant of variants) {
                inputs.push({
                    sku: variant.sku,
                    unitPriceRMB: variant.price_rmb ?? group.price_rmb ?? 0,
                    quantity: variant.batch_quantity || 0,
                    weightKg: variant.weight_kg ?? group.weight_kg ?? 0,
                    domesticFreightRMB: variant.shipping_rmb ?? group.shipping_rmb ?? 0,
                    shippingUnitPriceTWD: sRateTwd,
                    exchangeRate: rate
                });
            }
        }

        // 2. Perform Calculation
        // Include tariff in calculation
        const tariff = values.tariff || 0;
        const calculation = calculatePurchaseOrder(inputs, {
            additionalCostNTD: tariff
        });

        // 3. Process items for saving (ensure products exist)
        const processedItems = [];
        
        const resolveAttributes = async (optionIdsOrStrings: any[]) => {
            const finalIds: number[] = [];
            for (const item of optionIdsOrStrings || []) {
                if (typeof item === 'number') {
                    finalIds.push(item);
                } else if (typeof item === 'string') {
                    let attrName = '標籤';
                    let attrVal = item;
                    if (item.includes(':')) {
                        const parts = item.split(':');
                        attrName = parts[0].trim();
                        attrVal = parts.slice(1).join(':').trim();
                    } else if (item.includes('：')) {
                        const parts = item.split('：');
                        attrName = parts[0].trim();
                        attrVal = parts.slice(1).join('：').trim();
                    }
                    try {
                        const newOpt = await ensureAttributeOption(attrName, attrVal);
                        finalIds.push(newOpt.id);
                    } catch (err) {
                        console.error('Failed to create attribute option', err);
                    }
                }
            }
            return finalIds;
        };
        
        for (const group of values.items) {
            const variants = group.variants || [];
            const rate = group.exchange_rate || 5.0;
            const sRateTwd = group.shipping_rate_twd || 0;
            
            for (const variant of variants) {
                // Find calculated unit cost for this SKU
                const skuResult = calculation.items.find(r => r.sku === variant.sku);
                const unitCost = skuResult ? skuResult.unitCostNTD : 0;
                
                // Resolve inline attributes
                const finalAttrIds = await resolveAttributes(variant.attribute_option_ids);

                // Prepare product data
                const productData = {
                    sku: variant.sku,
                    name: group.name,
                    style: variant.style,
                    category_name: group.category,
                    attributes: {
                        style: variant.style,
                        size: variant.size,
                        category: group.category
                    },
                    source_url: group.source_url,
                    image_url: variant.image_url || group.image_url,
                    exchange_rate: rate,
                    price_rmb: variant.price_rmb ?? group.price_rmb ?? 0,
                    shipping_rmb: variant.shipping_rmb ?? group.shipping_rmb ?? 0,
                    weight_kg: variant.weight_kg ?? group.weight_kg ?? 0,
                    shipping_rate_twd: sRateTwd,
                    sales_price: variant.sales_price ?? group.sales_price,
                    pricing_strategy: group.pricing_strategy,
                    cost_price: unitCost,
                    is_confirmed: variant.is_confirmed,
                    attribute_option_ids: finalAttrIds
                };

                let productId;
                try {
                    const product = await ensureProductMutation.mutateAsync(productData);
                    productId = product.id;
                } catch (e) {
                    message.error(`商品 ${variant.sku} 處理失敗`);
                    console.error(e);
                    return;
                }

                processedItems.push({
                    product_id: productId,
                    quantity: variant.batch_quantity || 0,
                    unit_price: unitCost,
                    supplier_name: group.supplier_name
                });
            }
        }

        // 整張單的供應商欄位：各項目供應商去重後串起來（後端也會用同樣規則重算）
        const supplierNames: string[] = Array.from(new Set(values.items.map((group: any) => group.supplier_name).filter(Boolean)));
        const payload = {
            supplier_name: supplierNames.join('、'),
            status: values.status || 'draft',
            total_amount: calculation.grandTotalOrderAmountRMB,
            total_weight: parseFloat(calculation.grandTotalWeightKg.toFixed(2)),
            total_shipping_fee: calculation.grandTotalShippingFeeTWD,
            total_cost: calculation.grandTotalCostNTD,
            // tariff included in total_cost now
            tariff: tariff,
            items: processedItems
        };
        
        // Validation: If status is 'completed', ensure at least one item is confirmed
        if (payload.status === 'completed') {
            // Need to check if any variant is confirmed
            const hasConfirmed = values.items.some((group: any) => 
                group.variants?.some((v: any) => v.is_confirmed)
            );
            
            if (!hasConfirmed) {
                message.error('無法完成採購單：請至少確認一項商品 (訂購確認)');
                return;
            }
        }

        if (editingId) {
            updateMutation.mutate({ id: editingId, data: payload });
        } else {
            for (const name of supplierNames) {
                if (!(await confirmHighRiskSupplier(findSupplier(name)))) return;
            }
            createMutation.mutate(payload);
        }

    } catch (error) {
        console.error("Validation Failed:", error);
    }
  };

  const columns = [
    { title: '訂單編號', dataIndex: 'id', key: 'id', render: (id: number) => `PO-${id}` },
    { title: '供應商', dataIndex: 'supplier_name', key: 'supplier_name' },
    { title: '採購者', dataIndex: 'purchaser_name', key: 'purchaser_name' },
    { title: '總重量(kg)', dataIndex: 'total_weight', key: 'total_weight', render: (val: number) => val ? `${val} kg` : '-' },
    { title: '總集運費', dataIndex: 'total_shipping_fee', key: 'total_shipping_fee', render: (val: number) => val ? `$${val}` : '-' },
    { title: '總進貨成本', dataIndex: 'total_cost', key: 'total_cost', render: (val: number) => val ? `$${Number(val).toFixed(2)}` : '-' },
    { title: '總訂貨金額(RMB)', dataIndex: 'total_amount', key: 'total_amount', render: (val: number) => `¥${Number(val || 0).toFixed(2)}` },
    { 
      title: '狀態', 
      dataIndex: 'status', 
      key: 'status',
      render: (status: string, record: any) => {
        let color = 'blue';
        let text = status.toUpperCase();
        if (status === 'draft') { color = 'default'; text = '新訂單/編輯中'; }
        if (status === 'completed') { color = 'orange'; text = '已完成 (待驗收)'; }
        if (status === 'received') { color = 'green'; text = '已入庫'; }
        return <Space size={4} wrap><Tag color={color}>{text}</Tag><VoidStatusTag record={record} /></Space>;
      }
    },
    { title: '建立日期', dataIndex: 'order_date', key: 'order_date', render: (date: string) => new Date(date).toLocaleDateString() },
    {
        title: '操作',
        key: 'action',
        render: (_: unknown, record: any) => {
            const isCompleted = record.status === 'completed' || record.status === 'received';
            // 報廢審核中／已報廢的單只能查看與匯出
            const frozen = !!record.void_status;
            return (
                <Space wrap>
                    {!isCompleted && !frozen && canEditPOs ? (
                        <Button type="text" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
                    ) : (
                        <Button type="text" icon={<EyeOutlined />} onClick={() => handleEdit(record)}>查看</Button>
                    )}
                    {record.status === 'completed' && !frozen && canEditPOs && renderLockedActions(record)}
                    {/* 草稿還沒動到庫存與記帳，直接刪除；已完成之後才走報廢 */}
                    {record.status === 'draft' && !frozen ? (
                        canEditPOs && (
                            <Popconfirm
                                title={`確定要刪除草稿採購單 PO-${record.id}？`}
                                description="刪除後無法復原"
                                okText="刪除"
                                okButtonProps={{ danger: true }}
                                cancelText="取消"
                                onConfirm={() => deleteMutation.mutateAsync(record.id)}
                            >
                                <Button type="text" danger icon={<DeleteOutlined />}>刪除</Button>
                            </Popconfirm>
                        )
                    ) : (
                        <VoidOrderButton
                            resourceType="purchase_order"
                            record={record}
                            resourceLabel={`採購單 PO-${record.id}（${record.supplier_name}）`}
                            canApprove={canApprove}
                            canRequest={canEditPOs}
                        />
                    )}
                    {!fromLine && <Button type="text" icon={<DownloadOutlined />} onClick={() => handleExportExcel(record)}>匯出</Button>}
                </Space>
            );
        }
    }
  ];

  return (
    <div style={{ padding: '24px' }}>
      <div className="sl-page-head" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24, alignItems: 'center' }}>
        <Title level={2} style={{ margin: 0 }}>採購單管理</Title>
        <Space>
            <RangePicker 
                onChange={(dates) => setDateRange(dates as any)} 
                placeholder={['開始日期', '結束日期']}
            />
            {/* 從 LINE 開啟時不提供 Excel 匯入（手機選不到 .xlsx） */}
            {canCreatePOs && !fromLine && importButton}
            {canCreatePOs && <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>建立採購單</Button>}
        </Space>
      </div>
      
      <Tabs defaultActiveKey="1" items={[
        {
            key: '1',
            label: '未完成',
            children: (
                <Table 
                    dataSource={draftPOs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isPOLoading} 
                    pagination={{ pageSize: 5 }}
                    locale={{ emptyText: '目前沒有未完成的採購單' }}
                />
            )
        },
        {
            key: '2',
            label: '已完成',
            children: (
                <Table 
                    dataSource={completedPOs} 
                    columns={columns} 
                    rowKey="id" 
                    onRow={(record: any) => ({ style: voidRowStyle(record) })}
                    loading={isPOLoading} 
                    pagination={{ pageSize: 5 }}
                    locale={{ emptyText: '目前沒有已完成的採購單' }}
                />
            )
        }
      ]} />

      <Modal 
        title={fromLine ? (
          <div className="sl-liff-hero">
            <div className="sl-liff-eyebrow">採購進貨</div>
            <div className="sl-liff-title">{editingId ? "編輯採購單" : "建立採購單"}</div>
          </div>
        ) : (editingId ? "編輯採購單" : "建立新採購單")} 
        open={isModalOpen} 
        onOk={handleOk} 
        onCancel={handleCloseModal} 
        className={lineCls("sl-po-line")}
        width={fromLine ? '100%' : 1100}
        okText={editingId ? "更新" : "建立"}
        cancelText="取消"
        okButtonProps={{ disabled: isGlobalDisabled }}
        destroyOnHidden
      >
        {unlockedEdit && (
          <Alert
            style={{ marginBottom: 16 }}
            type="warning"
            showIcon
            message={editGrant
              ? `正在以簽呈 #${editGrant.id} 的臨時權限修改已完成的採購單（剩 ${editGrant.max_uses - editGrant.used_count} 次，${dayjs(editGrant.expires_at).format('MM/DD HH:mm')} 前有效），儲存後會記錄在系統日誌`
              : '正在以核准權限修改已完成的採購單，儲存後會記錄在系統日誌'}
          />
        )}
        <Form form={form} layout="vertical">
          <Row gutter={16} className={lineCls("sl-liff-card sl-liff-grid sl-liff-grid--wide")}>
            <Col span={8}>
                <Form.Item name="purchaser_name" label="採購者">
                    <Input readOnly disabled style={{ cursor: 'default', color: 'rgba(0, 0, 0, 0.88)' }} />
                </Form.Item>
            </Col>
            <Col span={8}>
                <Form.Item name="tariff" label="關稅">
                    {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="$" disabled={isContentDisabled} />}
                </Form.Item>
            </Col>
            <Col span={8}>
                <Form.Item name="status" label="狀態">
                    {isViewMode ? (
                        <ReadOnlyText options={[
                            { label: '新訂單 / 編輯中', value: 'draft' },
                            { label: '已完成', value: 'completed' },
                            { label: '已入庫', value: 'received' },
                        ]} />
                    ) : (
                        <Select disabled={isGlobalDisabled || (unlockedEdit && !canApprove)}>
                            <Option value="draft">新訂單 / 編輯中</Option>
                            <Option value="completed">已完成 (鎖定)</Option>
                            {/* Received status should be set via Receiving page */}
                        </Select>
                    )}
                </Form.Item>
            </Col>
          </Row>
          
          <Typography.Title level={5} className={lineCls("sl-liff-section")}>採購商品明細</Typography.Title>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Collapse 
                    className={lineCls("sl-liff-collapse")}
                    defaultActiveKey={fields.map(f => f.key)} 
                    items={fields.map(({ key, name, ...restField }) => {
                        // Dynamically get the name/SKU for header
                        // Try to get SKU from the first variant if available
                        const firstVariantSku = form.getFieldValue(['items', name, 'variants', 0, 'sku']);
                        const itemSku = firstVariantSku || form.getFieldValue(['items', name, 'sku']);
                        const itemName = form.getFieldValue(['items', name, 'name']) || '';
                        const header = itemSku ? `${itemSku} ${itemName ? `- ${itemName}` : ''}` : (
                            <span style={{ color: '#B25B4C' }}>
                                ⚠️ 請選擇 SKU {itemName ? `- ${itemName}` : ''}
                            </span>
                        );
                        
                        return {
                            key: key,
                            label: header,
                            extra: !isContentDisabled && <Button onClick={(e) => { e.stopPropagation(); remove(name); }} danger size="small">移除</Button>,
                            children: (
                                <>
                                    <Row gutter={16} className={lineCls("sl-liff-grid sl-liff-grid--wide")}>
                                        <Col span={6}>
                                            <Form.Item {...restField} name={[name, 'supplier_name']} label="供應商" rules={[{ required: true, message: '請選擇供應商' }]}>
                                                {isViewMode ? <ReadOnlyText /> : (
                                                    <Select
                                                        placeholder={canCreateSuppliers ? '選擇或輸入新供應商' : '選擇供應商'}
                                                        disabled={isContentDisabled}
                                                        showSearch
                                                        filterOption={(input, option) => {
                                                            const value = String(option?.value ?? '');
                                                            return value.startsWith(NEW_SUPPLIER_PREFIX) || value.toLowerCase().includes(input.toLowerCase());
                                                        }}
                                                        onSearch={setSupplierSearch}
                                                        onBlur={() => setSupplierSearch('')}
                                                        onChange={(value) => handleSupplierChange(name, value)}
                                                        options={supplierOptions(supplierSearch)}
                                                    />
                                                )}
                                            </Form.Item>
                                            {!isViewMode && (
                                                <Form.Item shouldUpdate noStyle>
                                                    {() => <SupplierRiskAlert supplier={findSupplier(form.getFieldValue(['items', name, 'supplier_name']))} />}
                                                </Form.Item>
                                            )}
                                        </Col>
                                        <Col span={5}>
                                            <Form.Item {...restField} name={[name, 'category']} label="類別">
                                                {isViewMode ? <ReadOnlyText /> : (
                                                    <Select disabled={isContentDisabled} placeholder="選擇類別">
                                                        {categories?.map((c: any) => (
                                                            <Option key={c.id} value={c.name}>{c.name}</Option>
                                                        ))}
                                                    </Select>
                                                )}
                                            </Form.Item>
                                        </Col>
                                        <Col span={8}>
                                            <Form.Item {...restField} name={[name, 'name']} label="商品名稱" rules={[{ required: true }]}>
                                                {isViewMode ? <ReadOnlyText /> : <Input disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={5}>
                                            <Form.Item {...restField} name={[name, 'source_url']} label="採購連結">
                                                {isViewMode ? <ReadOnlyText /> : <Input disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                    </Row>

                                    <Row gutter={16} className={lineCls("sl-liff-grid")}>
                                        <Col span={4}>
                                            <Form.Item {...restField} name={[name, 'exchange_rate']} label="匯率">
                                                {isViewMode ? <ReadOnlyText /> : <InputNumber style={{ width: '100%' }} step={0.1} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={4}>
                                            <Form.Item {...restField} name={[name, 'price_rmb']} label="單價(RMB)">
                                                {isViewMode ? <ReadOnlyText prefix="¥" /> : <InputNumber style={{ width: '100%' }} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={4}>
                                            <Form.Item {...restField} name={[name, 'shipping_rmb']} label="境內運(RMB)">
                                                {isViewMode ? <ReadOnlyText prefix="¥" /> : <InputNumber style={{ width: '100%' }} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={4}>
                                            <Form.Item {...restField} name={[name, 'weight_kg']} label="重量(Kg)">
                                                {isViewMode ? <ReadOnlyText suffix="kg" /> : <InputNumber style={{ width: '100%' }} step={0.1} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={4}>
                                            <Form.Item {...restField} name={[name, 'shipping_rate_twd']} label="集運(TWD/Kg)">
                                                {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                    </Row>

                                    <Row gutter={16} className={lineCls("sl-liff-grid")}>
                                        <Col span={6}>
                                            <Form.Item {...restField} name={[name, 'sales_price']} label="預計售價(TWD)">
                                                {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={6}>
                                            <Form.Item {...restField} name={[name, 'pricing_strategy']} label="策略">
                                                {isViewMode ? (
                                                    <ReadOnlyText options={[
                                                        { label: '引流款', value: 'traffic' },
                                                        { label: '毛利款', value: 'profit' },
                                                    ]} />
                                                ) : (
                                                    <Select disabled={isContentDisabled}>
                                                        <Option value="traffic">引流款</Option>
                                                        <Option value="profit">毛利款</Option>
                                                    </Select>
                                                )}
                                            </Form.Item>
                                        </Col>
                                        <Col span={6}>
                                            <Form.Item {...restField} name={[name, 'min_price']} label="最低價">
                                                {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="$" disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                        <Col span={6}>
                                            <Form.Item {...restField} name={[name, 'max_price']} label="最高價">
                                                {isViewMode ? <ReadOnlyText prefix="$" /> : <InputNumber style={{ width: '100%' }} min={0} prefix="$" disabled={isContentDisabled} />}
                                            </Form.Item>
                                        </Col>
                                    </Row>



                                    <Divider className={lineCls("sl-liff-subsection")} dashed style={{ margin: '12px 0' }} titlePlacement="left">款式列表</Divider>

                                    <Form.List name={[name, 'variants']}>
                                        {(variantFields, { add: addVariant, remove: removeVariant }) => (
                                            <div className={lineCls('sl-liff-variants-wrap')} style={{ background: '#f5f5f5', padding: '12px', borderRadius: '8px' }}>
                                                <div className={lineCls('sl-liff-variant-tools')} style={{ marginBottom: 8, display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}>
                                                    {!isContentDisabled && (
                                                        <Space align="baseline" wrap style={{ justifyContent: 'flex-end', maxWidth: '100%' }}>
                                                            <Form.Item name={[name, '_batch_attributes']} style={{ margin: 0, width: 'calc(var(--sl-fs, 14px) * 17)', maxWidth: '100%' }}>
                                                                <Select 
                                                                        mode="tags" 
                                                                        placeholder="輸入或選擇屬性 (如 材質:純棉)" 
                                                                        allowClear
                                                                        showSearch
                                                                        optionFilterProp="children"
                                                                    >
                                                                    {attributes?.map((attr: any) => (
                                                                        <Select.OptGroup key={attr.id} label={attr.name}>
                                                                            {attr.options?.map((opt: any) => (
                                                                                <Select.Option key={opt.id} value={opt.id}>{opt.value}</Select.Option>
                                                                            ))}
                                                                        </Select.OptGroup>
                                                                    ))}
                                                                </Select>
                                                            </Form.Item>
                                                            <Button 
                                                                type="primary" 
                                                                size="small" 
                                                                onClick={() => {
                                                                    const items = form.getFieldValue('items');
                                                                    const batchAttrs = items[name]?._batch_attributes;
                                                                    if (!batchAttrs || batchAttrs.length === 0) return;
                                                                    
                                                                    const newItems = [...items];
                                                                    const variants = newItems[name].variants.map((v: any) => {
                                                                        // Merge uniquely
                                                                        const existing = v.attribute_option_ids || [];
                                                                        const merged = Array.from(new Set([...existing, ...batchAttrs]));
                                                                        return { ...v, attribute_option_ids: merged };
                                                                    });
                                                                    newItems[name].variants = variants;
                                                                    form.setFieldsValue({ items: newItems });
                                                                    message.success('已批次套用屬性');
                                                                }}
                                                            >
                                                                套用至所有款式
                                                            </Button>
                                                        </Space>
                                                    )}
                                                    {!isContentDisabled && (
                                                        <Button
                                                            type="dashed"
                                                            size="small"
                                                            icon={<PlusOutlined />}
                                                            loading={addingVariantFor.has(name)}
                                                            disabled={addingVariantFor.has(name)}
                                                            onClick={async () => {
                                                                if (addingVariantFor.has(name)) return; // already in flight
                                                                setAddingVariantFor(prev => new Set(prev).add(name));
                                                                try {
                                                                    // Use the same SKU as the first variant if available, otherwise generate new
                                                                    const items = form.getFieldValue('items');
                                                                    const currentGroup = items[name];
                                                                    const existingSku = currentGroup.variants?.[0]?.sku;

                                                                    let newSku;
                                                                    if (existingSku) {
                                                                        newSku = existingSku;
                                                                    } else {
                                                                        try {
                                                                            const res = await generateSku();
                                                                            newSku = res.sku;
                                                                        } catch {
                                                                            message.error('SKU 產生失敗，請稍後再試一次「新增款式」(可能是網路暫時不穩)');
                                                                            return;
                                                                        }
                                                                    }

                                                                    addVariant({
                                                                        sku: newSku,
                                                                        batch_quantity: 1,
                                                                        is_confirmed: false
                                                                    });
                                                                } finally {
                                                                    setAddingVariantFor(prev => {
                                                                        const next = new Set(prev);
                                                                        next.delete(name);
                                                                        return next;
                                                                    });
                                                                }
                                                            }}
                                                        >
                                                            新增款式
                                                        </Button>
                                                    )}
                                                </div>
                                                <div className={lineCls('sl-liff-variants')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                                    {variantFields.map(({ key: vKey, name: vName, ...vRestField }) => (
                                                        <Card
                                                            key={vKey}
                                                            className={lineCls('sl-liff-variant')}
                                                            size="small"
                                                            type="inner"
                                                            styles={{ body: { padding: '8px' } }}
                                                            // LINE 版：卡片標題標出第幾個款式，刪除鈕放在標題右邊（電腦版維持在列尾）
                                                            title={fromLine ? `款式 ${vName + 1}` : undefined}
                                                            extra={fromLine && !isContentDisabled && variantFields.length > 1 ? (
                                                                <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeVariant(vName)} aria-label={`刪除款式 ${vName + 1}`} />
                                                            ) : undefined}
                                                        >
                                                            <Row gutter={8} align="middle" className={lineCls('sl-liff-grid sl-liff-grid--tight')}>
                                                                <Col span={5}>
                                                                    <Form.Item {...vRestField} name={[vName, 'style']} label="款式" style={{ margin: 0 }}>
                                                                        {isViewMode ? <ReadOnlyText /> : <Input placeholder="顏色/款式" disabled={isContentDisabled} />}
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col span={4}>
                                                                    <Form.Item {...vRestField} name={[vName, 'size']} label="尺寸" style={{ margin: 0 }}>
                                                                        {isViewMode ? <ReadOnlyText /> : <Input placeholder="尺寸" disabled={isContentDisabled} />}
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col span={3}>
                                                                    <Form.Item {...vRestField} name={[vName, 'batch_quantity']} label="數量" style={{ margin: 0 }} rules={[{ required: true }]}>
                                                                        {isViewMode ? <ReadOnlyText /> : <InputNumber min={1} style={{ width: '100%' }} disabled={isContentDisabled} />}
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col span={5}>
                                                                    <Form.Item {...vRestField} name={[vName, 'sku']} label="SKU" style={{ margin: 0 }}>
                                                                        {isViewMode ? <ReadOnlyText /> : (
                                                                            <Input
                                                                                style={{ fontSize: 11, cursor: 'not-allowed', backgroundColor: '#f5f5f5' }}
                                                                                placeholder="SKU"
                                                                                readOnly
                                                                                prefix={<LockOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
                                                                                title="SKU 為系統自動產生，無法修改"
                                                                            />
                                                                        )}
                                                                    </Form.Item>
                                                                    {/* Escape hatch for variants that ended up with a blank, unfixable
                                                                        SKU because a past generateSku() call failed silently — lets
                                                                        the user retry in place instead of deleting/re-adding the row. */}
                                                                    <Form.Item shouldUpdate noStyle>
                                                                        {() => {
                                                                            const currentSku = form.getFieldValue(['items', name, 'variants', vName, 'sku']);
                                                                            if (currentSku || isContentDisabled) return null;
                                                                            return (
                                                                                <Button
                                                                                    type="link"
                                                                                    size="small"
                                                                                    danger
                                                                                    style={{ padding: 0, height: 'auto', fontSize: 11 }}
                                                                                    onClick={async () => {
                                                                                        try {
                                                                                            const res = await generateSku();
                                                                                            const items = form.getFieldValue('items');
                                                                                            items[name].variants[vName].sku = res.sku;
                                                                                            form.setFieldsValue({ items });
                                                                                        } catch {
                                                                                            message.error('SKU 產生失敗，請再試一次');
                                                                                        }
                                                                                    }}
                                                                                >
                                                                                    缺少 SKU，點此重新產生
                                                                                </Button>
                                                                            );
                                                                        }}
                                                                    </Form.Item>
                                                                </Col>
                                                                <Col span={2} className={lineCls('sl-liff-inline')}>
                                                                    {isViewMode ? (
                                                                        <Form.Item {...vRestField} name={[vName, 'is_confirmed']} label="確認" style={{ margin: 0 }}>
                                                                            <ReadOnlyText options={[{ label: '是', value: true }, { label: '否', value: false }]} />
                                                                        </Form.Item>
                                                                    ) : (
                                                                        <Form.Item {...vRestField} name={[vName, 'is_confirmed']} label="確認" valuePropName="checked" style={{ margin: 0 }}>
                                                                            <Switch size="small" disabled={isContentDisabled} />
                                                                        </Form.Item>
                                                                    )}
                                                                </Col>
                                                                <Col span={3} className={lineCls('sl-liff-inline')}>
                                                                    <Form.Item label="圖片" style={{ margin: 0 }}>
                                                                        {isViewMode ? (
                                                                            <Form.Item shouldUpdate noStyle>
                                                                                {() => {
                                                                                    const img = form.getFieldValue(['items', name, 'variants', vName, 'image_url']);
                                                                                    return img ? <img src={img} style={{ width: 30, height: 30, objectFit: 'cover' }} /> : <ReadOnlyText />;
                                                                                }}
                                                                            </Form.Item>
                                                                        ) : (
                                                                            <>
                                                                                <Form.Item {...vRestField} name={[vName, 'image_url']} noStyle>
                                                                                    <Input style={{ display: 'none' }} />
                                                                                </Form.Item>
                                                                                <Form.Item shouldUpdate noStyle>
                                                                                    {() => {
                                                                                        const img = form.getFieldValue(['items', name, 'variants', vName, 'image_url']);
                                                                                        return (
                                                                                            <VariantImageUpload
                                                                                                value={img}
                                                                                                disabled={isContentDisabled}
                                                                                                onUploaded={(url) => {
                                                                                                    const items = form.getFieldValue('items');
                                                                                                    items[name].variants[vName].image_url = url;
                                                                                                    form.setFieldsValue({ items });
                                                                                                }}
                                                                                            />
                                                                                        );
                                                                                    }}
                                                                                </Form.Item>
                                                                            </>
                                                                        )}
                                                                    </Form.Item>
                                                                </Col>
                                                                {!fromLine && <Col span={2} style={{ textAlign: 'center' }}>
                                                                    {!isContentDisabled && variantFields.length > 1 && (
                                                                        <Button type="text" danger icon={<DeleteOutlined />} onClick={() => removeVariant(vName)} />
                                                                    )}
                                                                </Col>}
                                                            </Row>
                                                            <Row gutter={8} style={{ marginTop: 8 }} className={lineCls('sl-liff-grid')}>
                                                                <Col span={24}>
                                                                    <Form.Item {...vRestField} name={[vName, 'attribute_option_ids']} label="動態屬性" style={{ margin: 0 }}>
                                                                        {isViewMode ? <ReadOnlyText options={attributeOptionLabels} /> : (
                                                                        <Select
                                                                            mode="tags"
                                                                            placeholder="輸入或選擇屬性 (如 材質:純棉)"
                                                                            disabled={isContentDisabled}
                                                                            style={{ width: '100%' }}
                                                                            showSearch
                                                                            optionFilterProp="children"
                                                                        >
                                                                            {attributes?.map((attr: any) => (
                                                                                <Select.OptGroup key={attr.id} label={attr.name}>
                                                                                    {attr.options?.map((opt: any) => (
                                                                                        <Select.Option key={opt.id} value={opt.id}>{opt.value}</Select.Option>
                                                                                    ))}
                                                                                </Select.OptGroup>
                                                                            ))}
                                                                        </Select>
                                                                        )}
                                                                    </Form.Item>
                                                                </Col>
                                                            </Row>
                                                        </Card>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </Form.List>

                                    <Row gutter={16} style={{ marginTop: 16 }}>
                                        <Col span={24}>
                                            <Card size="small" className={lineCls('sl-liff-note-card')} style={{ background: '#e6f7ff', borderColor: '#91d5ff' }}>
                                                <Form.Item shouldUpdate noStyle>
                                                    {({ getFieldValue }) => {
                                                        const item = getFieldValue(['items', name]) || {};
                                                        const variants = item.variants || [];
                                                        const rate = item.exchange_rate || 5.0;
                                                        const sRateTwd = item.shipping_rate_twd || 0;
                                                        
                                                        // Prepare inputs for calculation module
                                                        const inputs: POItemInput[] = [];
                                                        variants.forEach((v: any) => {
                                                            inputs.push({
                                                                sku: v.sku || 'temp',
                                                                unitPriceRMB: v.price_rmb ?? item.price_rmb ?? 0,
                                                                quantity: v.batch_quantity || 1,
                                                                weightKg: v.weight_kg ?? item.weight_kg ?? 0,
                                                                domesticFreightRMB: v.shipping_rmb ?? item.shipping_rmb ?? 0,
                                                                shippingUnitPriceTWD: sRateTwd,
                                                                exchangeRate: rate
                                                            });
                                                        });

                                                        const calc = calculatePurchaseOrder(inputs);
                                                        
                                                        // 蝦皮抽成／毛利額／毛利率都以「每件」計算，同進貨單 Excel：
                                                        // 抽成 = 預計售價 × 16%，毛利額 = 預計售價 − 單品成本 − 抽成，毛利率 = 毛利額 ÷ 預計售價
                                                        const totalQty = calc.items.length > 0 ? calc.items.reduce((sum, i) => sum + i.totalQuantity, 0) : 0;
                                                        const unitCost = totalQty > 0 ? calc.grandTotalCostNTD / totalQty : 0;
                                                        const avgUnitCost = unitCost.toFixed(2);
                                                        const salesPrice = item.sales_price ?? variants[0]?.sales_price ?? 0;

                                                        const shopeeFee = Math.round(salesPrice * 0.16 * 100) / 100;
                                                        const profit = Math.round((salesPrice - unitCost - shopeeFee) * 100) / 100;
                                                        const margin = salesPrice > 0 ? ((profit / salesPrice) * 100).toFixed(1) : '0';

                                                        return (
                                                            <Row gutter={16} style={{ textAlign: 'center' }} className={lineCls('sl-liff-stats')}>
                                                                <Col span={3}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>訂貨金額(CNY)</div>
                                                                    <div style={{ fontWeight: 'bold' }}>¥{calc.grandTotalOrderAmountRMB.toFixed(2)}</div>
                                                                </Col>
                                                                <Col span={3}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>集運費(NTD)</div>
                                                                    <div style={{ fontWeight: 'bold' }}>${calc.grandTotalShippingFeeTWD}</div>
                                                                </Col>
                                                                <Col span={4}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>進貨成本(NTD)</div>
                                                                    <div style={{ fontWeight: 'bold', color: '#B25B4C' }}>${calc.grandTotalCostNTD}</div>
                                                                </Col>
                                                                <Col span={4}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>平均單品成本(NTD)</div>
                                                                    <div style={{ fontWeight: 'bold', color: '#B25B4C' }}>${avgUnitCost}</div>
                                                                </Col>
                                                                <Col span={3}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>蝦皮抽成(16%)</div>
                                                                    <div style={{ fontWeight: 'bold' }}>${shopeeFee}</div>
                                                                </Col>
                                                                <Col span={4}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>毛利率</div>
                                                                    <div style={{ fontWeight: 'bold', color: parseFloat(margin) > 0 ? 'green' : 'red' }}>{margin}%</div>
                                                                </Col>
                                                                <Col span={3}>
                                                                    <div style={{ fontSize: 12, color: '#666' }}>毛利額</div>
                                                                    <div style={{ fontWeight: 'bold', color: profit > 0 ? 'green' : 'red' }}>${profit}</div>
                                                                </Col>
                                                            </Row>
                                                        );
                                                    }}
                                                </Form.Item>
                                            </Card>
                                        </Col>
                                    </Row>
                                </>
                            )
                        }
                    })} 
                />
                {!isContentDisabled && (
                    <Button type="dashed" onClick={() => handleAddProduct(add)} loading={isAddingProduct} disabled={isAddingProduct} block icon={<PlusOutlined />}>
                      新增商品項目
                    </Button>
                )}
              </div>
            )}
          </Form.List>

          {!fromLine && <Divider />}
          <Form.Item shouldUpdate>
            {({ getFieldValue }) => {
                const items = getFieldValue('items') || [];
                // Retrieve global options from form if available (assuming fields exist)
                // Note: 'tariff' is used as additional cost.
                // We might need to add 'discount' and 'globalShipping' fields if they don't exist, 
                // or just use what we have. Currently only 'tariff' exists in the form.
                const tariff = getFieldValue('tariff') || 0;

                // Extract inputs
                const inputs: POItemInput[] = [];
                items.forEach((group: any) => {
                    if (!group) return;
                    const variants = group.variants || [];
                    const rate = group.exchange_rate || 5.0;
                    const sRateTwd = group.shipping_rate_twd || 0;
                    
                    variants.forEach((v: any) => {
                        inputs.push({
                            sku: v.sku,
                            unitPriceRMB: v.price_rmb ?? group.price_rmb ?? 0,
                            quantity: v.batch_quantity || 0,
                            weightKg: v.weight_kg ?? group.weight_kg ?? 0,
                            domesticFreightRMB: v.shipping_rmb ?? group.shipping_rmb ?? 0,
                            shippingUnitPriceTWD: sRateTwd,
                            exchangeRate: rate
                        });
                    });
                });

                const calc = calculatePurchaseOrder(inputs, {
                    additionalCostNTD: tariff
                });

                return (
                    <Card title="訂單總計試算" size="small" className={lineCls('sl-liff-total')} style={{ background: '#FCF8F1', borderColor: '#E3D9CB' }}>
                        <Row gutter={16} style={{ textAlign: 'center' }} className={lineCls('sl-liff-stats')}>
                            <Col span={6}>
                                <div style={{ fontSize: 14, color: '#666' }}>總進貨成本(NTD)</div>
                                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#8B6545' }}>${calc.grandTotalCostNTD}</div>
                                {tariff > 0 && <div style={{ fontSize: 12, color: '#999' }}>(含關稅: ${tariff})</div>}
                            </Col>
                            <Col span={6}>
                                <div style={{ fontSize: 14, color: '#666' }}>總重量</div>
                                <div style={{ fontSize: 18, fontWeight: 'bold' }}>{calc.grandTotalWeightKg.toFixed(2)} kg</div>
                            </Col>
                            <Col span={6}>
                                <div style={{ fontSize: 14, color: '#666' }}>總集運費(TWD)</div>
                                <div style={{ fontSize: 18, fontWeight: 'bold' }}>${calc.grandTotalShippingFeeTWD}</div>
                            </Col>
                            <Col span={6}>
                                <div style={{ fontSize: 14, color: '#666' }}>總訂貨金額(RMB)</div>
                                <div style={{ fontSize: 18, fontWeight: 'bold' }}>¥{calc.grandTotalOrderAmountRMB.toFixed(2)}</div>
                            </Col>
                        </Row>
                    </Card>
                );
            }}
          </Form.Item>
        </Form>
      </Modal>

      {requestTarget && (
        <ChangeRequestModal
          open={!!requestTarget}
          onClose={() => setRequestTarget(null)}
          resourceType="purchase_order"
          resourceId={requestTarget.id}
          resourceLabel={`採購單 PO-${requestTarget.id}（${requestTarget.supplier_name}）`}
          action="edit"
        />
      )}
    </div>
  );
};

export default PurchaseOrderList;
