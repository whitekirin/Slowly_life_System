import axios from 'axios';
import { isLiffMode } from './liffSession';

// Production build is served by the same FastAPI container as the API (merged
// single-container Docker deployment), so a relative baseURL resolves correctly.
// Local dev runs the frontend on :5173 and the backend separately on :8000, so it
// needs an absolute URL instead.
const api = axios.create({
  baseURL: import.meta.env.DEV ? 'http://localhost:8000' : '',
});

// Same reasoning as baseURL above — used by <Upload action="..."> props, which
// take a plain URL string rather than going through the `api` axios instance.
export const UPLOAD_URL = import.meta.env.DEV ? 'http://localhost:8000/upload/' : '/upload/';

// Auth
export const login = async (formData: FormData) => {
  const response = await api.post('/token', formData);
  return response.data;
};

export const forgotPassword = async (email: string) => {
  const response = await api.post('/auth/forgot-password', { email });
  return response.data;
};

export const resetPassword = async (token: string, new_password: string) => {
  const response = await api.post('/auth/reset-password', { token, new_password });
  return response.data;
};

export const register = async (userData: any) => {
  const response = await api.post('/register', userData);
  return response.data;
};

// LINE binding
export const startLineBind = async () => {
  const response = await api.post('/line/bind/start');
  return response.data as { authorize_url: string };
};

export const getLineBindStatus = async () => {
  const response = await api.get('/line/bind/status');
  return response.data as { bound: boolean; line_display_name?: string; line_bound_at?: string };
};

export const unbindLine = async () => {
  const response = await api.delete('/line/bind');
  return response.data;
};

export const syncLineRichMenus = async () => {
  const response = await api.post('/line/richmenu/sync');
  return response.data as { default_rich_menu_id: string | null; users: number };
};

// LINE 介面設定（backend/line_menu_config.py）：外觀與排列；誰看得到哪個功能照系統權限
export interface LineMenuGroupConfig { code: string; label: string; subtitle: string; color: string; enabled: boolean }
export interface LineMenuActionConfig { code: string; label: string; group: string; enabled: boolean }
export interface LineMenuConfig {
  groups: LineMenuGroupConfig[];
  actions: LineMenuActionConfig[];
  all_tile: { label: string; subtitle: string };
}
export interface LinePaletteColor { label: string; accent: string; tint: string; ink: string }
export interface LineMenuConfigResponse {
  config: LineMenuConfig;
  defaults: LineMenuConfig;
  palette: Record<string, LinePaletteColor>;
  limits: { group_label: number; subtitle: number; action_label: number };
  actions: { code: string; default_label: string; default_group: string; liff_path: string; required_permissions: string[]; allow_picker: boolean }[];
  preview_users: { id: number; username: string; full_name?: string | null; line_bound: boolean }[];
}
export interface LineMenuPreview {
  image: string | null;
  tiles: string[];
  groups: { code: string; label: string; subtitle: string; colors: LinePaletteColor; actions: { code: string; label: string }[] }[];
}

export const getLineMenuConfig = async () => {
  const response = await api.get('/line/menu-config');
  return response.data as LineMenuConfigResponse;
};

export const saveLineMenuConfig = async (config: LineMenuConfig) => {
  const response = await api.put('/line/menu-config', config);
  return response.data as { config: LineMenuConfig };
};

export const resetLineMenuConfig = async () => {
  const response = await api.post('/line/menu-config/reset');
  return response.data as { config: LineMenuConfig };
};

export const previewLineMenu = async ({ config, userId }: { config: LineMenuConfig; userId: number | null }) => {
  const response = await api.post('/line/menu-config/preview', { config, user_id: userId });
  return response.data as LineMenuPreview;
};

// Add interceptor
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Add response interceptor to handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Clear local storage and redirect to login
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (isLiffMode()) {
        // 從 LINE 開的：用 LINE 身分重新登入後回到原頁
        const back = window.location.pathname + window.location.search;
        window.location.href = `/liff/go?to=${encodeURIComponent(back)}`;
      } else if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// Products
export const getProducts = async () => {
  const response = await api.get('/products/');
  return response.data;
};

export interface ProductReceivingNote {
  product_id: number;
  source: string; // PO-12 / SR-3
  po_id: number;
  supplier_name?: string | null;
  date?: string | null;
  note: string;
}

