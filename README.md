# Smart Inventory & ERP Lite

> **「讓庫存變現金，讓管理變簡單 —— 專為成長型企業打造的營運大腦。」**
> *(Turn Inventory into Cash, Complexity into Clarity.)*

---

## 專案簡介 (Introduction)

本系統是一套針對 2025-2026 年市場需求設計的現代化中小型企業進銷存管理系統（ERP Lite）。目標對象包含貿易商、經銷商、小型製造商與零售通路。系統採用「模組化單體 (Modular Monolith)」架構，兼顧開發效率與未來微服務化的擴充性，並強調全通路整合、行動化作業與 AI 智能輔助。

---

## 技術棧架構 (Tech Stack)

| 層級 | 技術選型 | 版本 | 說明 |
| :--- | :--- | :--- | :--- |
| **Frontend** | React + TypeScript | React 19 / TS 5.x | 現代化前端框架，強型別開發 |
| **Build Tool** | Vite | 7.2.4 | 極速開發伺服器與打包工具 |
| **UI Library** | Ant Design (antd) | 6.2.0 | 企業級 UI 組件庫 |
| **State Management** | TanStack React Query | 5.x | 伺服器端狀態管理與快取 |
| **Routing** | React Router DOM | 7.x | 前端路由管理 |
| **Charts** | Recharts | 2.x | 資料視覺化圖表 |
| **Backend** | Python + FastAPI | 0.128.0 | 高效能非同步 Web API 框架 |
| **ORM** | SQLModel | 0.0.31 | 結合 SQLAlchemy + Pydantic 的現代 ORM |
| **Database** | SQLite | - | 輕量級關聯式資料庫（開發環境） |
| **Auth** | JWT (HS256) | - | OAuth2 Bearer Token 認證機制 |
| **Email** | FastAPI-Mail | 1.6.2 | SMTP 電子郵件整合 |

---

## 專案結構 (Project Structure)

```
System_Of_Speeching/
├── frontend/                          # React 前端應用程式
│   ├── src/
│   │   ├── pages/                     # 頁面元件
│   │   │   ├── Dashboard.tsx          # 儀表板首頁
│   │   │   ├── Login.tsx              # 登入頁面
│   │   │   ├── ProductList.tsx        # 商品管理
│   │   │   ├── CategoryList.tsx       # 類別管理
│   │   │   ├── SupplierList.tsx       # 供應商管理
│   │   │   ├── PurchaseOrderList.tsx  # 採購單管理
│   │   │   ├── Receiving.tsx          # 進貨驗收
│   │   │   ├── Shipping.tsx           # 出貨作業
│   │   │   ├── ReturnList.tsx         # 退貨作業
│   │   │   ├── StockTake.tsx          # 庫存盤點
│   │   │   ├── Accounting.tsx         # 記帳管理
│   │   │   ├── FileManager.tsx        # 檔案管理 (NAS)
│   │   │   ├── SharedFileView.tsx     # 分享檔案檢視
│   │   │   ├── Notifications.tsx      # 通知中心
│   │   │   ├── UserSettings.tsx       # 個人設定
│   │   │   ├── SystemSettings.tsx     # 系統設定
│   │   │   ├── SystemLogs.tsx         # 系統日誌
│   │   │   ├── CreateUser.tsx         # 使用者建立
│   │   │   └── ResetPassword.tsx      # 密碼重設
│   │   ├── components/                # 可重用 UI 元件
│   │   ├── contexts/
│   │   │   └── UserContext.tsx         # 使用者身份與權限 Context
│   │   ├── utils/
│   │   │   ├── costCalculator.ts      # 成本計算引擎
│   │   │   └── poCalculations.ts      # 採購單計算工具
│   │   ├── api.ts                     # Axios API 客戶端（集中管理）
│   │   ├── App.tsx                    # 主應用程式（路由 + 版面配置）
│   │   └── main.tsx                   # React 入口點
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.app.json
│
├── backend/                           # Python FastAPI 後端
│   ├── main.py                        # 主程式：所有 API 端點與中間件
│   ├── models.py                      # SQLModel 資料模型定義
│   ├── auth.py                        # JWT 認證與授權邏輯
│   ├── database.py                    # SQLite 資料庫連線設定
│   ├── file_manager.py                # NAS 檔案系統路由
│   ├── notifications.py               # 通知系統路由
│   ├── system_log.py                  # 系統日誌路由
│   ├── email_utils.py                 # 電子郵件設定與發送
│   ├── migrate_*.py                   # 資料庫遷移腳本
│   ├── test_*.py                      # 後端測試檔案
│   ├── database.db                    # SQLite 資料庫檔案
│   ├── static/uploads/                # 上傳檔案儲存目錄
│   └── venv/                          # Python 虛擬環境
│
└── static/                            # 共用靜態資源
```

