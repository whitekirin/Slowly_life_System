# 將管理後台綁定 LINE：進貨/出貨事件個人推播通知（實作計畫）

> 狀態：**已實作完成**（2026-07-10）。使用說明書見 [`docs/line-integration-guide.md`](./line-integration-guide.md)。

## Context

目前系統的「通知」頁面（`frontend/src/pages/Notifications.tsx`）完全是前端輪詢 `/sales_orders/` 與 `/products/` 即時運算出來的，後端沒有 Notification 資料表，也沒有任何主動推播機制。使用者希望在**進貨、出貨**等庫存事件發生時，主動把通知推播到員工個人的 LINE，而不是被動等員工自己打開系統查看。

員工要能在系統內「綁定」自己的 LINE 帳號（走 LINE Login OAuth 拿到 `userId`），之後系統事件觸發時就用 LINE Messaging API 把訊息 push 給該員工。舊的 LINE Notify 服務已於 2025-03 被官方停用，因此只能走「LINE Login 取得 userId + Messaging API push」這條路，且這兩者是**兩個獨立的 LINE Channel**（LINE Login channel 與 Messaging API channel），需要掛在同一個 Provider 底下。

會員（Member）端已有 `line_id`（純文字未驗證）與 `social_provider`/`social_id`（通用但空）欄位，這次**只保留擴充接口，不實作**——本次新建的 `LineService`／推播函式設計上不綁死員工端，未來會員端要做時可以直接重用。

專案目前完全沒有 `.env`/`config.py`、沒有 httpx 之類的 HTTP client、`User` 表也沒有任何 OAuth 相關欄位，這些都要在這次一併補上骨架。

## 現況確認（已核實的關鍵事實）

- `backend/main.py:677` `create_po` 已有 `current_user: User = Depends(get_current_user)`；`main.py:738 update_po` 與 `main.py:947 update_so`、`main.py:869 create_so` **都沒有** `current_user` 參數，需要補上才能知道推播給誰。
- 進貨庫存異動與 `InventoryLog` 建立點：`create_po`（`main.py:713-726`，建單時 `status="received"` 立即入庫）、`update_po`（`main.py:774-788`，狀態轉為 `received` 時入庫）。這兩處是「進貨完成」的推播掛勾點。
- 出貨庫存異動：`update_so`（`main.py:947` 附近，狀態轉為 `shipped` 時扣庫存）是「出貨完成」的推播掛勾點。`create_so`（`main.py:869`）若建單時直接帶 `status="shipped"` 不會觸發推播——這是延續既有程式碼行為落差，非本次引入的新問題，計畫中要明確記錄，不在本次修復範圍內。
- `User` model（`backend/models.py:17-47`）的 `UserBase` 已有一個完全閒置、未被任何程式碼使用的 `settings: Optional[Dict] = Field(default={}, sa_type=JSON)` 欄位（全專案搜尋不到 `.settings` 存取）。
- `backend/database.py:12-13` 的 `create_db_and_tables()` 只做 `SQLModel.metadata.create_all(engine)`，**不會**幫既有 SQLite DB 補新欄位；專案沒有 Alembic，只有歷史遺留的一次性手動腳本。
- `backend/email_utils.py` 是現成的「第三方服務串接」範本：`os.getenv()` 讀設定、`SUPPRESS_SEND` 環境變數預設關閉真實發送、try/except 包裹 + 專屬 logger + Prometheus Counter（`prometheus_client` 缺裝時有 `DummyCounter` 降級）。新的 LINE 推播要抄這套 pattern。
- 專案沒有安裝 httpx/requests/aiohttp，也沒有啟用已列在 `pyproject.toml` 但從未使用的 `pydantic-settings`/`python-dotenv`。
- `backend/main.py:111-117` 是既有 router 掛載區（`nas_router`/`members_router`/`dms_router`/`mail_symbols_router`/`points_store_router`/`marketing_router`），新 router 比照掛載。
- 前端「個人設定」入口（`frontend/src/App.tsx:232,242`）指向 `/settings` 也就是 `frontend/src/pages/SystemSettings.tsx:445-463`，目前 3 個 Tab（一般設定/使用者管理/部門管理）。這頁同時身兼系統設定與個人設定入口，適合加第 4 個 Tab 給員工自助綁定 LINE。
- 前端員工端 API 走 `frontend/src/api.ts`（帶 `token`），與會員端 `frontend/src/memberApi.ts` 是平行系統，不可混用。

## 實作方案

### 1. Backend 骨架（設定與依賴）

