// 員工權限目錄：依側邊選單的大標分組，每個功能分成
//   查看 view_X、新增 create_X、修改／刪除 edit_X，部分功能另有核准 approve_X（核准簽呈，也可直接修改已鎖定的單、直接報廢）。
// 新增、修改／刪除各自涵蓋查看；核准涵蓋修改／刪除。舊版的編輯 manage_X 視為同時有新增與修改／刪除
// （manage_system 例外，它就是系統設定的權限）。後端 backend/auth.py 的 _grants 是同一條規則。

export interface PermissionModule {
  key: string;
  label: string;
  description: string;
  view?: string;
  create?: string;
  edit?: string;
  approve?: string;
}

export interface PermissionGroup {
  key: string;
  label: string;
  modules: PermissionModule[];
}

const crud = (key: string) => ({ view: `view_${key}`, create: `create_${key}`, edit: `edit_${key}` });

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'dashboard', label: '儀表板', modules: [
      { key: 'dashboard', label: '儀表板', description: '營運統計', view: 'view_dashboard' },
    ],
  },
  {
    key: 'products', label: '商品管理', modules: [
      { key: 'products', label: '商品列表', description: '商品、款式屬性、庫存異動', ...crud('products') },
      { key: 'product_listings', label: '上架批次管理', description: '新增批次；修改＝上架、下架', ...crud('product_listings') },
      { key: 'categories', label: '類別管理', description: '商品類別', ...crud('categories') },
      { key: 'stock_takes', label: '庫存盤點', description: '新增盤點單；修改＝填盤點數量、完成盤點', ...crud('stock_takes') },
    ],
  },
  {
    key: 'purchasing', label: '採購與進貨', modules: [
      { key: 'suppliers', label: '供應商管理', description: '供應商資料、評分', ...crud('suppliers') },
      { key: 'purchase_orders', label: '採購單', description: '採購單（含 LINE 開單）；不能刪除只能報廢；核准＝核准修改與報廢簽呈', ...crud('purchase_orders'), approve: 'approve_purchase_orders' },
      { key: 'receiving', label: '進貨驗收', description: '修改＝確認入庫（入庫時自動記採購支出）', view: 'view_receiving', edit: 'edit_receiving' },
      { key: 'supplementary_receivings', label: '補驗收單', description: '新增補驗收單；修改＝補驗收入庫', ...crud('supplementary_receivings') },
    ],
  },
  {
    key: 'sales', label: '銷售與出貨', modules: [
      { key: 'shipping', label: '出貨作業', description: '出貨單；出貨時自動記銷售收入；不能刪除只能報廢；核准＝核准報廢簽呈', ...crud('shipping'), approve: 'approve_shipping' },
      { key: 'returns', label: '退貨作業', description: '退貨單；完成時自動記退款支出；不能刪除只能報廢；核准＝核准報廢簽呈', ...crud('returns'), approve: 'approve_returns' },
    ],
  },
  {
    key: 'finance', label: '財務管理', modules: [
      { key: 'finance', label: '記帳管理', description: '手動記帳、修改／刪除任何記帳（含自動記帳）', ...crud('finance') },
    ],
  },
  {
    key: 'members', label: '會員管理', modules: [
      { key: 'members', label: '會員列表', description: '會員資料（會員自行註冊，沒有新增）', view: 'view_members', edit: 'edit_members' },
      { key: 'new_products', label: '新品總覽管理', description: '新品總覽、匯出', view: 'view_new_products' },
      { key: 'dms', label: '推播管理 (舊版)', description: 'DM 推播', ...crud('dms') },
      { key: 'marketing', label: '行銷中心', description: '模板、分眾、活動、自動觸發', ...crud('marketing') },
    ],
  },
  {
    key: 'settings', label: '設定', modules: [
      { key: 'system', label: '系統設定', description: '一般設定、使用者、部門（只有一種權限）', edit: 'manage_system' },
      { key: 'system_logs', label: '系統日誌', description: '操作紀錄查詢與匯出（含自動記帳紀錄）', view: 'view_system_logs' },
    ],
  },
];

export const PERMISSION_MODULES: PermissionModule[] = PERMISSION_GROUPS.flatMap(g => g.modules);

// 不屬於查看／新增／修改分類的特殊權限
export const SPECIAL_PERMISSIONS = [
  { value: 'all', label: '全部權限', description: '擁有所有權限，與其他權限互斥' },
  { value: 'picking', label: '撿貨人員', description: '可看撿貨單、更新撿貨狀態，建立出貨單時收 LINE 通知' },
];

const LABELS: Record<string, string> = Object.fromEntries([
  ...PERMISSION_MODULES.flatMap(m => [
    ...(m.view ? [[m.view, `查看${m.label}`]] : []),
    ...(m.create ? [[m.create, `新增${m.label}`]] : []),
    ...(m.edit ? [[m.edit, m.edit === 'manage_system' ? m.label : `修改／刪除${m.label}`]] : []),
    ...(m.approve ? [[m.approve, `核准${m.label}`]] : []),
  ]),
  ...SPECIAL_PERMISSIONS.map(p => [p.value, p.label]),
  ['admin', '管理員通知（舊）'],
]);

export const permissionLabel = (p: string) => LABELS[p] || p;

// 權限 → 涵蓋它的較高權限前綴
const IMPLIED_BY: Record<string, string[]> = {
  view_: ['create_', 'edit_', 'approve_', 'manage_'],
  create_: ['manage_'],
  edit_: ['approve_', 'manage_'],
};

/** 權限清單是否涵蓋 permission：all、完全相符，或同功能較高的權限（見檔頭）。 */
export const grantsPermission = (perms: string[] | undefined | null, permission: string) => {
  if (!perms) return false;
  if (perms.includes('all') || perms.includes(permission)) return true;
  const prefix = Object.keys(IMPLIED_BY).find(p => permission.startsWith(p));
  if (!prefix) return false;
  const module = permission.slice(prefix.length);
  return IMPLIED_BY[prefix].some(higher => perms.includes(`${higher}${module}`));
};