---

## 系統啟動方式 (How to Run)

### 前置需求 (Prerequisites)

- **Node.js** >= 18.x（建議使用 LTS 版本）
- **npm** >= 9.x
- **Python** >= 3.10
- **pip**（Python 套件管理工具）

---

### 後端啟動 (Backend)

後端使用 Python FastAPI 框架，搭配 SQLite 資料庫，透過 uvicorn ASGI 伺服器運行。

```bash
# 1. 進入後端目錄
cd backend

# 2. 建立 Python 虛擬環境（首次設定）
python -m venv venv

# 3. 啟動虛擬環境
# Windows PowerShell:
.\venv\Scripts\Activate.ps1
# Windows CMD:
venv\Scripts\activate.bat
# macOS / Linux:
source venv/bin/activate

# 4. 安裝 Python 相依套件（首次設定）
pip install fastapi sqlmodel uvicorn passlib python-jose bcrypt python-multipart fastapi-mail pydantic-settings python-dotenv email-validator

# 5. 啟動後端伺服器
python main.py
```

**後端啟動後：**
- API 服務運行於：`http://localhost:8000`
- Swagger API 文件：`http://localhost:8000/docs`
- ReDoc API 文件：`http://localhost:8000/redoc`
- 首次啟動會自動建立 SQLite 資料庫（`database.db`）
- 自動建立預設管理員帳號：帳號 `admin` / 密碼 `password`

---

### 前端啟動 (Frontend)

前端使用 React 19 + TypeScript + Vite 技術棧，Ant Design 作為 UI 組件庫。

```bash
# 1. 進入前端目錄
cd frontend

# 2. 安裝 npm 相依套件（首次設定）
npm install

# 3. 啟動開發伺服器（含 HMR 熱更新）
npm run dev
```

**前端啟動後：**
- 開發伺服器運行於：`http://localhost:5173`
- 支援 HMR（Hot Module Replacement），修改程式碼後即時更新畫面
- 自動代理 API 請求至後端 `http://localhost:8000`

**其他前端指令：**

```bash
npm run build      # 正式環境打包（TypeScript 編譯 + Vite 打包）
npm run preview    # 預覽打包後的正式版本
npm run lint       # 執行 ESLint 程式碼檢查
npm run test       # 執行 Vitest 單元測試
```

---

### 完整啟動流程摘要

```
┌─────────────────────────────────────────────────────────┐
│  1. 啟動後端 (Terminal 1)                                │
│     cd backend                                          │
│     .\venv\Scripts\Activate.ps1                         │
│     python main.py                                      │
│     → http://localhost:8000                             │
│                                                         │
│  2. 啟動前端 (Terminal 2)                                │
│     cd frontend                                         │
│     npm run dev                                         │
│     → http://localhost:5173                             │
│                                                         │
│  3. 開啟瀏覽器，前往 http://localhost:5173               │
│     使用 admin / password 登入                          │
└─────────────────────────────────────────────────────────┘
```

---

## 核心功能模組 (Core Modules)

### 1. 儀表板 (Dashboard)

路由：`/`

儀表板提供系統運營的即時總覽，讓管理者快速掌握關鍵業務指標。

**功能內容：**
- **KPI 指標卡片**：顯示商品總數（SKU 數量）、庫存總價值（NTD）、當月銷售統計、當月採購統計
- **銷售趨勢圖表**：使用 Recharts 繪製月度銷售走勢折線圖
- **採購趨勢圖表**：顯示各月採購金額變化
- **近期訂單列表**：快速瀏覽最近建立的銷售訂單
- 所有數據透過 `/dashboard/stats` API 即時取得

---

### 2. 商品管理 (Product Management)

路由：`/products`

全面管理所有商品主檔資料，支援多維度的商品資訊維護。

**功能內容：**
- **商品 CRUD**：新增、檢視、編輯、刪除商品
- **SKU 自動生成**：系統自動產生唯一 SKU 編碼，SKU 建立後不可修改（確保資料一致性）
- **商品資訊欄位**：
  - 基本資訊：SKU、名稱、款式、規格屬性（JSON 結構）、條碼
  - 圖片與連結：商品圖片 URL、採購來源連結
  - 計量單位：件/箱/公斤等