// 商品在已入庫採購單／補驗收單上的驗收備註（新的在前）
export const getProductReceivingNotes = async (productIds: number[]): Promise<ProductReceivingNote[]> => {
  const response = await api.get('/products/receiving_notes', {
    params: { product_ids: productIds },
    paramsSerializer: { indexes: null }, // product_ids=1&product_ids=2，FastAPI 的 List 參數格式
  });
  return response.data;
};

export const createProduct = async (product: any) => {
  const response = await api.post('/products/', product);
  return response.data;
};

export const ensureProduct = async (product: any) => {
  const response = await api.post('/products/ensure', product);
  return response.data;
};

// Attributes
export const getAttributes = async () => {
  const response = await api.get('/attributes/');
  return response.data;
};

export const createAttribute = async (data: any) => {
  const response = await api.post('/attributes/', data);
  return response.data;
};

export const deleteAttribute = async (id: number) => {
  const response = await api.delete(`/attributes/${id}`);
  return response.data;
};

export const createAttributeOption = async ({ attrId, data }: { attrId: number, data: any }) => {
  const response = await api.post(`/attributes/${attrId}/options/`, data);
  return response.data;
};

export const deleteAttributeOption = async (optId: number) => {
  const response = await api.delete(`/attribute_options/${optId}`);
  return response.data;
};

export const ensureAttributeOption = async (name: string, value: string) => {
  const response = await api.post('/attributes/ensure', { name, value });
  return response.data;
};

// Category APIs
export const getCategories = async () => {
  const response = await api.get('/categories/');
  return response.data;
};

export const createCategory = async (category: any) => {
  const response = await api.post('/categories/', category);
  return response.data;
};

export const deleteCategory = async (id: number) => {
  const response = await api.delete(`/categories/${id}`);
  return response.data;
};

// Supplier APIs
export const getSuppliers = async (params?: { name?: string, category?: string, grade?: string }) => {
  const response = await api.get('/suppliers/', { params });
  return response.data;
};

export const createSupplier = async (supplier: any) => {
  const response = await api.post('/suppliers/', supplier);
  return response.data;
};

// Admin DM Management
export const getAdminDMs = async (params?: any) => {
  const response = await api.get('/dms/admin', { params });
  return response.data;
};

export const createAdminDM = async (dmData: any) => {
  const response = await api.post('/dms/admin', dmData);
  return response.data;
};

export const updateAdminDM = async (id: number, dmData: any) => {
  const response = await api.patch(`/dms/admin/${id}`, dmData);
  return response.data;
};

export const deleteAdminDM = async (id: number) => {
  const response = await api.delete(`/dms/admin/${id}`);
  return response.data;
};

// Member Admin APIs
export const getMembers = async (params: any) => {
  const response = await api.get('/members/', { params });
  return response.data;
};

export const getMember = async (id: number) => {
  const response = await api.get(`/members/${id}`);
  return response.data;
};

export const updateMember = async (id: number, data: any) => {
  const response = await api.patch(`/members/${id}`, data);
  return response.data;
};

export const syncMember = async (id: number) => {
  const response = await api.post(`/members/${id}/sync`);
  return response.data;
};

export const getAdminNewProductsOverview = async (params?: any) => {
  const response = await api.get('/members/admin/new-products/overview', { params });
  return response.data;
};

export const getAdminNewProductsList = async (params?: any) => {
  const response = await api.get('/members/admin/new-products/list', { params });
  return response.data;
};

export const getAdminNewProductBatches = async () => {
  const response = await api.get('/members/admin/new-products/batches');
  return response.data;
};

export const exportAdminNewProducts = async (params?: any) => {
  const response = await api.get('/members/admin/new-products/export', { params });
  return response.data;
};

// System Logs
export const getSystemLogs = async (params: {
    page: number;
    limit: number;
    start_date?: string;
    end_date?: string;
    keyword?: string;
}) => {
    const response = await api.get('/system-logs/', { params });
    return response.data;
};

export const exportSystemLogs = async (params: {
    start_date?: string;
    end_date?: string;
    keyword?: string;
}) => {
    const response = await api.get('/system-logs/export', { 
        params,
        responseType: 'blob' 
    });
    return response.data;
};

export const updateSupplier = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/suppliers/${id}`, data);
  return response.data;
};

export const getSupplierRatingLogs = async (id: number) => {
  const response = await api.get(`/suppliers/${id}/rating_logs`);
  return response.data;
};

export const deleteSupplier = async (id: number) => {
  const response = await api.delete(`/suppliers/${id}`);
  return response.data;
};

export const updateProduct = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/products/${id}`, data);
  return response.data;
};

