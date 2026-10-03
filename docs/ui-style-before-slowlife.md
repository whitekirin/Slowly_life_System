# 改版前 UI 排版與風格紀錄（2026-09-28 快照）

「慢生活製造所」風格改版之前，員工後台長這樣。原始檔完整備份在
`.backup/ui-before-slowlife-2026-09-28/`（`src/` 全目錄 + `index.html`），
一鍵退回：`bash scripts/ui-revert-slowlife.sh`。

## 1. 整體架構（`frontend/src/App.tsx` 的 `AppLayout`）

```
┌────────────┬──────────────────────────────────────────┐
│ Sider      │ Header（白底）                           │
│ 深藍 #001529│ 「中小型企業進銷存管理系統 (2025 Edition)」│
│ theme=dark │                     🔔  頭像(#87d068) 名字 │
│            ├──────────────────────────────────────────┤
│ Smart      │ Content：margin 16px，裡面一塊白底         │
│ Inventory  │ 圓角 8px、padding 24px 的容器包住所有頁面   │
│ 選單       │                                          │
│ （中英並列）│                                          │
│            ├──────────────────────────────────────────┤
│            │ Footer「Smart Inventory ERP ©2025 Created │
│            │ by Trae AI」                              │
└────────────┴──────────────────────────────────────────┘
```

- **Sider**：Ant Design 預設深色（`theme="dark"`，#001529），可收合；手機（< md）收成 0 寬、fixed 疊在畫面上。
  Logo 區是 64px 高的純文字「Smart Inventory」/ 收合時「SI」。
- **選單**：分組，標籤中英並列，例如「儀表板 (Dashboard)」「商品管理 (Products)」「採購與進貨 (Purchasing)」
  「銷售與出貨 (Sales)」「財務管理 (Finance)」「會員管理 (Members)」「設定 (Settings)」。
  `defaultSelectedKeys={["1"]}` 寫死——換頁時 active 項目不會跟著路由變。
- **Header**：白底，左邊系統全名，右邊（LINE 進來時多一個綠色 LIFF 圖示）通知鈴鐺 + Badge、綠色頭像 + 使用者名稱下拉（個人設定 / 登出）。
- **Content**：整頁灰底（antd 預設 #f5f5f5），內容放在白色圓角 8px 的大容器裡。
- **沒有全域 `ConfigProvider`**：員工後台全用 antd 6 預設主題（藍色 #1677ff、圓角 6px、系統字體）。
  會員前台（`MemberTheme`，紫色 #531dab）與 LIFF（`LiffTheme`，LINE 綠 #06c755）各自有獨立主題。

## 2. 色彩

| 用途 | 值 | 出處 |
| --- | --- | --- |
| 主色 | antd 預設藍 #1677ff | 未設定主題 |
| Sider | #001529 | antd dark menu |
| 頁面底 | #f5f5f5 / #f0f2f5（登入頁） | antd Layout / `Login.tsx` |
| 內容容器 | #ffffff | `App.tsx` |
| 全域 CSS | `index.css` 的 `:root` 是 Vite 範本（Inter 字體、深色 #242424 背景 + light media query） | `index.css` |
| 儀表板數字 | 綠 #3f8600、藍 #1890ff、紅 #cf1322、紫 #722ed1 | `Dashboard.tsx` |
| 圖表 | #8884d8（紫）/ #82ca9d（綠），recharts 範例色 | `Dashboard.tsx` |
| 金額／負數 | #cf1322、#ff4d4f | `ProductList`、`Accounting`、`PurchaseOrderList` 等 |
| 狀態 Tag | antd 預設高飽和 preset（green / geekblue / orange / red…） | 各頁 |

## 3. 字體與字級

- `index.css`：`Inter, system-ui, Avenir, Helvetica, Arial`（沒有中文字體，中文走系統預設）。
- 頁面標題各頁自己用 `<Title level={2}>`，多半中英並列（「出貨作業 (Sales Orders)」「退貨作業 (Returns)」）。
- 沒有 serif 標題、沒有統一的字級階層。

## 4. 元件

- 按鈕、輸入框、表格、Modal、Drawer 全部 antd 預設：圓角 6px、藍色 focus、表頭 #fafafa、黑色半透明遮罩。
- 空狀態：antd 預設英文 "No data"（沒有設 `zh_TW` locale）。
- Loading：`<Spin>` 或純文字 "Loading..."。
- 儀表板：標題「營運儀表板 (Dashboard)」→ 4 張 Statistic 卡（各一種高飽和色）→ 長條圖（假資料）+ 近期訂單表（假資料、英文狀態）。

## 5. 登入頁（`Login.tsx` / `ResetPassword.tsx`）

置中白卡，灰底 #f0f2f5，標題 "Smart Inventory"。

## 6. 本次改版範圍

只改**員工後台**（`AppLayout` 底下所有頁面 + 登入／重設密碼頁）。
**不動**：會員前台（`/member/*`、`MemberTheme`）、LIFF（`/liff*`、`LiffTheme`）、所有資料邏輯與 API。