- **成本與定價管理**：
  - 人民幣訂貨單價 (CNY)、匯率設定、境內運費 (CNY)
  - 集運費 (NTD/kg)、每件重量 (kg)、訂購數量
  - 系統自動計算：單品成本 (NTD) = (訂貨單價 + 境內運費) × 匯率 + 集運費 × 重量
  - 預計售價、最低價、最高價、定價策略
- **庫存管理**：
  - 即時庫存數量、安全庫存量、補貨前置天數
  - 低於安全庫存時觸發通知預警
- **供應商報價確認**：`is_confirmed` 標記追蹤報價狀態
- **商品搜尋與分頁**：支援關鍵字搜尋、分頁瀏覽

---

### 3. 類別管理 (Category Management)

路由：`/categories`

管理商品分類體系，便於商品的組織與篩選。

**功能內容：**
- 新增、刪除商品類別
- 每個類別包含名稱與描述
- 類別名稱唯一約束，避免重複

---

### 4. 供應商管理 (Supplier Management)

路由：`/suppliers`

維護所有供應商的主檔資料。

**功能內容：**
- **供應商 CRUD**：新增、編輯、刪除供應商
- **資訊欄位**：
  - 供應商名稱（唯一）、分類（如 1688 賣家、淘寶賣家等）
  - 聯絡人、電子郵件、電話、地址
  - 官方網站、銀行帳戶資訊
  - 備註（含更新時間追蹤）
- **篩選功能**：依名稱、分類搜尋供應商

---

### 5. 採購單管理 (Purchase Order Management)

路由：`/purchase-orders`

管理從建單到結案的完整採購流程。

**功能內容：**
- **採購單建立**：選擇供應商，加入商品明細（品項、數量、單價）
- **自動記錄採購人員**：系統自動將當前登入使用者設定為採購負責人
- **狀態流程管理**：
  - `draft`（草稿）→ `approved`（已核准）→ `received`（已收貨）→ `completed`（已結案）
- **金額計算**：
  - 總金額、總重量、集運費用、總成本、關稅
  - 前端提供計算工具（`poCalculations.ts`）
- **庫存連動**：
  - 狀態變更為 `received` 時，自動增加相關商品庫存
  - 刪除已收貨的採購單時，自動回滾庫存變更
  - 每次庫存變動產生 InventoryLog 紀錄
- **費用自動入帳**：
  - 採購收貨時自動在記帳系統建立對應的支出交易 (Transaction)

---

### 6. 進貨驗收 (Receiving / Goods Receipt)

路由：`/receiving`

確認採購到貨的實際數量，並完成入庫作業。

**功能內容：**
- 顯示所有待驗收的採購單（狀態為 `approved`）
- 逐項輸入實際收貨數量（`received_quantity`）
- 支援上傳驗收照片（`receiving_image`）與影片（`receiving_video`）
- 記錄驗收備註
- 確認收貨後自動更新庫存數量

---

### 7. 銷售訂單 / 出貨作業 (Sales Order / Shipping)

路由：`/shipping`

管理銷售訂單的建立、出貨與追蹤。

**功能內容：**
- **訂單建立**：
  - 自動產生唯一訂單編號（`order_number`）
  - 填寫客戶 ID、銷售平台（manual / shopee / amazon 等）
  - 加入商品明細（品項、數量、單價）
- **狀態流程**：
  - `pending`（待處理）→ `shipped`（已出貨）→ `completed`（已完成）
- **出貨資訊**：
  - 出貨負責人（`shipped_by`）、出貨日期、預計送達日期
  - 支援上傳出貨照片（`shipping_image`）與影片（`shipping_video`）
- **庫存連動**：出貨確認後扣減相關商品庫存
- **通知觸發**：出貨時產生出貨通知

---

### 8. 退貨管理 (Return Order Management)

路由：`/returns`

處理客戶退貨的完整流程。

**功能內容：**
- **退貨單建立**：
  - 自動產生唯一退貨編號（`return_number`）
  - 可關聯原始銷售訂單（`order_id`）
  - 填寫客戶 ID、退貨備註
- **退貨明細**：
  - 退貨品項、數量、退貨單價
  - 退貨原因說明
  - 支援上傳退貨照片（`return_image`）與影片（`return_video`）