export const deleteProduct = async (id: number) => {
  try {
      const response = await api.delete(`/products/${id}`);
      return response.data;
  } catch (error) {
      throw error;
  }
};

export const generateSku = async () => {
  const response = await api.get('/products/generate_sku/');
  return response.data;
};

// Dashboard
export const getDashboardStats = async () => {
  const response = await api.get('/dashboard/stats');
  return response.data;
};

// Purchase Orders
export const getPurchaseOrders = async () => {
  const response = await api.get('/purchase_orders/');
  return response.data;
};

export const createPurchaseOrder = async (po: any) => {
  const response = await api.post('/purchase_orders/', po);
  return response.data;
};

export const updatePurchaseOrder = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/purchase_orders/${id}`, data);
  return response.data;
};

// 只有草稿可以刪除；已完成之後只能報廢
export const deletePurchaseOrder = async (id: number) => {
  const response = await api.delete(`/purchase_orders/${id}`);
  return response.data;
};

// 補驗收單：只能從驗收紀錄的短收採購單建立，沒有自由新增的 API
export const getSupplementaryReceivings = async () => {
  const response = await api.get('/supplementary_receivings/');
  return response.data;
};

export const getOutstandingShortages = async () => {
  const response = await api.get('/supplementary_receivings/outstanding');
  return response.data;
};

export const createSupplementaryReceiving = async (poId: number) => {
  const response = await api.post('/supplementary_receivings/', { po_id: poId });
  return response.data;
};

export const receiveSupplementaryReceiving = async ({ id, items }: { id: number, items: any[] }) => {
  const response = await api.post(`/supplementary_receivings/${id}/receive`, { items });
  return response.data;
};

export const updatePurchaseOrderStatus = async ({ id, status }: { id: number, status: string }) => {
  const response = await api.patch(`/purchase_orders/${id}`, { status });
  return response.data;
};

// 採購單（草稿除外）、出貨單、退貨單不能刪除，只能報廢（backend/voiding.py）。有核准權限的主管直接報廢；其他人送報廢簽呈。
export type VoidStatus = 'pending' | 'voided' | null;
export const VOID_STATUS_LABELS: Record<string, string> = { pending: '報廢審核中', voided: '已報廢' };

export const voidPurchaseOrder = async ({ id, reason }: { id: number; reason: string }) => {
  const response = await api.post(`/purchase_orders/${id}/void`, { reason });
  return response.data;
};

// 簽呈（backend/change_requests.py）：edit＝已鎖定的單申請臨時修改權限；void＝申請報廢（核准即報廢）
export type ChangeRequestAction = 'edit' | 'delete' | 'void';
export interface ChangeRequest {
  id: number;
  resource_type: string;
  resource_id: number;
  action: ChangeRequestAction;
  reason: string;
  attachment_url?: string | null;
  requester_id: number;
  requester_name: string;
  status: string;
  created_at: string;
  approver_name?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
  expires_at?: string | null;
  max_uses: number;
  used_count: number;
  effective_status: 'pending' | 'active' | 'used_up' | 'expired' | 'rejected' | 'cancelled' | 'voided';
  resource_label: string;
  resource_link?: string | null;
}

export const createChangeRequest = async (data: { resource_type: string; resource_id: number; action: ChangeRequestAction; reason: string; attachment_url?: string }) => {
  const response = await api.post('/change_requests/', data);
  return response.data as ChangeRequest;
};

export const getMyChangeRequests = async (resourceType?: string) => {
  const response = await api.get('/change_requests/mine', { params: resourceType ? { resource_type: resourceType } : {} });
  return response.data as ChangeRequest[];
};

export const getChangeRequestsForApproval = async (onlyPending = true) => {
  const response = await api.get('/change_requests/for-approval', { params: { only_pending: onlyPending } });
  return response.data as ChangeRequest[];
};

export const approveChangeRequest = async ({ id, data }: { id: number; data: { valid_hours?: number; max_uses?: number; note?: string } }) => {
  const response = await api.post(`/change_requests/${id}/approve`, data);
  return response.data as ChangeRequest;
};

export const rejectChangeRequest = async ({ id, note }: { id: number; note?: string }) => {
  const response = await api.post(`/change_requests/${id}/reject`, { note });
  return response.data as ChangeRequest;
};

export const cancelChangeRequest = async (id: number) => {
  const response = await api.post(`/change_requests/${id}/cancel`);
  return response.data as ChangeRequest;
};

// Sales Orders
export const getPickers = async () => {
  const response = await api.get('/pickers/');
  return response.data;
};

// 撿貨人員可能是靠部門預設權限繼承的，前端 hasPermission 看不到，要問後端
export const getPickerMe = async (): Promise<{ is_picker: boolean }> => {
  const response = await api.get('/pickers/me');
  return response.data;
};

export const getPickingOrders = async () => {
  const response = await api.get('/pickers/orders');
  return response.data;
};

// 撿貨分頁專用：逐項商品撿貨狀態（撿貨中／已撿貨），整單的撿貨中／撿貨完成由後端依此自動決定
export const updateItemPickingStatus = async ({ orderId, itemId, status }: { orderId: number, itemId: number, status: string }) => {
  const response = await api.patch(`/sales_orders/${orderId}/items/${itemId}/picking_status`, { status });
  return response.data;
};

// 撿貨分頁專用：全部商品撿完後把整張單改成已出貨，不能動商品與金額
export const updatePickingStatus = async ({ id, status }: { id: number, status: string }) => {
  const response = await api.patch(`/sales_orders/${id}/picking_status`, { status });
  return response.data;
};

export const getSalesOrders = async () => {
  const response = await api.get('/sales_orders/');
  return response.data;
};

export const createSalesOrder = async (so: any) => {
  const response = await api.post('/sales_orders/', so);
  return response.data;
};

export const updateSalesOrder = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/sales_orders/${id}`, data);
  return response.data;
};