- `pyproject.toml`：新增 `httpx` 依賴，之後 `uv sync`。
- 新增 `backend/config.py`：用 `pydantic_settings.BaseSettings` 讀 `.env`，欄位：`LINE_CHANNEL_ID`、`LINE_CHANNEL_SECRET`（LINE Login channel）、`LINE_LOGIN_CALLBACK_URL`（預設 `http://localhost:8000/line/callback`）、`LINE_MESSAGING_ACCESS_TOKEN`（Messaging API channel）、`LINE_SUPPRESS_SEND`（預設 `True`，開發模式不真的推播）、`FRONTEND_BASE_URL`。全部欄位給預設值，確保沒建 `.env` 時服務仍可正常啟動。
- 新增 `.env.example`（repo 根目錄），列出上述欄位；確認 `.gitignore` 已排除 `.env`，沒有的話補上。

### 2. Backend 資料模型

- `backend/models.py` 的 `UserBase`（17-27 行）沿用既有閒置的 `settings: Dict` JSON 欄位存放綁定資訊（`{"line_user_id": ..., "line_display_name": ..., "line_bound_at": ...}`），**不新增資料表欄位**，避免又要寫一次性 migration 腳本。`UserUpdate` 不加這三個 key，只能透過新 router 寫入，避免員工能透過一般 profile 更新 API 偽造綁定。
- 新增 `LineOAuthState(SQLModel, table=True)`：`state`(主鍵)、`user_id`(FK)、`created_at`、`used`。用來在 OAuth callback（無 JWT 的瀏覽器導向請求）安全地把「哪個員工發起了這次綁定」傳回來，不可把 user id 明碼放進 state 造成偽造綁定風險。落地在 SQLite（而非記憶體字典），未來若改多 worker 部署也不受影響。
- `POST /line/bind/start` 產生新 state 前，先清掉該員工先前未完成的舊 state 記錄，避免無限累積。

### 3. Backend 服務層

新增 `backend/line_utils.py`，抄 `email_utils.py` 的 pattern：
- `push_line_message_sync(line_user_id, text)`：同步呼叫 Messaging API push endpoint（因 `create_po`/`update_po`/`update_so` 是 sync def）。`line_user_id` 為 `None` 或 `LINE_SUPPRESS_SEND=True` 時只記 log、不真的呼叫外部 API。try/except 包裹，失敗不可影響原本業務邏輯（推播失敗絕不能讓進貨/出貨操作跟著失敗）。
- 兩個訊息組裝 helper：進貨完成、出貨完成的文字內容。
- 專屬 logger 寫 log 檔（比照 `email_delivery.log` 模式）+ Prometheus Counter（成功/失敗計數，沿用 `DummyCounter` 降級寫法）。

### 4. Backend OAuth router

新增 `backend/line_router.py`（`APIRouter`，比照 `backend/dms.py` 寫法）：

| Method | Path | 用途 | 認證 |
|---|---|---|---|
| POST | `/line/bind/start` | 目前登入員工發起綁定，產生 state，回傳 LINE 授權 URL | 員工 JWT |
| GET | `/line/callback` | LINE OAuth 回呼，用 code 換 token 取得 profile(userId)，寫回 `User.settings`，回一頁簡易 HTML 提示可關閉視窗 | 靠 state 表驗證 |
| GET | `/line/bind/status` | 回傳目前登入員工的綁定狀態 | 員工 JWT |
| DELETE | `/line/bind` | 解除目前登入員工的綁定 | 員工 JWT |

`backend/main.py:117` 之後加 `app.include_router(line_router)`；`update_po`（738 行）、`create_so`（869 行）、`update_so`（947 行）補上 `current_user: User = Depends(get_current_user)`。

### 5. 推播掛勾點

在以下三處、`session.commit()` 之後插入 `push_line_message_sync(current_user.line_user_id 對應值, ...)`：
- `create_po` 的 `status == "received"` 分支（`main.py:713-728` 附近）。
- `update_po` 的 `previous_status != "received" and db_po.status == "received"` 分支（`main.py:774-802` 附近）。
- `update_so` 的出貨狀態轉換分支。

`create_so` 若直接以 `shipped` 建單不觸發推播的既有行為落差，僅記錄在說明書「已知限制」，不在本次修復。

### 6. Frontend

- `frontend/src/api.ts` 新增 `startLineBind()` / `getLineBindStatus()` / `unbindLine()` 三個函式。
- `frontend/src/pages/SystemSettings.tsx:445-463` 新增第 4 個 TabPane「LINE 通知」，內容為新元件 `LineBindingSettings`：
  - 用 react-query 讀綁定狀態；未綁定顯示「綁定 LINE」按鈕，點擊後開彈出視窗導向授權 URL，並輪詢（有逾時上限，例如 5 分鐘）偵測綁定完成；已綁定顯示 `line_display_name`/`line_bound_at` 與「解除綁定」按鈕（`Popconfirm` 二次確認）。
  - 不需要拉全域 `UserContext`，因為所有 API 都以目前登入者的 JWT 自動綁定「自己」。

