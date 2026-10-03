# LINE 綁定帳號操作框架 + LIFF 填寫進貨單（實作計畫）

> 狀態：**後端（Phase 0）與前端 LIFF 頁面程式碼（Phase 1 的程式部分）已實作完成**；**唯一剩下的是使用者需在 LINE Developers Console 註冊 LIFF App 取得真實 LIFF ID**，填入 `.env`（`LIFF_ID`）與前端 `.env`（`VITE_LIFF_ID`）後才能端對端運作與驗證。沒有 LIFF ID 之前，`/liff` 與 `/liff/purchase-orders/new` 頁面會顯示「此功能尚未完成設定」，不會壞掉或白屏。詳見文末「實作順序」。

## Context

在此之前，系統的 LINE 整合（見 [`docs/line-integration-plan.md`](./line-integration-plan.md)）只有「OAuth 綁定」與「單向 push 通知」：員工把自己的帳號綁定 LINE（`UserLineBinding`），系統在進貨/銷貨單狀態變更時推播通知。**完全沒有接收使用者訊息的能力**——沒有 Messaging Webhook、沒有簽章驗證、沒有指令/選單、沒有 LIFF。

這次要反過來：讓 LINE 使用者可以**主動在 LINE 裡操作系統**，第一個支援的操作是「填寫進貨單」，且明確要求：
1. 用 **LIFF 表單**（LINE 內嵌網頁）作為互動介面，不是純文字指令或 Quick Reply 對話。
2. 順便建立一個**可擴充的操作框架**——之後還會加其他操作（出貨、盤點等），加新操作不該要重新設計選單/權限機制。
3. LIFF 端建立進貨單要「**完整版：比照網頁後台流程**」——含 SKU 自動產生、CNY→TWD 成本試算、`ensure_product`（新建/更新商品）。

權限模型沿用現有機制：LINE 使用者看得到/能做什麼操作，完全由「該 LINE 帳號綁定的系統帳號的 `User.permissions`」決定，不另外設計一套新的權限系統。

## 現況確認（已核實的關鍵事實）

- `UserLineBinding`（`backend/models.py:52-56`）：`user_id`(PK/FK)、`line_user_id`(unique)。原本只支援「user_id → line_user_id」查詢方向；反向查詢（line_user_id → User）是本次新寫的 `get_user_by_line_id()`。
- `backend/auth.py` 原本的 `require_permissions()` 把「是否有權限」的判斷邏輯耦合在 FastAPI dependency 裡，本次抽出 `has_any_permission(user, required)` 供沒有 `Depends()` 情境的 webhook/LIFF 重用。
- `frontend/src/pages/SystemSettings.tsx:20` 已定義 `manage_purchase_orders` 權限字串且有現成 UI 可勾選，本次直接重用，不新增權限概念。
- `POST /products/ensure`、`GET /products/`、`GET /categories/`、`GET /suppliers/`、`GET /attributes/`、SKU 產生端點原本就沒有掛任何登入驗證，LIFF 頁面之後可以直接沿用 `frontend/src/api.ts` 對應函式，不用另建包裝端點。
- `POST /purchase_orders/`（`create_po`）原本的商業邏輯（建單→逐項驗證商品/SKU→若 `status=="received"` 才加庫存+寫 `InventoryLog`→若 received 則查 `UserLineBinding` 推播）全部寫在 route function 內，本次抽成 `backend/purchase_orders_service.py::create_purchase_order()`，REST 與 LIFF 端共用同一份邏輯。
- `backend/config.py` 已有 `LINE_CHANNEL_SECRET`、`LINE_MESSAGING_ACCESS_TOKEN`、`LINE_SUPPRESS_SEND`；本次啟用 `LINE_CHANNEL_SECRET` 做 webhook 簽章驗證（先前完全沒被用到）。**注意**：這個 repo 的 `.env` 目前已經填了真實的 Messaging API 憑證且 `LINE_SUPPRESS_SEND=false`（正式運作中），因此所有新測試都必須用 `monkeypatch` 強制在測試期間把 `LINE_SUPPRESS_SEND` 設回 `True`，避免測試意外對外發出真實請求。
- 前端 `/member/*` 已有現成的「非系統 JWT 的公開子區」先例（`MemberTheme` + `memberApi.ts`），LIFF 頁面之後直接比照這個模式，不另起專案。
- 系統另有 `/receiving`（收貨）頁面，對應「進貨單狀態轉 received」的操作，本次規劃**不在 LIFF 端開放**——LIFF 建單只允許 `draft`/`completed`。