export const voidSalesOrder = async ({ id, reason }: { id: number; reason: string }) => {
  const response = await api.post(`/sales_orders/${id}/void`, { reason });
  return response.data;
};

// Return Orders
export const getReturnOrders = async () => {
  const response = await api.get('/return_orders/');
  return response.data;
};

export const createReturnOrder = async (ro: any) => {
  const response = await api.post('/return_orders/', ro);
  return response.data;
};

export const updateReturnOrder = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/return_orders/${id}`, data);
  return response.data;
};

// 退貨單不能刪除，只能報廢（同採購單、出貨單）
export const voidReturnOrder = async ({ id, reason }: { id: number; reason: string }) => {
  const response = await api.post(`/return_orders/${id}/void`, { reason });
  return response.data;
};

// User APIs
export const getUser = async () => {
  const response = await api.get('/users/me');
  return response.data;
};

export const updateUser = async (data: any) => {
  const response = await api.patch('/users/me', data);
  return response.data;
};

export const createUser = async (user: any) => {
  const response = await api.post('/users/', user);
  return response.data;
};

export const getUsers = async (q?: string) => {
  const response = await api.get('/users/', { params: { q } });
  return response.data;
};

export const updateUserById = async ({ id, data }: { id: number; data: any }) => {
  const response = await api.patch(`/users/${id}`, data);
  return response.data;
};

export const deleteUser = async (id: number) => {
  const response = await api.delete(`/users/${id}`);
  return response.data;
};

// Department APIs
export const getDepartments = async () => {
  const response = await api.get('/departments/');
  return response.data;
};

export const createDepartment = async (dept: any) => {
  const response = await api.post('/departments/', dept);
  return response.data;
};

export const updateDepartment = async ({ id, data }: { id: number; data: any }) => {
  const response = await api.patch(`/departments/${id}`, data);
  return response.data;
};

export const deleteDepartment = async (id: number) => {
  const response = await api.delete(`/departments/${id}`);
  return response.data;
};

// System Settings
export const getSystemSettings = async () => {
  const response = await api.get('/system-settings/');
  return response.data;
};

export const updateSystemSetting = async (setting: { key: string; value: string; description?: string }) => {
  const response = await api.post('/system-settings/', setting);
  return response.data;
};

// Stock Take
export const getStockTakes = async (params?: { status?: string, start_date?: string, end_date?: string }) => {
  const response = await api.get('/stock_takes/', { params });
  return response.data;
};

export const createStockTake = async (data: any) => {
  const response = await api.post('/stock_takes/', data);
  return response.data;
};

export const getStockTake = async (id: number) => {
  const response = await api.get(`/stock_takes/${id}`);
  return response.data;
};

export const updateStockTake = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/stock_takes/${id}`, data);
  return response.data;
};

export const completeStockTake = async (id: number) => {
  const response = await api.post(`/stock_takes/${id}/complete`);
  return response.data;
};

export const deleteStockTake = async (id: number) => {
  const response = await api.delete(`/stock_takes/${id}`);
  return response.data;
};