- **狀態流程**：`pending`（待處理）→ `completed`（已完成）
- **退款計算**：自動加總退款金額（`total_refund_amount`）
- **庫存回補**：退貨完成後將商品退回庫存

---

### 9. 庫存盤點 (Stock Take / Inventory Count)

路由：`/stock-take`

定期盤點實體庫存，與系統帳面數量核對並調整差異。

**功能內容：**
- **建立盤點單**：自訂標題、備註
- **快照機制**：建立時自動擷取各品項的系統庫存數量（`system_quantity`）
- **實際盤點輸入**：逐項填寫實際清點數量（`actual_quantity`）
- **差異顯示**：系統自動計算差異量（實際 - 系統）
- **狀態流程**：`draft`（草稿）→ `completed`（已完成）
- **庫存調整**：
  - 完成盤點時，系統自動調整庫存至實際數量
  - 產生盤點調整的 InventoryLog 紀錄（change_type = `adjustment`）
- **篩選功能**：依狀態、日期範圍查詢歷史盤點紀錄

---

### 10. 記帳管理 (Accounting / Transaction Management)

路由：`/accounting`

記錄與追蹤所有收入與支出交易。

**功能內容：**
- **交易 CRUD**：新增、編輯、刪除交易紀錄
- **交易類型**：收入 (income)、支出 (expense)
- **分類管理**：銷售 (Sales)、採購 (Purchase)、租金 (Rent)、薪資 (Salary)、水電 (Utilities)、其他 (Other)
- **交易資訊**：
  - 日期、金額、說明
  - 付款方式：現金 (Cash)、銀行轉帳 (Bank Transfer)、信用卡 (Credit Card)
  - 關聯單號（如 SO-123、PO-456 等）
- **篩選功能**：依日期範圍、類型、分類搜尋交易
- **自動交易**：採購收貨時自動產生支出紀錄

---

### 11. 檔案管理系統 (File Manager / NAS)

路由：`/files`

類似 NAS 的檔案管理系統，支援多層資料夾結構與檔案分享。

**功能內容：**
- **資料夾管理**：
  - 新增、重新命名、刪除資料夾
  - 支援無限巢狀資料夾結構（self-referential parent/child）
  - 記錄擁有者與建立者
- **檔案管理**：
  - 拖放式上傳檔案，支援上傳進度顯示
  - 刪除檔案、移動檔案至不同資料夾
  - 顯示檔案大小、類型、建立 / 更新時間
- **批次下載**：
  - 整個資料夾打包為 ZIP 下載
- **分享連結功能**：
  - 產生帶有唯一 Token 的分享連結
  - 設定連結到期時間（`expires_at`）
  - 設定細粒度權限：讀取 (read)、下載 (download)
  - 啟用 / 停用分享連結
  - 外部訪客可透過 `/share/:token` 路由存取分享內容
- **日期篩選**：依建立日期範圍篩選檔案列表

---

### 12. 通知中心 (Notification Center)

路由：`/notifications`

集中管理所有系統通知與預警訊息。

**功能內容：**
- **通知類型**：
  - 庫存預警 (stock_alert)：庫存低於安全庫存量時觸發
  - 出貨通知 (shipping_update)：訂單出貨狀態更新
  - 系統通知 (system)：一般系統訊息
- **即時徽章計數**：Header 鈴鐺圖示顯示未讀通知數量，每 60 秒自動刷新
- **通知管理**：
  - 標記單筆通知為已讀
  - 一鍵全部已讀
  - 分頁瀏覽通知列表
- **專用查詢**：
  - 出貨相關通知列表
  - 庫存水位預警列表

---

### 13. 使用者管理與認證 (User Management & Authentication)

路由：`/login`、`/settings`、`/users/create`、`/reset-password`

完整的使用者生命週期管理與安全認證機制。

**認證機制：**
- JWT (JSON Web Token) 認證，演算法 HS256
- OAuth2 Bearer Token 方案
- Token 有效期限 24 小時
- 前端透過 axios interceptor 自動附加 Token
- Token 過期或無效時自動導向登入頁面

**使用者功能：**
- **登入 / 登出**：OAuth2 標準登入流程
- **使用者建立**（管理員專用）：
  - 設定帳號、密碼、電子郵件、全名
  - 指派部門、權限列表
  - 強制初次登入更改密碼
