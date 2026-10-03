# 功能比較：Smart Inventory & ERP Lite vs. 市面公開進銷存／採購系統

> 產出日期：2026-07-07。比較範圍**只看功能**，不比部署方式、價格、網域等非功能面向。
> 「我方系統」欄以原始碼盤點為準（附 檔案:行號 佐證），外部系統以官方公開文件為準（附來源連結）。

## 1. 我方系統功能基準（原始碼盤點）

### 進銷存核心（員工後台）

| 功能 | 狀態 | 佐證 |
| :--- | :--- | :--- |
| 商品主檔（SKU 自動產生、屬性/款式、分類、條碼欄位） | ✅ | `backend/main.py:368-547`、`models.py:118` |
| 進貨成本試算（RMB 匯率/運費/關稅/蝦皮 16% 抽成/毛利率） | ✅ 特色 | `models.py:99-104,143-147`、`PurchaseOrderList.tsx:905-1056` |
| 採購單（draft→completed→received 流轉、逐張 Excel 匯出） | ✅ | `backend/main.py:675-836` |
| 收貨驗收（實收數量、照片/影片憑證、入庫自動記帳） | ✅ 特色 | `models.py:158-161`、`main.py:775-804`、`Receiving.tsx` |
| 銷售出貨（出貨扣庫存、平台別：蝦皮/Amazon/手動） | ✅ | `Shipping.tsx:308-309` |
| 退貨（銷退回補庫存、原因、照片/影片） | ✅ | `backend/main.py:1088-1227` |
| 盤點（快照系統量、差異調整、完成回寫） | ✅ | `backend/main.py:1260-1391` |
| 庫存異動流水帳 InventoryLog | ✅ | `backend/main.py:1060`、`models.py:246` |
| 安全庫存警示（三處 UI、建議補貨量、Excel 匯出） | ✅ | `models.py:115`、`Notifications.tsx:159-176,368-380` |
| 供應商管理（1688/淘寶分類、銀行帳號、備註） | ✅ | `backend/main.py:557-612` |
| 收支記帳（PO/SO 自動入帳、收支淨利統計卡） | ✅ | `backend/main.py:1586-1642`、`Accounting.tsx` |
| 稽核日誌（操作記錄、圖表、CSV 匯出） | ✅ | `backend/system_log.py`、`SystemLogs.tsx` |
| 部門與權限管理 | ✅ | `backend/main.py:1424-1550` |
| NAS 檔案管理（資料夾、ZIP 下載、到期分享連結） | ✅ 特色 | `backend/file_manager.py` |

### 會員電商側（獨立認證的第二套前端）

| 功能 | 狀態 | 佐證 |
| :--- | :--- | :--- |
| 會員等級/點數/推薦碼、後台批次管理與 Excel 匯出 | ✅ 特色 | `backend/members.py`、`MemberList.tsx` |
| 行銷活動（受眾分群、開信/點擊追蹤像素、成效圖表） | ✅ 特色 | `backend/marketing.py:131-357` |
| 自動化觸發行銷（生日/註冊/點數到期） | ✅ 特色 | `backend/marketing.py:380-399` |
| DM 推播（WebSocket 即時、收藏、瀏覽/點擊埋點） | ✅ 特色 | `backend/dms.py` |
| 站內信（WebSocket 即時推播、已讀） | ✅ 特色 | `backend/mail_symbols.py` |
| 點數商店（扣點換折扣碼、兌換紀錄） | ✅ 特色 | `backend/points_store.py` |

### 已確認的功能空缺（原始碼驗證）

| 缺口 | 現況證據 |
| :--- | :--- |
| 多倉庫/儲位 | 無 Warehouse 表；庫存只有 `Product.stock_quantity` 單一總量（`models.py:118`） |
| 批號/序號/效期管理 | 無 lot/expiry 欄位；`batch_quantity` 是訂購數量非批號（`models.py:104`） |
| 採購審核流程 | status 有 `approved` 字樣但無審核人/狀態機驗證，可任意 PATCH（`models.py:141`、`main.py:739`） |
| 庫存預留（銷售單佔用） | SO 建立不預留，僅出貨時扣減 |
| 再訂購點/自動補貨 | 有 `lead_time_days` 欄位（`models.py:116`）但無任何補貨邏輯 |
| 條碼掃描作業 | 有 `Product.barcode` 欄位（`models.py:95`）但無掃描查詢端點 |
| 詢價/報價（RFQ）、應收應付帳齡、多幣別總帳、BOM/製造 | 全無相關資料表與端點 |
| 多平台庫存同步 / 平台 API 串接 | 平台別僅為字串欄位，無蝦皮/Amazon API 整合 |

## 2. 外部系統功能盤點

### 2.1 開源 ERP（查證日 2026-07-07，來源為官方文件）

