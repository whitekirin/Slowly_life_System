// 從 LINE 圖文選單／按鈕卡開進後台頁面（/liff/go）的分頁會帶這個標記：
// 版面顯示「回 LINE 選單」，token 過期時自動回 /liff/go 重新用 LINE 身分登入，而不是跳到帳密登入頁。
const LIFF_MODE_KEY = 'liff_mode';

export const markLiffMode = () => {
  try {
    sessionStorage.setItem(LIFF_MODE_KEY, '1');
  } catch {
    // sessionStorage 不能用時就當一般瀏覽器
  }
};

export const isLiffMode = () => {
  try {
    return sessionStorage.getItem(LIFF_MODE_KEY) === '1';
  } catch {
    return false;
  }
};

/** 只接受站內、非 LIFF 的絕對路徑，避免 /liff/go?to= 被拿來導去外站。 */
export const safeStaffPath = (to: string | null) => {
  if (!to || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\') || to.startsWith('/liff')) return '/';
  return to;
};