## 核心設計決策

| 決策點 | 選擇 | 理由 |
|---|---|---|
| 選單呈現方式 | Flex Message（webhook 收到訊息/追蹤事件時回覆），不用 Rich Menu | Rich Menu 全帳號共用一張圖，無法即時反映權限變更；Flex Message 由後端即時組 JSON，天然支援依 `user.permissions` 動態產生按鈕。 |
| LIFF 頁面位置 | 併入現有 frontend SPA 的新路由（`/liff/*`），不另開專案 | 比照 `/member/*` 既有模式；可直接重用 `poCalculations.ts` 與既有唯讀 API 函式。 |
| 可擴充框架核心 | `backend/line_actions.py` 的 registry | Flex 選單、LIFF App 首頁「操作列表」吃同一份 registry + 同一個權限過濾函式；新增操作＝註冊一筆。 |
| LINE 端權限字串 | 重用既有 `manage_purchase_orders` | 已有現成管理 UI；讓「桌面能做的事」與「LINE 能做的事」權限邊界一致。 |
| 既有 `POST /purchase_orders/` 要不要補權限檢查 | 本次不做，另立任務 | 會立刻改變現有桌面端行為，需要先盤點帳號權限資料才能安全上線。 |
| LIFF ID Token 驗證方式 | 呼叫 LINE 官方 `/oauth2/v2.1/verify`，不自行做 JWKS 驗簽 | 延續本 repo 一貫作法（`exchange_code_for_token`/`get_line_profile` 都是直接打 LINE REST API）。 |

## 實作方案（後端，已完成）

1. **`backend/purchase_orders_service.py`（新檔）**：`create_purchase_order(session, po_in, purchaser_name)` 純函式，`backend/main.py` 的 `create_po` 改成薄包裝呼叫它，行為完全等價（LINE 推播邏輯留在 `main.py`，因推播對象因呼叫端而異）。
2. **`backend/auth.py`**：抽出 `has_any_permission(user, required)`，`require_permissions()` 改呼叫它，純重構不改變行為。
3. **`backend/line_utils.py`** 新增：`get_user_by_line_id()`（反查綁定）、`verify_liff_id_token()`（呼叫 LINE `/oauth2/v2.1/verify`）、`reply_line_message()`（比照 `push_line_message_sync` 的永不拋例外＋`LINE_SUPPRESS_SEND` 設計）、`build_action_menu_flex()`（依 action 列表組 Flex Message）。
4. **`backend/line_actions.py`（新檔）**：`LineAction` dataclass、`LINE_ACTIONS` registry、`register_action()`、`list_available_actions(user)`。目前註冊了一筆 `create_po`（`required_permissions=["manage_purchase_orders"]`，`liff_path="/purchase-orders/new"`）。
5. **`backend/line_webhook_router.py`（新檔）**：`POST /line/webhook`，用原始 bytes 算 `X-Line-Signature`（HMAC-SHA256 + `LINE_CHANNEL_SECRET`），驗證失敗回 403；逐一事件處理（包 try/except，永遠回 200 避免 LINE 判定失敗重送）；`message`(命中選單關鍵字) 與 `follow` 事件會反查綁定使用者、依權限組 Flex 選單並回覆。
6. **`backend/liff_auth.py`（新檔）**：`get_current_line_user` dependency，從 `Authorization: Bearer <liff_id_token>` 驗證身分（檢查 `aud`、反查綁定、檢查 `is_active`），取代系統 JWT。
7. **`backend/liff_router.py`（新檔）**：`GET /liff/me`、`GET /liff/actions`（驅動 LIFF 首頁選單）、`POST /liff/purchase-orders`（驗證權限、拒絕 `status="received"`、呼叫 `create_purchase_order()`）。
8. **`backend/config.py`**：新增 `LIFF_ID`、`LIFF_CHANNEL_ID`（預設空字串，未設定不影響其他既有功能）。
9. **`backend/main.py`**：掛載 `line_webhook_router`、`liff_router`。
10. **測試**（`backend/tests/`）：
    - `test_purchase_orders_service.py`：純函式測試，draft 不動庫存、received 正確寫 `InventoryLog`、無效商品 ID 拋 `ValueError` 且整單 rollback。
    - `test_line_webhook.py`：簽章驗證（合法/非法）、未綁定使用者收到綁定提示、已綁定使用者依權限收到不同選單內容。
    - `test_liff_purchase_orders.py`：缺憑證/憑證無效/未綁定/無權限的各種 401/403、`status="received"` 被拒 400、成功建立 draft 單且不動庫存。
    - 所有測試用 `monkeypatch` 強制 `LINE_SUPPRESS_SEND=True` 與偽造 `verify_liff_id_token`，不會對外發出真實請求。