- **個人設定**：修改個人資料、電子郵件
- **密碼重設**：
  - 忘記密碼 → 輸入 Email → 系統發送重設連結（30 分鐘有效）
  - 重設連結導向 `/reset-password` 頁面
  - 雙語（中英文）HTML 郵件模板

**權限控制：**
- `is_superuser`：超級管理員旗標
- `permissions`：細粒度權限陣列（JSON），包含：
  - `view_dashboard` - 檢視儀表板
  - `view_products` / `manage_products` - 商品檢視 / 管理
  - `view_categories` / `manage_categories` - 類別檢視 / 管理
  - `view_suppliers` / `manage_suppliers` - 供應商檢視 / 管理
  - `view_purchase_orders` / `manage_purchase_orders` - 採購單檢視 / 管理
  - `view_receiving` / `manage_receiving` - 驗收檢視 / 管理
  - `view_shipping` / `manage_shipping` - 出貨檢視 / 管理
  - `view_returns` / `manage_returns` - 退貨檢視 / 管理
  - `view_finance` / `manage_finance` - 財務檢視 / 管理
  - `manage_system` - 系統管理

**部門管理：**
- 建立部門並設定預設權限
- 使用者指派至部門後繼承部門預設權限

---

### 14. 系統設定 (System Settings)

路由：`/system-settings`（管理員專用）

管理全域系統配置參數。

**功能內容：**
- Key-Value 形式的系統設定儲存
- 每筆設定包含：鍵名、值、描述說明
- 新增或更新系統參數

---

### 15. 系統日誌 (System Audit Logs)

路由：`/system-logs`（管理員專用）

完整的系統操作稽核軌跡。

**功能內容：**
- **自動記錄**：透過 HTTP 中間件自動記錄所有 API 請求
- **記錄欄位**：
  - 時間戳記、操作使用者、IP 位址
  - 操作類型：create / query / update / delete / login
  - 操作資源、詳細內容、執行狀態 (success / failure)
- **排除路徑**：`/docs`、`/redoc`、`/openapi.json`、`/static`、`/token` 等不記錄
- **搜尋與篩選**：依使用者名稱、操作類型、日期範圍搜尋
- **分頁瀏覽**：支援指定頁碼與每頁筆數
- **CSV 匯出**：將日誌匯出為 CSV 檔案（UTF-8-sig 編碼，相容 Excel）

---

## 資料模型 (Data Models)

### 核心實體關聯圖

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│ Supplier │────→│PurchaseOrder │────→│  POItem  │──→ Product
└──────────┘     └──────────────┘     └──────────┘
                                                       ↑
┌──────────┐     ┌──────────────┐     ┌──────────┐    │
│ Customer │────→│ SalesOrder   │────→│  SOItem  │────┘
└──────────┘     └──────────────┘     └──────────┘
                        │                              ↑
                        ↓                              │
                 ┌──────────────┐     ┌───────────┐   │
                 │ ReturnOrder  │────→│ReturnItem │───┘
                 └──────────────┘     └───────────┘

┌──────────┐     ┌───────────────┐
│StockTake │────→│StockTakeItem  │──→ Product
└──────────┘     └───────────────┘

┌──────────┐     ┌──────────┐     ┌───────────┐
│  Folder  │────→│ FileModel│     │ ShareLink │──→ Folder
│ (巢狀)   │     └──────────┘     └───────────┘
└──────────┘

Product ←── InventoryLog（庫存異動紀錄）
User    ←── Notification（通知）
User    ←── SystemLog（系統日誌）
```

### 關鍵資料欄位

| 實體 | 關鍵欄位 |
| :--- | :--- |
| **User** | username (unique), email, full_name, department, permissions (JSON), is_superuser, force_password_change, settings (JSON) |
| **Product** | sku (unique/immutable), name, style, attributes (JSON), barcode, price_rmb, exchange_rate, shipping_rmb, shipping_rate_twd, weight_kg, cost_price, sales_price, stock_quantity, safety_stock, lead_time_days |
| **Supplier** | name (unique), category, contact_person, email, phone, address, website, bank_account, note |
| **PurchaseOrder** | supplier_name, order_date, status, total_amount, total_weight, total_shipping_fee, total_cost, tariff, purchaser_name |
| **POItem** | product_id, quantity, unit_price, received_quantity, note, receiving_image, receiving_video |
| **SalesOrder** | order_number (unique), customer_id, platform, status, total_amount, shipped_by, shipping_date, estimated_arrival |
| **SOItem** | product_id, quantity, unit_price, shipping_image, shipping_video |
| **ReturnOrder** | return_number (unique), order_id (FK→SalesOrder), customer_id, status, total_refund_amount, note |
| **ReturnItem** | product_id, quantity, unit_price, reason, return_image, return_video |
| **StockTake** | title, status, note; items 含 system_quantity (快照), actual_quantity (實盤) |
| **Transaction** | date, type (income/expense), category, amount, payment_method, reference_id |
| **InventoryLog** | product_id, change_amount, change_type, log_date, reference_id |
| **Folder** | name, parent_id (自關聯), owner_id, creator_id |
| **FileModel** | name, folder_id, size, content_type, file_path |
| **ShareLink** | token (unique), folder_id, expires_at, permissions (JSON), is_active |
| **Notification** | user_id, title, content, type, is_read, related_id |
| **SystemLog** | timestamp, username, ip_address, action, resource, details, status |
| **SystemSetting** | key (PK), value, description |
| **Department** | name (unique), description, default_permissions (JSON) |
| **Category** | name (unique), description |

---

## 關鍵資料流 (Data Flow)

### 1. 採購循環 (Procure-to-Pay)

```
採購單建立 (draft)
    ↓