### 7. 會員端（僅記錄擴充點，不實作）

`Member.line_id`/`social_provider`/`social_id` 維持現狀不動。在說明書「未來擴充」章節記錄：未來要做時可重用同一個 LINE Login channel 設定與 `push_line_message_sync`，`LineOAuthState` 可加 `subject_type` 欄位或另建對應表來區分員工/會員兩種綁定主體。

## 已知風險與限制（需寫入說明書）

1. `create_so` 直接以 `shipped` 建單不會觸發推播——既有行為落差，非本次新增問題。
2. `SECRET_KEY` 明碼寫死於 `backend/auth.py:13` 是既有問題，與本次無直接關聯，排除在改動範圍外，但在說明書「疑難排解」提及避免使用者誤以為新金鑰也會被這樣處理。
3. `push_line_message_sync` 用同步 httpx client 會佔用 thread pool 的一個 thread（單次呼叫約 200ms-1s），以內部員工系統的流量規模可接受；未來量大可再改 `BackgroundTasks`。
4. 沒建 `.env` 時 `LINE_SUPPRESS_SEND` 預設為 `True`，系統其他功能完全不受影響，只是推播會全部走 mock log 分支。

## 實作順序

1. `pyproject.toml` 加 httpx → `uv sync`。
2. `backend/config.py` + `.env.example`。
3. `backend/models.py` 加 `LineOAuthState` 表（`create_db_and_tables()` 會自動建新表，不需要 migration；`User.settings` 沿用既有欄位不需要 schema 變更）。
4. `backend/line_utils.py`（先在 suppressed 模式下開發，不需要真的 LINE channel）。
5. `backend/line_router.py` + `main.py` 掛載 + 補 `current_user` 到 `update_po`/`create_so`/`update_so`。
6. 三個推播掛勾點串接。
7. 後端手動驗證：`LINE_SUPPRESS_SEND=true` 下跑一次進貨/出貨流程，確認 log 有記錄且不影響原本業務邏輯結果（用 `/verify` 或直接跑 `uv run uvicorn` + 手動打 API）。
8. 前端 `api.ts` + `SystemSettings.tsx` 新 Tab，`npm run dev` 實際點過一次綁定流程 UI（無真實 LINE 帳號時至少驗證「未綁定」狀態顯示與按鈕行為，串接視窗開啟）。
9. 撰寫使用說明書。
10. （使用者拿到真實 LINE 帳號後）關閉 `LINE_SUPPRESS_SEND`，端到端驗證一次真實綁定＋推播。

## 使用說明書大綱（最終產出 Markdown 文件）

1. 前言：文件對象與系統目前支援的通知範圍。
2. 申請 LINE Developers 帳號、建立 Provider。
3. 建立 LINE Login Channel：取得 Channel ID/Secret、設定 Callback URL（需與 `.env` 的 `LINE_LOGIN_CALLBACK_URL` 一致）、開啟 `profile`/`openid` scope。
4. 建立 Messaging API Channel：需與 LINE Login 掛同一 Provider、取得 Channel Access Token、加自己的官方帳號好友（推播前提）。
5. 設定 `.env`：逐欄位說明、`LINE_SUPPRESS_SEND` 何時該關閉。
6. 啟動方式（沿用 CLAUDE.md 既有指令）。
7. 員工如何在系統內綁定 LINE：登入 → 個人設定 → LINE 通知 Tab → 綁定流程文字步驟。
8. 會收到的通知範例：進貨完成、出貨完成訊息文字範例。
9. 解除綁定 / 換帳號重新綁定。
10. 疑難排解：Callback URL 不一致、Token 過期、兩個 Channel 沒掛同 Provider、忘記關閉 `LINE_SUPPRESS_SEND`。
11. 未來擴充：會員端沿用同一套服務的說明。

## 驗證方式

- Backend：`cd D:/System_Of_Speeching && PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/ -q 2>&1 | tail -40`（確認沒有讓既有基線變更差），另外手動跑 `uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000`，用 `curl`/前端手動測進貨轉「已到貨」與出貨轉「已出貨」，確認 line log 有記錄。
- Frontend：`cd D:/System_Of_Speeching/frontend && npm run build && npm run lint`，並 `npm run dev` 實際打開 `/settings` 頁面第 4 個 Tab 操作一次（`LINE_SUPPRESS_SEND=true` 下無法真的收到 LINE 訊息，但要驗證綁定/解除綁定的 UI 流程與 API 串接沒有壞掉）。
- 最終產出的使用說明書另外用 `Artifact` 或存成 repo 內的 Markdown 檔案（依使用者當下偏好決定），需讓一位完全沒碰過 LINE Developers 後台的人跟著操作能成功申請到帳號並設定完成。