## 實作方案（前端，程式碼已完成，待真實 LIFF ID 才能端對端運作）

比照 `/member/*` 既有模式（`MemberTheme` + `memberApi.ts` + 獨立 Context），新增一組平行的 LIFF 子區：

1. **`frontend/src/liffApi.ts`（新檔）**：獨立 axios instance，`baseURL` 讀 `import.meta.env.VITE_API_BASE_URL`（不沿用 `api.ts`/`memberApi.ts` 硬編碼的 `localhost:8000`，因為 LIFF 頁面在使用者手機的 LINE App 內開啟，打不到 localhost）。Request interceptor 透過 `registerLiffIdTokenGetter()` 註冊的 getter 函式即時取得 `liff.getIDToken()`（不快取，因為 LIFF SDK 自己會處理 token 更新）。同時包了 `getCategories`/`getProducts`/`getSuppliers`/`getAttributes`/`generateSku`/`ensureProduct`/`ensureAttributeOption` 這些沿用既有無驗證後端端點的唯讀函式，刻意不 import `api.ts` 裡的版本，避免共用到它「401 時導向桌面版 `/login`」的攔截器邏輯（那會把 LIFF webview 導去一個使用者打不開的頁面）。
2. **`frontend/src/contexts/LiffContext.tsx`（新檔）**：`LiffProvider` 在 `useEffect` 呼叫 `liff.init({liffId})`；`VITE_LIFF_ID` 未設定時直接顯示錯誤狀態、不呼叫 `liff.init()`（優雅降級，不會白屏或丟未捕捉例外）；已登入 LINE 則呼叫 `liff.getProfile()` 顯示顯示名稱，並把 `liff.getIDToken` 註冊進 `liffApi.ts`。
3. **`frontend/src/components/LiffTheme.tsx`（新檔）**：簡化版 layout（LINE 品牌綠、限制最大寬度 480px、加大觸控尺寸），比照 `MemberTheme.tsx` 的建法但視覺區隔開來。
4. **`frontend/src/pages/liff/LiffHome.tsx`（新檔）**：呼叫 `GET /liff/actions`，卡片列出目前使用者可操作的項目（目前只有「填寫進貨單」一項，因為 registry 只註冊了這一筆）。
5. **`frontend/src/pages/liff/LiffPurchaseOrderForm.tsx`（新檔）**：手機單頁式表單，比照 `PurchaseOrderList.tsx` 的 `handleOk` 邏輯：多商品群組（`Form.List`）×多款式（巢狀 `Form.List`）→ 進貨單建立時自動呼叫 `generateSku()`（新增群組/款式時）→ 即時用 `calculatePurchaseOrder()`（**原封重用**，不重寫公式）試算成本 → 送出時逐一 `ensureProduct()` 取得 `product_id` → 組 `items` 呼叫 `createLiffPurchaseOrder()`（`POST /liff/purchase-orders`）。刻意**不**搬過來的桌面版功能：圖片上傳（`Upload` 依賴桌面版硬編碼的 `localhost:8000/upload/`，本身就是既有技術債，行動裝置流程不需要）、批次屬性套用、Excel 匯出、編輯/查看既有單據（LIFF 入口本來就設計成「新建」單一用途，對應 `liff_path="/purchase-orders/new"`）。
6. **`frontend/src/App.tsx`**：新增路由 `/liff`（`LiffHome`）與 `/liff/purchase-orders/new`（`LiffPurchaseOrderForm`），各自包 `<LiffTheme><LiffProvider>...</LiffProvider></LiffTheme>`，和 `/member/*` 路由同一層級（在 `UserProvider`/`MemberProvider` 之內、`AppLayout` 的 token 檢查之外）。
7. **`frontend/package.json`**：新增 `@line/liff` 依賴（`npm install @line/liff`，已執行）。
8. **`frontend/.env.example`（新檔）**：`VITE_API_BASE_URL`、`VITE_LIFF_ID` 欄位說明。

### 已知風險與注意事項