核准 (approved) → 倉庫待驗收
    ↓
驗收 (received)
    ├─→ 庫存數量增加（Product.stock_quantity += received_quantity）
    ├─→ 產生 InventoryLog（change_type = "purchase"）
    └─→ 自動建立 Transaction（type = "expense"）
    ↓
結案 (completed)
```

### 2. 銷售循環 (Order-to-Cash)

```
銷售訂單建立 (pending)
    ↓
出貨 (shipped)
    ├─→ 庫存數量減少（Product.stock_quantity -= quantity）
    ├─→ 產生 InventoryLog（change_type = "sale"）
    └─→ 產生出貨通知 (Notification: shipping_update)
    ↓
完成 (completed)
```

### 3. 退貨循環 (Return Flow)

```
退貨單建立 (pending)
    ├─→ 關聯原始銷售訂單
    ↓
退貨完成 (completed)
    ├─→ 庫存回補（Product.stock_quantity += return_quantity）
    └─→ 產生 InventoryLog（change_type = "adjustment"）
```

### 4. 盤點循環 (Stock Take Flow)

```
建立盤點單 (draft)
    ├─→ 快照當前系統庫存數量
    ↓
填入實際數量 → 計算差異
    ↓
完成盤點 (completed)
    ├─→ 調整庫存至實際數量
    └─→ 產生 InventoryLog（change_type = "adjustment"）
```

---

## API 端點總覽 (API Endpoints)

### 認證 (Authentication)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/token` | 使用者登入（OAuth2 表單） |
| POST | `/auth/forgot-password` | 請求密碼重設郵件 |
| POST | `/auth/reset-password` | 確認密碼重設 |

### 使用者 (Users)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/users/me/` | 取得當前使用者資訊 |
| PATCH | `/users/me` | 更新當前使用者資訊 |
| POST | `/users/` | 建立新使用者（管理員） |
| GET | `/users/` | 列出所有使用者 |
| PATCH | `/users/{user_id}` | 更新使用者（管理員） |
| DELETE | `/users/{user_id}` | 刪除使用者（管理員） |
| GET | `/users/check/{username}` | 檢查帳號是否已存在 |

### 商品 (Products)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/products/` | 建立商品 |
| GET | `/products/` | 列出商品（分頁） |
| GET | `/products/{product_id}` | 取得單一商品 |
| PATCH | `/products/{product_id}` | 更新商品（SKU 唯讀） |
| DELETE | `/products/{product_id}` | 刪除商品 |
| GET | `/products/generate_sku/` | 產生唯一 SKU |
| POST | `/products/ensure` | 依 SKU 建立或更新商品 |

### 類別 (Categories)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/categories/` | 建立類別 |
| GET | `/categories/` | 列出所有類別 |
| DELETE | `/categories/{category_id}` | 刪除類別 |

### 供應商 (Suppliers)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/suppliers/` | 建立供應商 |
| GET | `/suppliers/` | 列出供應商（支援搜尋） |
| PATCH | `/suppliers/{supplier_id}` | 更新供應商 |
| DELETE | `/suppliers/{supplier_id}` | 刪除供應商 |