#### Odoo（Inventory / Purchase）

- **商品管理**：有——SKU、屬性→變體、每變體獨立條碼、分類。[變體文件](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/products/variants.html)
- **多倉庫/儲位**：有——倉庫、階層儲位、putaway 規則、routes。[Inventory 文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory.html)
- **批號/序號/效期**：有——[lots](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/lots.html)、[serial numbers](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/serial_numbers.html)、[expiration dates](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html) 各有專頁。
- **條碼掃描**：有——獨立 Barcode app（收貨/揀貨/盤點掃描、GS1）。[文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/barcode/operations/barcode_nomenclature.html)
- **盤點**：有——inventory adjustments 與 cycle counts。[文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/inventory_management/count_products.html)
- **庫存預留**：有——三種 reservation methods。[文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/reservation_methods.html)
- **再訂購點/自動補貨**：有——reordering rules 自動開 PO/製造單。[文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/warehouses_storage/replenishment/reordering_rules.html)
- **採購**：有——RFQ → PO → 收貨 → 帳單控制，blanket orders、call for tenders。[Purchase 文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase.html)
- **採購審核**：部分——多層簽核靠 Studio approval rules（企業版）。[文件](https://www.odoo.com/documentation/18.0/applications/studio/approval_rules.html)
- **供應商價格表**：有——供應商價目表自動帶價。[文件](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/products/pricelist.html)
- **銷售/出貨/發票**：有——批次/波次揀貨、FIFO/FEFO 策略、完整 Invoicing。
- **退貨**：有——reverse transfer + 退款流程（銷退有專頁；採購退貨同機制、獨立文件未確認）。[文件](https://www.odoo.com/documentation/18.0/applications/sales/sales/products_prices/returns.html)
- **報表**：有——庫存估值、庫齡、採購分析，pivot/graph 自訂。
- **財務**：有——複式記帳、應收應付、多幣別自動匯率。[文件](https://www.odoo.com/documentation/18.0/applications/finance/accounting.html)
- **CRM/行銷**：有——CRM、Email Marketing、Marketing Automation、忠誠度/eWallet。
- **電商整合**：有——內建 eCommerce、官方 Amazon Connector、**官方 Shopee Connector**。[Shopee 文件](https://www.odoo.com/documentation/18.0/applications/sales/sales/shopee_connector/setup.html)
- **API/自動化**：有——External API（XML/JSON-RPC）、Automation Rules、webhook（Studio）。

> 定位：模組最全、電商與行銷整合最強的全功能商業套件；部分進階能力綁企業版。

#### ERPNext（Stock / Buying）

- **商品管理**：有——Item 主檔含條碼、Item Group、屬性→變體。[Item](https://docs.frappe.io/erpnext/item)、[Variants](https://docs.frappe.io/erpnext/item-variants)
- **多倉庫/儲位**：有——樹狀倉庫（Warehouse > Room > Row > Shelf > Bin）。[文件](https://docs.frappe.io/erpnext/user/manual/en/warehouse)
- **批號/序號/效期**：有——[Batch（含效期）](https://docs.frappe.io/erpnext/user/manual/en/batch)、[Serial No](https://docs.frappe.io/erpnext/serial-no)。
- **條碼掃描**：有——各交易單據可掃碼帶入，盤點支援掃碼。
- **盤點**：有——Stock Reconciliation（手動/匯入/掃碼）。[文件](https://docs.frappe.io/erpnext/user/manual/en/stock-reconciliation)
- **庫存預留**：有——Stock Reservation 對 SO/揀貨單保留。[文件](https://docs.frappe.io/erpnext/user/manual/en/stock-reservation)
- **再訂購點/自動補貨**：有——reorder level 自動產生 Material Request。[文件](https://docs.frappe.io/erpnext/v13/user/manual/en/stock/articles/auto-creation-of-material-request)
- **採購**：有——Material Request → RFQ → Supplier Quotation → PO → Purchase Receipt → Purchase Invoice 全鏈。[PO](https://docs.frappe.io/erpnext/user/manual/en/purchase-order)
- **採購審核**：有——Frappe Workflow 可對任意單據設多層簽核（免費）。[文件](https://docs.frappe.io/erpnext/workflows)
- **供應商管理**：有——Supplier 主檔、Supplier Scorecard 績效評分、多幣別價格表。[Scorecard](https://docs.frappe.io/erpnext/supplier-scorecard)
- **銷售/出貨**：有——SO → Pick List（FIFO、效期就近）→ Delivery Note → Sales Invoice。
- **退貨**：有——[Purchase Return](https://docs.frappe.io/erpnext/user/manual/en/purchase-return)、[Sales Return](https://docs.frappe.io/erpnext/user/manual/en/sales-return)（配 debit/credit note）。
- **報表**：部分——各模組標準報表 + Report Builder/Dashboard（框架層）。
- **財務**：有——複式記帳、應收應付、多幣別，全免費。[文件](https://docs.frappe.io/erpnext/accounting/introduction)
- **CRM/行銷**：有——CRM（Lead/Opportunity）、Loyalty Program（點數/等級）。[Loyalty](https://docs.frappe.io/erpnext/user/manual/en/loyalty-program)
- **電商整合**：有——官方 Shopify（庫存同步）與 Amazon SP-API 整合；Shopee 無官方整合。[Shopify](https://docs.frappe.io/erpnext/shopify_integration)
- **API/自動化**：有——所有 DocType 自動生成 REST endpoint、Webhooks（HMAC）、Server Script。[REST](https://docs.frappe.io/framework/user/en/api/rest)

> 定位：單據流最完整的免費全開源 ERP，進銷存＋財務＋簽核工作流一體。

#### InvenTree

- **商品管理**：有——Part 主檔＋階層分類、Template→變體、完全自訂 Parameters、條碼。[Part](https://docs.inventree.org/en/stable/part/)
- **多倉庫/儲位**：有——階層式 Stock Locations（位置樹）。[Stock](https://docs.inventree.org/en/stable/stock/)
- **批號/序號/效期**：有——批號/序號追蹤、過期自動標記並限用。[Expiry](https://docs.inventree.org/en/stable/stock/expiry/)
- **條碼掃描**：有——網頁與手機 App 掃碼收料/移轉/查詢。[Barcodes](https://docs.inventree.org/en/latest/barcodes/)
- **盤點**：部分——Stocktake 偏庫存快照/估值追蹤，無完整盤盈虧調整單流程。[文件](https://docs.inventree.org/en/stable/part/stocktake/)
- **庫存預留**：部分——SO/製造單 stock allocation（含 Auto Allocate）。
- **再訂購點**：部分——最低庫存 + low stock email 通知，不會自動開 PO。
- **採購**：有——PO 逐項收貨入庫、多幣別；**無 RFQ**、審核流程未確認。[PO](https://docs.inventree.org/en/latest/purchasing/purchase_order/)
- **供應商**：有——Supplier/Manufacturer part、數量級距價（price breaks）。
- **銷售/出貨**：部分——SO + shipment + 分配出貨；**無發票功能**。
- **退貨**：部分——Return Order（客戶退回，預設關閉）；採購退貨無專門單據。
- **報表**：部分——範本式報表/標籤產生器，非 BI 儀表板。
- **財務**：無記帳/應收應付；僅多幣別定價。
- **CRM/行銷/電商**：無。
- **API/自動化**：有——API-first、Python client、plugin/mixin 擴充。[API](https://docs.inventree.org/en/stable/api/)

> 定位：輕量、API-first 的純庫存/零件管理系統（偏工程件追蹤），刻意不做財務、CRM、電商。

### 2.2 國際 SaaS 庫存系統（查證日 2026-07-06~07，來源為官方功能頁/定價頁/說明中心）

#### Zoho Inventory

- **商品管理**：有——Item Groups 依屬性建變體並自動產生 SKU、組合商品、條碼產生列印、價格表。[Features](https://www.zoho.com/us/inventory/features/)
- **多倉庫/儲位**：有——多倉、Transfer Orders 調撥、bin locations（依方案限量）。[Pricing](https://www.zoho.com/us/inventory/pricing/)
- **批號/序號/效期**：有——Serial 與 Batch Tracking（含效期），Premium 以上。
- **條碼掃描**：有——掃描帶入單據。
- **盤點**：有——Stock Counting（Premium 以上）＋ Inventory Adjustments。
- **庫存預留**：部分——Committed Stock 機制（銷售單開立即佔用）。[文件](https://www.zoho.com/us/books/kb/items/committed-stock.html)
- **再訂購點**：有——低於門檻自動通知。
- **採購**：有——PO、Purchase Receives 收貨、供應商價格表自動帶價、Backorder/Dropship；**審核流程有**（Transaction Approval 涵蓋銷售/採購/庫存單據）。[Approval 文件](https://www.zoho.com/us/inventory/help/transaction-approval/transaction-approval.html)；對供應商 RFQ 未確認。
- **銷售/出貨**：有——SO 轉發票、揀貨單、30+ 承運商運送標籤、金流收款。
- **退貨**：有——銷退 RMA（退款/折抵）與採購退貨（產生 Vendor Credit）。
- **報表**：有——互動儀表板；Enterprise 含 Zoho Analytics BI。
- **財務**：部分——發票/帳單/付款內建，總帳靠 Zoho Books/Xero/QuickBooks 整合。
- **CRM/行銷**：部分——整合 Zoho CRM；忠誠度/折價券綁 Zoho Commerce（Plus 方案）。
- **電商整合**：有——Shopify、Amazon、eBay、Etsy、Walmart、WooCommerce；Shopee 未確認。
- **API/自動化**：有——REST API、Webhooks、Deluge custom functions、Workflow Rules。

> 定位：Zoho 生態系內的高 CP 值中小企業進銷存，靠全家桶補財務與 CRM。

#### inFlow Inventory

- **商品管理**：部分——SKU、分類、自訂欄位、條碼標籤設計齊全；變體矩陣未在官方功能表列出（未確認）。[All Features](https://www.inflowinventory.com/features/all-features)
- **多倉庫/儲位**：有——多 location＋sublocations、調撥含在途。
- **批號/序號/效期**：有——序號（付費加購）、批號＋效期。
- **條碼掃描**：有——掃描收貨/揀貨/盤點，行動 App。
- **盤點**：有——Stock Counts 全方案。
- **庫存預留**：有——SO 開立自動 reserve（Qty Reserved / Available 分列）。[文件](https://www.inflowinventory.com/support/cloud/quantity-breakdown)
- **再訂購點**：有——建議再訂購點、低庫存警示、一鍵產生 PO。
- **採購**：有——PO、**採購審核＋核准金額上限**（高階方案）、掃描收貨、供應商預設值；RFQ 未確認。
- **銷售/出貨**：有——報價→SO→Pick-Pack-Ship、backorder、EasyPost 52 承運商比價出標籤。
- **退貨**：部分——銷退明確；採購退貨未確認。
- **報表**：有——自訂儀表板、44+ 報表、COGS。
- **財務**：部分——無內建總帳，靠 QuickBooks Online / Xero。
- **CRM/行銷**：部分——客戶資料＋B2B Showroom 入口，無行銷自動化。
- **電商整合**：有——Shopify、Amazon、WooCommerce 原生＋Extensiv 34+ 來源；Shopee 未確認。
- **API/自動化**：部分——API 加購（$49/月）＋Zapier；webhook 未確認。

> 定位：主打易上手＋條碼作業的中小企業庫存軟體，深度功能多靠加購。

#### Cin7 Core（原 DEAR Systems）

- **商品管理**：有——**Product Families 變體矩陣**（採購/銷售 Matrix 檢視逐變體填量）、條碼、AI 商品描述。[Product Families](https://help.core.cin7.com/hc/en-us/articles/9034519955855-Product-families)
- **多倉庫**：有——全方案無限 locations、內建 WMS。
- **批號/序號/效期**：有——從採購/製造追到銷售，含效期，WMS 掃描支援。[文件](https://help.core.cin7.com/hc/en-us/articles/9034605081231-Working-with-batch-and-serial-numbers)
- **條碼掃描**：有——全方案，收貨可掃條碼/SKU/批序號。
- **盤點**：有——Stocktake。
- **庫存預留**：部分——授權流程有，allocation 細節未確認。
- **再訂購點/自動補貨**：有——Automated Reorder Points＋ForesightAI 需求預測（加購）。
- **採購**：有——PO→收貨→發票；**Order Approval 審核**（設定啟用後 PO 需 Approve/Reject）。[文件](https://help.core.cin7.com/hc/en-us/articles/9034492644879-Process-a-Purchase)；供應商價格表、RFQ 未確認。
- **銷售/出貨**：有——Quotes/Orders、WMS 揀包出、POS（加購）、B2B Portal（加購）、EDI/3PL。
- **退貨**：有——銷退 Credit Notes/RMA＋**採購退貨 Supplier Credit Notes & Returns（Unstock 扣庫）**。
- **報表**：有——進階報表、COGS（FIFO/FEFO 成本法）。
- **財務**：部分——COGS/多幣別/發票內建，總帳靠 QuickBooks/Xero 深度同步。
- **CRM/行銷**：部分——**內建 CRM 模組**（Leads/Opportunities），無行銷自動化/點數。
- **電商整合**：有——官方稱 700+ 整合（Shopify、Amazon、WooCommerce…）；Shopee 未確認。
- **API/自動化**：有（多為加購）——API access、Flex API、Advanced Automations。

> 定位：功能最重的中小企業輕量 ERP（批序號、WMS、製造、CRM 一應俱全），適合當功能上限 benchmark；代價是複雜度與加購定價。
### 2.3 台灣本土進銷存（查證日 2026-07-07；台灣廠商公開資料較粗，「公開資料不足」照實標註）

#### 鼎新 A1 商務應用雲（雲端進銷存）

- **商品管理**：有——Excel 匯入、多規格管理（款式/尺寸）、出貨條碼檢查。[產品頁](https://a1.digiwin.com/product/a1Pro.php)
- **庫存**：多倉庫/調撥有；批號管理與效期追蹤有（加值模組）；條碼/手機盤點有；安全庫存不足自動提醒有；自動補貨部分（「訂貨幫手」＋訂單缺量轉採購，非 MRP）。
- **採購**：採購單、進貨單、「採購未進明細表」有；通用簽核流程無公開說明；詢報價公開資料不足。
- **銷售/出貨**：有——報價單→訂單→銷貨單完整單據鏈、「訂單未出明細表」。
- **退貨**：有——進貨退出、銷貨退回為標準單據。
- **報表**：有——40+ 張進銷存/財務報表＋經營儀表板。
- **財務**：有——雲端會計、單據自動拋轉傳票、應收應付、**台灣電子發票＋營業稅申報**。[計費頁](https://a1.digiwin.com/product/price.php)
- **CRM/行銷**：有——「掌客雲」CRM＋簡訊行銷。
- **電商整合**：有——**蝦皮、SHOPLINE、91APP、CyberBiz 訂單自動更新、賣場庫存自動同步、抽成/運費對帳**、momo API。[電商訂單頁](https://a1.digiwin.com/product/a1Pro_ec.php)
- **API**：部分——電商串接是賣點，但無公開的通用開放 API。

> 定位：中小電商賣家導向的 SaaS 進銷存，強項是電商多平台訂單整合與低月租門檻。

#### 正航資訊（正航一號／正航 ERP）

- **商品管理**：有——客戶別 6 段價格（大盤/中盤/會員等級）；條碼建檔公開資料不足。
- **庫存**：批號/效期有（[庫存管理頁](https://www.chi.com.tw/inventory)）；分批盤點有；存量不足出貨管制/警告有；多倉庫與條碼掃描公開資料不足；MRP 供需計算限 ERP 版。
- **採購**：訂購/採購/進銷退/轉單有；簽核靠 BPM 產品線（另購）；收貨驗收、詢報價公開資料不足。
- **銷售/出貨**：有——訂購、銷貨、出貨管制、毛利即時查詢；報價單未見（正航一號）。
- **退貨**：有——「銷進退」標準交易。
- **報表**：有——多維交叉分析（明細/排行/月統計/圖表）；儀表板屬 BI 加購。
- **財務**：有——進銷存＋帳務 2 合 1、自動傳票、**電子發票 Turnkey 模組**。[發票頁](https://www.chi.com.tw/ticket)
- **CRM**：有——獨立 CRM 模組（報備/維修等），無會員點數/行銷自動化。
- **電商整合**：部分——「網路訂單模組」可串平台但未明列支援清單。
- **API**：公開資料不足。

> 定位：老牌套裝軟體廠，強項是財會整合與電子發票輔導，電商與 API 開放度是弱項。

#### 凌越資訊（進銷存／WebERP）

- **商品管理**：有——分色分碼、多階編碼、變動單位換算、條碼 QR code 列印。[WebERP 頁](https://www.lyserp.com/New_Ly/product_wes_01.html)
- **庫存**：多公司/多幣別/**多倉庫**有；**批號先進先出＋生產履歷溯源（含效期、食安追溯）**有；盤點機＋ABC 分級盤點有；看板燈號警示庫存/交期異常有；自動補貨僅「適時適量」描述、部分。
- **採購**：請購→採購→進貨→驗貨完整流程；**Flow 線上簽核（採購/報價/訂單，支援 APP 行動簽核）**——三家中最完整；**IQC/FQC/OQC 品管驗收**；詢價請採購機制有。
- **銷售/出貨**：有——報價、訂單（含訂金/變更單）、銷貨、託售寄售、多角貿易轉單。
- **退貨**：部分——電子發票支援銷退折讓，單據面公開描述粗略。
- **報表**：有——Drill Down 層層追蹤、集團合併報表。
- **財務**：有——財會/票據整合、**電子發票 ERP 排程直傳財政部大平台**（免加值中心月費）。[發票頁](https://www.lyserp.com/New_Ly/product_inv_01.html)
- **CRM/行銷**：部分——業務管理＋維修客服，無會員經營/行銷自動化。
- **電商整合**：部分——「網路交易轉入進銷存」但未明列平台。
- **API**：公開資料不足。

> 定位：功能密度最高的傳統中小企業 ERP，強項是簽核、品管驗收、批號履歷、電子發票直傳；弱項是電商整合透明度與 API 開放性。

**本類共同觀察**：三家皆無公開開發者 API 文件；台灣本土系統的共同強項是**電子發票合規**（我方全無）。
### 2.4 電商賣家工具（查證日 2026-07-07；與我方系統「1688 進貨、蝦皮銷售」情境最接近的一類）

#### BigSeller（東南亞電商 ERP，Shopee 官方認證合作夥伴）

- **商品管理**：有——商品採集、跨店一鍵刊登、SKU 統一管理（批次改成本/貨位/印標籤）。[官網](https://www.bigseller.com/)
- **庫存**：有（完整）——多倉＋WMS、貨位管理、批次效期預警；**全平台庫存共享、變動自動推送防超賣**；警戒庫存三模式（固定/比例/依預測日銷量動態），低於警戒推 App 通知；**活動預留庫存**功能。[倉庫頁](https://www.bigseller.com/zh_CN/omnichannel/inventory.htm)、[預留庫存](https://help.bigseller.com/zh_CN/detailPage/4/1/2710/content)
- **採購（1688 深度整合）**：有——**站內直接建 1688 採購單、1688 尋源比價、供應商自動建檔**；**採購建議依銷量/庫存自動算採購量、一鍵生成採購單**。[1688 採購單](https://help.bigseller.com/zh_CN/detailPage/11/1/4178/content)、[採購建議](https://help.bigseller.com/zh_CN/detailPage/11/1/4117/content)
- **訂單/出貨**：有——多平台訂單彙整、面單模板、掃描出貨、異常攔截、物流監控與運費核對。
- **退貨**：有——分角色售後單處理＋退貨入庫，庫存資金雙閉環。
- **報表（利潤試算）**：有——**平台明細成本（促銷、佣金、稅費）由 API 自動歸集並分攤至商品**；銷售下鑽分析、實時大屏；訂單層利潤預估。[數據頁](https://www.bigseller.com/zh_CN/omnichannel/data.htm)
- **財務**：有——平台打款差異自動監控預警（撥款對帳）。
- **CRM/行銷**：部分——賣場營銷工具（自動置頂、定時上架、評價自動回覆），非會員 CRM。
- **平台整合**：有——Shopee、Lazada、TikTok Shop、Shopify 等 20+ 平台、600+ 物流商。
- **API**：部分——站內自動化規則豐富；公開 API 文件未確認。

> 定位：蝦皮/東南亞賣家的免費入門全流程 ERP，「刊登＋訂單＋倉儲＋1688 採購＋利潤核算」一條龍。

#### 店小秘（DianXiaoMi，跨境電商 ERP）

- **商品管理**：有——採集、店鋪搬家、70+ 平台批次刊登、AI 描述、一鍵翻譯。[官網](https://www.dianxiaomi.com/)
- **庫存**：有——自建倉＋130+ 海外倉、庫位管理；**庫存自動扣減、實時推送至平台店鋪**；四種在線盤點（按時間/全倉/貨位/SKU）；最小備貨量→備貨建議。[倉庫使用](https://help.dianxiaomi.com/article/inventoryManagement/382)
- **採購（1688 閉環）**：有——1688 直接採購、批量生成採購單、換供應商、印採購單；智能採購建議。
- **訂單/出貨**：有——70+ 平台訂單、波次揀貨、掃描發貨、1700+ 物流商自動取號、軌跡追蹤。
- **退貨**：部分/未確認——有售後客服流程，獨立退貨入庫模組未見公開說明。
- **報表（利潤試算）**：有（最透明）——利潤三大塊：訂單手續費＋物流費＋採購成本；**Shopee 等平台手續費支援 API 自動獲取**；定價模板內建「平台佣金＋提現/活動手續費＋折損率＋運費」公式。[利潤核算 FAQ](https://help.dianxiaomi.com/article/financialManagement/468)
- **財務**：有——多平台財務統計與利潤核算；撥款逐筆對帳深度未確認。
- **CRM/行銷**：部分——智能客服、客戶管理；無會員點數/行銷。
- **平台整合**：有（最廣）——60~70+ 平台（Shopee、Amazon、Temu、SHEIN、Coupang…）。
- **API**：部分——站內自動化完整、Shopify 官方外掛；公開 API 未確認。

> 定位：跨境賣家市占最大的免費 ERP，「平台覆蓋＋1688 採購閉環＋含佣金的利潤公式」與我方情境重疊度最高。

#### ECFIT（台灣，電商後勤 WMS/OMS/CRM SaaS）

- **商品管理**：有——批次匯入匯出、條碼、組合商品（掃組合條碼自動拆單）；不做刊登/採集。
- **庫存**：部分——即時庫存、儲位提醒、出入庫任務；多平台庫存回寫、盤點單、安全庫存皆未確認。
- **採購**：部分——進貨嘜頭、掃描清點收貨、預交日管理；1688 整合無。
- **訂單/出貨（核心強項）**：有——電商平台＋官網＋POS 訂單 3 秒整合、批次分區理貨、電腦輔助揀貨、出貨覆核、多物流面單一次列印、物流狀態回寫。[官網](https://ecfit-saas.com/)
- **退貨**：有——訂單/出貨/退換貨同系統。
- **報表**：部分——理貨報告、進出貨異常監控；利潤試算未確認。
- **財務**：部分（發票強項）——**財政部核可電子發票加值中心**：開立/作廢/折讓＋報稅。[電子發票](https://www.ecfit-saas.com/e-invoice/)
- **CRM/行銷**：有——ECFIT CRM：簡訊、Email、LINE 官方帳號串接。
- **平台整合**：部分——宣稱整合電商平台/官網/POS 訂單（API 匯入），蝦皮直連未確認。

> 定位：台灣「電商後勤」SaaS——訂單整合、倉儲出貨、電子發票、CRM 是強項；不做刊登、採購端與利潤試算。與我方系統互補而非同類全覆蓋。

**本類關鍵觀察**：我方的「蝦皮 16% 固定抽成毛利試算」市面標竿已進化到**由平台 API 抓實際逐單費用自動歸集**；「1688 供應商欄位」的標竿是**1688 下單閉環＋供應商自動建檔＋依銷量補貨建議**。

## 3. 功能矩陣總表

圖例：✅ 完整　🔶 部分/受限　❌ 無　❓ 公開資料不足/未確認
欄位縮寫：我＝我方系統、Od＝Odoo、EN＝ERPNext、IT＝InvenTree、Zo＝Zoho Inventory、iF＝inFlow、C7＝Cin7 Core、鼎＝鼎新 A1、正＝正航、凌＝凌越、BS＝BigSeller、店＝店小秘、EC＝ECFIT

| 功能 | 我 | Od | EN | IT | Zo | iF | C7 | 鼎 | 正 | 凌 | BS | 店 | EC |
| :--- |:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 商品變體/款式 | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | 🔶 |
| 條碼掃描作業 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | ✅ |
| 多倉庫/儲位 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ✅ | ✅ | ✅ | 🔶 |
| 批號/序號/效期 | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ❓ |
| 盤點 | ✅ | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 | ✅ | ❓ |
| 庫存預留/防超賣 | ❌ | ✅ | ✅ | 🔶 | 🔶 | ✅ | 🔶 | ❓ | ❓ | ❓ | ✅ | ❓ | ❓ |
| 安全庫存警示 | ✅ | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ |
| 補貨建議/再訂購點 | 🔶 | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | 🔶 | 🔶 | 🔶 | ✅ | ✅ | ❓ |
| 多平台庫存同步 | ❌ | ✅ | 🔶 | ❌ | ✅ | 🔶 | ✅ | ✅ | ❓ | ❓ | ✅ | ✅ | ❓ |
| 採購單流程 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 |
| 採購審核流程 | ❌ | 🔶 | ✅ | ❓ | ✅ | ✅ | ✅ | 🔶 | 🔶 | ✅ | ❓ | ❓ | ❓ |
| 收貨驗收 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 | ❓ | ✅ | ✅ | ✅ | ✅ |
| 詢報價 RFQ | ❌ | ✅ | ✅ | ❌ | ❓ | ❓ | ❓ | ❓ | ❓ | ✅ | 🔶 | ❓ | ❌ |
| 供應商價格表 | ❌ | ✅ | ✅ | ✅ | ✅ | 🔶 | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | ❌ |
| 銷售出貨 | ✅ | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | ✅ | 🔶 | ✅ | ✅ | ✅ | ✅ |
| 退貨（銷退/進退） | 🔶 | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ |
| 報表/儀表板 | 🔶 | ✅ | 🔶 | 🔶 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 |
| 財務總帳/應收應付 | 🔶 | ✅ | ✅ | ❌ | 🔶 | 🔶 | 🔶 | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 |
| 台灣電子發票 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ |
| CRM/會員經營 | ✅ | ✅ | ✅ | ❌ | 🔶 | 🔶 | ✅ | ✅ | ✅ | 🔶 | ❌ | 🔶 | ✅ |
| 行銷自動化 | ✅ | ✅ | 🔶 | ❌ | 🔶 | ❌ | ❌ | 🔶 | ❌ | ❌ | 🔶 | ❌ | ✅ |
| 點數/忠誠度 | ✅ | ✅ | ✅ | ❌ | 🔶 | ❌ | ❌ | ❓ | ❌ | ❌ | ❌ | ❌ | ❓ |
| 電商平台整合 | ❌ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | 🔶 | 🔶 | ✅ | ✅ | 🔶 |
| 利潤/平台費用試算 | 🔶 | 🔶 | 🔶 | ❌ | 🔶 | 🔶 | 🔶 | ✅ | 🔶 | ❓ | ✅ | ✅ | ❓ |
| 1688 採購整合 | 🔶 | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| 開放 API/自動化 | 🔶 | ✅ | ✅ | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❓ | ❓ | ❓ | 🔶 | 🔶 |

我方欄位的幾個註記：「補貨建議 🔶」＝通知頁有建議補貨量計算但不能一鍵轉採購單；「退貨 🔶」＝銷退完整、進退僅靠刪除已收貨 PO 回沖，無正式單據；「利潤試算 🔶」＝內建固定 16% 蝦皮抽成公式，非平台實際費用；「1688 🔶」＝供應商有 1688/淘寶分類與 RMB 成本欄位，但無下單閉環；「API 🔶」＝本身是 REST API 架構但無 webhook/對外開放設計。

## 4. 缺口分析與優先度建議

判斷基準：這套系統的實際場景是「1688 進貨、蝦皮銷售的小型賣家＋自營會員商城」，不是多人企業。優先度以「多數系統都有＋對此場景有實效＋實作成本」三者綜合。

### 高優先

| # | 缺口 | 它解決什麼 | 建議理由 |
| :- | :--- | :--- | :--- |
| 1 | **銷售庫存預留／防超賣** | 訂單成立就佔用庫存（committed stock），可用量＝實際量－已承諾量，避免同貨兩賣 | 12 套裡至少 6 套有；電商賣家最痛的就是超賣。實作小：SO 建立時累計承諾量＋前端顯示可用量即可，不必動 InventoryLog |
| 2 | **補貨建議→一鍵轉採購單** | 依銷量與 `lead_time_days` 算建議採購量，直接生成採購單草稿 | 幾乎所有系統都有（BigSeller/店小秘的「依銷量採購建議」是同場景標竿）。我方已有 safety_stock、lead_time_days、建議補貨量顯示，只差最後一步 |
| 3 | **採購單狀態機驗證** | 禁止非法狀態跳轉（received 不可退回 draft 等）、記錄誰在何時轉移 | 目前 status 可任意 PATCH 是資料完整性風險（`main.py:739`）。多層「人的簽核」在單人場景價值低，但「機器的狀態機」是正確性問題，成本一天內 |

### 中優先

| # | 缺口 | 說明 |
| :- | :--- | :--- |
| 4 | **條碼掃描作業** | 已有 barcode 欄位，補「掃碼查商品/收貨/盤點」端點＋手機網頁掃碼，收貨與盤點效率倍增 |
| 5 | **利潤試算升級：平台費用實抓** | 固定 16% → 蝦皮開放平台 API 逐單費用歸集（BigSeller/店小秘已是標配）。依賴蝦皮 API 申請 |
| 6 | **多平台庫存同步** | 與 #5 同一條蝦皮 API 依賴鏈，先做訂單/庫存單向同步即可 |
| 7 | **進貨退出單據化** | 現在退供應商貨只能刪 PO 回沖；補正式採購退貨單（可複用 ReturnOrder 模式） |
| 8 | **台灣電子發票** | 若有開立發票義務就升到高優先；台灣三家全有、國際系統全無，需接加值中心或大平台 |

### 低優先（場景不符或投資報酬低）

- **多倉庫/儲位**：單倉營運用不到；接第三方倉時再做。
- **批號/序號/效期**：視商品品類，一般雜貨不需要；賣食品/美妝才升級。
- **RFQ 詢報價、供應商價格表**：供應商集中在 1688 時，比價在 1688 站內完成即可。
- **複式記帳/應收應付/多幣別總帳**：現有簡易收支＋外部記帳軟體可頂；要做不如接會計軟體。
- **BOM/製造、EDI/3PL、WMS 波次揀貨**：非此場景。

## 5. 我方獨有或領先的差異化功能

拿 12 套系統對照後，這些是**多數比較對象沒有**的：

1. **會員行銷生態系**（等級/點數、受眾分群、campaign 開信/點擊追蹤、生日/註冊自動化觸發、DM WebSocket 即時推播、站內信、點數商店）——通用進銷存幾乎都沒有這一整套；Odoo 要企業版拼多個模組，電商工具的「行銷」是賣場操作工具而非會員經營。這是本系統最大的差異化資產。
2. **收貨照片/影片憑證**（POItem.receiving_image/video）——12 套公開文件皆未見同款功能；對跨境進貨糾紛舉證特別實用。
3. **採購單內建蝦皮毛利試算**（訂貨金額/集運費/關稅/16% 抽成/毛利率即時算）——通用 ERP 只有事後毛利報表；只有 BigSeller/店小秘同級，且它們不做會員商城。
4. **1688/淘寶導向的 RMB 成本結構**（匯率、集運、關稅欄位化）——國際與台灣系統全無。
5. **NAS 檔案管理＋到期分享連結**——ERP 通常只有單據附件，沒有獨立檔案總管與對外分享。

**一句話總結**：這套系統在「跨境進貨成本試算＋會員行銷」上超出同級公開系統，欠的是庫存正確性機制（預留、狀態機）與自動化最後一哩（補貨轉單、掃碼、平台 API）。