1. **多個測試檔共用 `app.dependency_overrides[get_session]`**：這個 repo 沒有 `conftest.py`，既有測試（`test_points_store.py` 等）在模組層級直接賦值 `app.dependency_overrides[get_session]`，多檔案共用同一個 `app` 物件時，後 import 的檔案會覆蓋前面的設定。本次新增的 `test_line_webhook.py`/`test_liff_purchase_orders.py` 改在 `client` fixture 內「先存舊值、測試後還原」，避免污染其他測試檔；但這只是繞開既有脆弱點，沒有從根本修掉它（根本修法是加一個共用 `conftest.py`，不在本次範圍內）。
2. **`.env` 內是真實的 LINE Messaging API 憑證，`LINE_SUPPRESS_SEND=false`**：所有新測試都用 `monkeypatch` 強制關閉真實發送，開發時若手動用 `curl` 打本機 `/line/webhook` 也要注意這點，避免意外對外發送測試訊息。
3. **`POST /purchase_orders/`、`DELETE /purchase_orders/{po_id}` 現有權限缺口**：不在本次範圍內修正（見上方核心決策表）。
4. **`npm run build` 目前會在 `tsc -b` 這步失敗**，但失敗原因是兩個與本次改動無關、本來就存在的既有錯誤（`frontend/src/pages/MarketingHub.tsx:200` 的 antd `Orientation` 型別、`frontend/src/pages/member/MailSymbols.tsx:31` 找不到 `NodeJS` 命名空間），這兩個檔案本次完全沒有修改過。已改用 `npx vite build` 單獨驗證過打包本身沒有問題（4564 個模組全部轉譯成功，含本次新增的所有 LIFF 檔案），只是完整的 `npm run build` 指令鏈會被這兩個既有問題卡住，不是本次改動造成的。

## 實作順序

**已完成（不需要 LIFF ID 的部分）**：後端 service 重構 → auth 重構 → line_utils/line_actions → webhook → liff_auth/liff_router → config → 後端測試 → 前端 `liffApi.ts`/`LiffContext.tsx`/`LiffTheme.tsx`/`LiffHome.tsx`/`LiffPurchaseOrderForm.tsx`/路由 → `npm install @line/liff`。

**剩下待辦（需要使用者在 LINE Developers Console 完成前置設定後才能做）**：
1. 使用者提供 **LIFF ID**（在 LINE Login 或 Messaging API 所屬 Provider 下新建 LIFF App，Endpoint URL 需為公開 HTTPS，Scope 至少勾 `openid`）。
2. 填入後端 `.env` 的 `LIFF_ID`（與需要的話 `LIFF_CHANNEL_ID`）、前端 `.env` 的 `VITE_LIFF_ID`、`VITE_API_BASE_URL`。
3. 部署到公開 HTTPS（或開發期用 ngrok 打洞），在 Console 設定 Messaging API 的 Webhook URL 指向 `/line/webhook` 並開啟「Use webhook」。
4. 實機走一次完整流程：加好友 → 聊天室打「選單」→ 收到 Flex 選單 → 點「填寫進貨單」→ LIFF 表單完整跑一次「選商品→算成本→ensure_product→建單」→ 桌面後台確認 PO 與庫存正確。
5. 完成後補寫一份使用說明書（比照 [`docs/line-integration-guide.md`](./line-integration-guide.md) 的格式），涵蓋 LIFF App 申請步驟與員工端如何使用選單。

## 驗證方式

- **已完成**：
  - 後端：`cd D:/System_Of_Speeching && PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/ -q 2>&1 | tail -40` → 6 failed（既有基線，皆與本次改動無關）/ 15 passed（既有 2 + 本次新增 13）。app 啟動檢查確認新路由 `/line/webhook`、`/liff/me`、`/liff/actions`、`/liff/purchase-orders` 均已掛載。
  - 前端：`npx vitest run` → 3 test files / 8 tests 全數通過（與既有基線相同，本次未新增前端單元測試，因為 LIFF 頁面的核心邏輯——簽章驗證、權限反查、成本計算——都在後端與 `poCalculations.ts` 已涵蓋）。`npx vite build` → 4564 個模組全數轉譯成功（含所有新增 LIFF 檔案）；`npm run build` 完整指令鏈會卡在兩個既有、與本次改動無關的 `tsc` 錯誤（見上方風險 4），非本次引入。
  - 實跑：啟動本機 backend（:8000）與 frontend dev server，`curl` 確認 `/liff`、`/liff/purchase-orders/new` 兩個路由都能正常回應 200（SPA client-side routing 正確 fallback），dev server 編譯輸出無錯誤。
- **待驗證（需要真實 LIFF ID + 公開 HTTPS）**：實機 LINE App 端對端流程，見上方「剩下待辦」第 4 步。這是唯一無法在目前環境完成的驗證項目。