### 採購單 (Purchase Orders)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/purchase_orders/` | 建立採購單（含明細） |
| GET | `/purchase_orders/` | 列出所有採購單 |
| PATCH | `/purchase_orders/{po_id}` | 更新採購單 |
| DELETE | `/purchase_orders/{po_id}` | 刪除採購單（已收貨則回滾庫存） |

### 銷售訂單 (Sales Orders)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/sales_orders/` | 建立銷售訂單 |
| GET | `/sales_orders/` | 列出所有銷售訂單 |
| PATCH | `/sales_orders/{so_id}` | 更新銷售訂單 |
| DELETE | `/sales_orders/{so_id}` | 刪除銷售訂單 |

### 退貨單 (Return Orders)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/return_orders/` | 建立退貨單 |
| GET | `/return_orders/` | 列出所有退貨單 |
| GET | `/return_orders/{ro_id}` | 取得退貨單詳情 |
| PATCH | `/return_orders/{ro_id}` | 更新退貨單 |
| DELETE | `/return_orders/{ro_id}` | 刪除退貨單 |

### 庫存盤點 (Stock Takes)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/stock_takes/` | 建立盤點單 |
| GET | `/stock_takes/` | 列出盤點單（依狀態 / 日期篩選） |
| GET | `/stock_takes/{st_id}` | 取得盤點單詳情 |
| PATCH | `/stock_takes/{st_id}` | 更新盤點項目 |
| POST | `/stock_takes/{st_id}/complete` | 完成盤點並調整庫存 |
| DELETE | `/stock_takes/{st_id}` | 刪除盤點單 |

### 庫存異動 (Inventory Logs)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/inventory/logs/` | 列出庫存異動紀錄 |

### 儀表板 (Dashboard)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/dashboard/stats` | 取得 KPI 統計數據 |

### 記帳 (Transactions)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/transactions/` | 建立交易紀錄 |
| GET | `/transactions/` | 列出交易（依日期 / 類型 / 分類篩選） |
| PATCH | `/transactions/{id}` | 更新交易 |
| DELETE | `/transactions/{id}` | 刪除交易 |

### 部門 (Departments)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/departments/` | 建立部門 |
| GET | `/departments/` | 列出所有部門 |
| PATCH | `/departments/{id}` | 更新部門 |
| DELETE | `/departments/{id}` | 刪除部門 |

### 系統設定 (System Settings)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/system-settings/` | 列出所有設定 |
| POST | `/system-settings/` | 新增 / 更新設定 |

### 系統日誌 (System Logs)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/system-logs/` | 取得分頁日誌（支援搜尋） |
| GET | `/system-logs/export` | 匯出日誌為 CSV |

### 通知 (Notifications)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/notifications/` | 列出使用者通知（分頁） |
| GET | `/notifications/unread-count` | 取得未讀通知數量 |
| POST | `/notifications/{id}/read` | 標記通知為已讀 |
| POST | `/notifications/mark-all-read` | 全部標記為已讀 |
| GET | `/notifications/shipping` | 出貨相關通知 |
| GET | `/notifications/stock-levels` | 庫存預警通知 |

### 檔案管理 (NAS / File Manager)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| GET | `/nas/items/` | 列出檔案 / 資料夾（分頁 + 日期篩選） |
| GET | `/nas/folders/` | 列出根目錄資料夾 |
| GET | `/nas/folders/{id}` | 取得資料夾詳情 |
| POST | `/nas/folders/` | 建立資料夾 |
| PATCH | `/nas/folders/{id}` | 更新資料夾 |
| DELETE | `/nas/folders/{id}` | 刪除資料夾 |
| POST | `/nas/files/upload` | 上傳檔案 |
| DELETE | `/nas/files/{id}` | 刪除檔案 |
| PATCH | `/nas/files/{id}` | 移動檔案 |
| GET | `/nas/folders/{id}/download-zip` | 資料夾打包下載 |
| POST | `/nas/shares/` | 建立分享連結 |
| GET | `/nas/shares/` | 列出分享連結 |
| GET | `/nas/shares/{token}` | 存取分享資料夾 |
| GET | `/nas/shares/{token}/content` | 取得分享內容 |
| GET | `/nas/shares/{token}/download/{fileId}` | 下載分享檔案 |
| GET | `/nas/shares/{token}/download-zip` | 分享資料夾打包下載 |
| DELETE | `/nas/shares/{id}` | 刪除分享連結 |

### 檔案上傳 (General Upload)
| Method | Endpoint | 說明 |
| :--- | :--- | :--- |
| POST | `/upload/` | 簡易檔案上傳（存至 static/uploads） |