// 員工站內通知（每個帳號各自的通知與已讀狀態）
export const getUserNotifications = async () => {
  const response = await api.get('/user_notifications/');
  return response.data;
};

export const getUnreadNotificationCount = async () => {
  const response = await api.get('/user_notifications/unread-count');
  return response.data as { count: number };
};

export const markNotificationRead = async (id: number) => {
  const response = await api.post(`/user_notifications/${id}/read`);
  return response.data;
};

export const markAllNotificationsRead = async () => {
  const response = await api.post('/user_notifications/read-all');
  return response.data;
};

// Transaction (Accounting)
export const getTransactions = async (params?: { start_date?: string, end_date?: string, month?: string, type?: string, category?: string }) => {
  const response = await api.get('/transactions/', { params });
  return response.data;
};

// 每個有記帳的月份一列（新到舊）：收入/支出/淨利，以及出貨收入、進貨成本、退款等拆項
export const getMonthlyTransactionSummary = async () => {
  const response = await api.get('/transactions/monthly');
  return response.data;
};

export const createTransaction = async (data: any) => {
  const response = await api.post('/transactions/', data);
  return response.data;
};

export const updateTransaction = async ({ id, data }: { id: number, data: any }) => {
  const response = await api.patch(`/transactions/${id}`, data);
  return response.data;
};

export const deleteTransaction = async (id: number) => {
  const response = await api.delete(`/transactions/${id}`);
  return response.data;
};

// --- Marketing Hub APIs ---
export const getMessageTemplates = async () => {
  const response = await api.get('/marketing/templates');
  return response.data;
};
export const createMessageTemplate = async (data: any) => {
  const response = await api.post('/marketing/templates', data);
  return response.data;
};
export const updateMessageTemplate = async (id: number, data: any) => {
  const response = await api.patch(`/marketing/templates/${id}`, data);
  return response.data;
};
export const deleteMessageTemplate = async (id: number) => {
  const response = await api.delete(`/marketing/templates/${id}`);
  return response.data;
};

export const getTargetSegments = async () => {
  const response = await api.get('/marketing/segments');
  return response.data;
};
export const createTargetSegment = async (data: any) => {
  const response = await api.post('/marketing/segments', data);
  return response.data;
};
export const updateTargetSegment = async (id: number, data: any) => {
  const response = await api.patch(`/marketing/segments/${id}`, data);
  return response.data;
};
export const deleteTargetSegment = async (id: number) => {
  const response = await api.delete(`/marketing/segments/${id}`);
  return response.data;
};

export const getCampaigns = async () => {
  const response = await api.get('/marketing/campaigns');
  return response.data;
};
export const createCampaign = async (data: any) => {
  const response = await api.post('/marketing/campaigns', data);
  return response.data;
};
export const updateCampaignStatus = async (id: number, status: string) => {
  const response = await api.patch(`/marketing/campaigns/${id}/status?status=${status}`);
  return response.data;
};
export const getCampaignStats = async (id: number) => {
  const response = await api.get(`/marketing/campaigns/${id}/stats`);
  return response.data;
};

export const getAutomatedTriggers = async () => {
  const response = await api.get('/marketing/triggers');
  return response.data;
};
export const createAutomatedTrigger = async (data: any) => {
  const response = await api.post('/marketing/triggers', data);
  return response.data;
};
export const deleteAutomatedTrigger = async (id: number) => {
  const response = await api.delete(`/marketing/triggers/${id}`);
  return response.data;
};

export const sendDirectMessage = async (data: any) => {
  const response = await api.post('/marketing/direct_send', data);
  return response.data;
};

// --- Product Listing API ---
export const createProductListing = async (data: { items: { product_id: number; quantity: number }[] }) => {
    const res = await api.post('/product-listings/', data);
    return res.data;
};

export const publishProductListing = async (batchId: string | number) => {
    const res = await api.post(`/product-listings/${batchId}/publish`);
    return res.data;
};

export const archiveProductListing = async (batchId: string | number) => {
    const res = await api.post(`/product-listings/${batchId}/archive`);
    return res.data;
};

export const getProductListingBatch = async (batchId: string | number) => {
    const res = await api.get(`/product-listings/${batchId}`);
    return res.data;
};

// 各商品目前在「已發布」批次中已佔用的數量，用於建立新批次時扣除可上架庫存
export const getProductListingReservedQuantities = async (): Promise<Record<number, number>> => {
    const res = await api.get('/product-listings/reserved-quantities');
    return res.data;
};

export default api;