---

## 成本計算引擎 (Cost Calculation Engine)

系統內建完整的跨境電商成本計算邏輯，支援從人民幣採購到台幣定價的完整轉換。

**計算公式：**

```
商品成本 (NTD) = (訂貨單價_CNY + 境內運費_CNY) × 匯率 + 集運費_NTD × 每件重量_KG

其中：
  - 訂貨單價_CNY = price_rmb
  - 境內運費_CNY = shipping_rmb
  - 匯率 = exchange_rate（預設 5.0）
  - 集運費_NTD = shipping_rate_twd（每公斤集運費）
  - 每件重量_KG = weight_kg
```

**前端工具：**
- `costCalculator.ts`：商品成本計算器
- `poCalculations.ts`：採購單彙總計算（含單元測試覆蓋）

---

## 環境變數設定 (Environment Variables)

| 變數名稱 | 說明 | 預設值 |
| :--- | :--- | :--- |
| `MAIL_USERNAME` | SMTP 帳號 | （開發環境可省略） |
| `MAIL_PASSWORD` | SMTP 密碼 / 應用程式密碼 | （開發環境可省略） |
| `MAIL_FROM` | 寄件者 Email | noreply@example.com |
| `MAIL_SERVER` | SMTP 伺服器 | smtp.gmail.com |
| `MAIL_PORT` | SMTP 埠號 | 587 |
| `MAIL_FROM_NAME` | 寄件者顯示名稱 | Smart Inventory ERP |
| `SECRET_KEY` | JWT 簽名密鑰 | （生產環境務必更換） |

---

## 測試 (Testing)

### 前端測試

```bash
cd frontend
npm run test       # 執行 Vitest 單元測試
```

測試涵蓋：
- `App.test.tsx` - 應用程式整合測試
- `UserContext.test.tsx` - 使用者身份 Context 測試
- `FileManager.test.tsx` - 檔案管理功能測試
- `costCalculator.test.ts` - 成本計算邏輯測試
- `poCalculations.test.ts` - 採購單計算測試
- `poIntegration.test.ts` - 採購整合測試

### 後端測試

```bash
cd backend
python -m pytest   # 執行所有後端測試
```

測試涵蓋：
- `test_sku_readonly.py` - SKU 唯讀保護測試
- `test_po_purchaser.py` - 採購單採購人員自動指派測試
- `test_po_validation.py` - 採購單驗證測試
- `test_system_log.py` - 系統日誌測試
- `test_user_settings.py` - 使用者設定測試
- `test_share_management.py` - 分享連結管理測試
- `test_folder_upload.py` - 資料夾上傳測試
- `test_email_flow.py` - 郵件流程測試

---

## 資料庫遷移 (Database Migrations)

系統使用手動遷移腳本進行資料庫架構演進，位於 `backend/` 目錄下：

```bash
python migrate_department_v1.py     # 部門欄位遷移 v1
python migrate_department_v2.py     # 部門欄位遷移 v2
python migrate_user_v1.py           # 使用者欄位遷移
python migrate_po_purchaser.py      # 採購單採購人員欄位遷移
python migrate_supplier_v1.py       # 供應商欄位遷移
python migrate_sales_order_v2.py    # 銷售訂單遷移 v2
python migrate_sales_order_v3.py    # 銷售訂單遷移 v3
python migrate_notifications.py     # 通知系統遷移
python migrate_creator.py           # 建立者欄位遷移
```

---

## 預設帳號 (Default Credentials)

| 帳號 | 密碼 | 角色 |
| :--- | :--- | :--- |
| `admin` | `password` | 超級管理員（擁有所有權限） |

> **注意**：正式環境部署前，請務必修改預設密碼與 JWT SECRET_KEY。

---

## 未來規劃 (Roadmap)

- AI 智能採購建議（Copilot）：依據銷售速度與前置時間自動產生建議採購單
- 行動優先倉儲（Mobile First）：Flutter App 支援手機掃碼作業
- 電商平台整合：蝦皮 (Shopee)、Shopify、WooCommerce 訂單同步
- 動態儀表板（BI Dashboard）：高度客製化的數據看板
- ChatOps 整合：LINE / Slack 即時通知
- 低代碼自訂欄位（No-Code）：允許使用者自行拖拉新增業務欄位
- 微服務架構遷移：現有模組化單體架構支援逐步拆分

---

## 授權 (License)

Smart Inventory ERP &copy; 2025
