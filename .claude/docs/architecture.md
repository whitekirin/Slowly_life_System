# Codebase 架構參考

> 從 CLAUDE.md 抽出的完整版（2026-07-05 由實際讀碼驗證）。CLAUDE.md 只留摘要，細節在這裡。
> 如果本檔描述與原始碼衝突，以原始碼為準，並依 maintenance.md 更新本檔。

## 兩套平行的身分系統，共用一個 JWT signer

兩種完全分離的登入者，共用 `backend/auth.py` 的 `SECRET_KEY`/HS256，但 token payload 與資料表不同：

- **員工／管理員**（`User` model）：`/token` 登入，token 帶 `sub=username`。用 `get_current_user` / `require_permissions([...])`（`backend/auth.py`）守門。授權是 `User.permissions` 的扁平 JSON 字串陣列（如 `view_products`、`manage_members`）；`is_superuser` 或陣列含 `"all"` 可繞過所有檢查。
- **會員**（`Member` model，電商顧客側）：`/members/login` 登入，token 帶 `sub=手機或email, role="member"`。用 `backend/members.py` 的 `get_current_member` 守門，它會明確拒絕 `role != "member"` 的 token。

前端鏡像這個分割：
- 員工側：`UserContext` + `localStorage["token"]` + `src/api.ts`（axios client，401 時導向 `/login`）
- 會員側：`MemberContext` + `localStorage["member_token"]` + `src/memberApi.ts`（401 時導向 `/member/login`）

管理後台（`App.tsx` 的 `handleOpenMemberSystem`）把員工 JWT base64 塞進 `?auth=` query param 連到會員入口——這只是混淆不是加密，改動時照此認知處理。

路由分割在 `frontend/src/App.tsx`：會員路由（`/member/login`、`/member/register`、`/member/dashboard`）包在 `<MemberTheme>` 裡、在員工 `AppLayout` 之外；其餘全部走 `/*` 掛在員工 token 檢查之後。

## Backend 模組佈局

`backend/main.py` 是歷史單體（約 1650 行：商品、類別、供應商、採購、驗收、銷售、退貨、盤點、記帳、儀表板、上傳、audit-log HTTP middleware），並且擁有 app 建構、CORS、`lifespan` 啟動（建 DB＋預設 admin＋`marketing_scheduler` 背景任務）、router 註冊。較新的功能拆成獨立 router，在 `main.py` 用 `app.include_router(...)` 掛載：

| 檔案 | 職責 | 備註 |
| :--- | :--- | :--- |
| `backend/file_manager.py` | NAS 式資料夾／檔案／分享連結（`nas_router`） | |
| `backend/system_log.py` | 稽核日誌儲存＋`create_log` helper | middleware 和各處都呼叫它 |
| `backend/members.py` | 會員認證＋個人資料＋管理端會員管理（`/members/*`） | `get_current_member` 定義在這 |
| `backend/dms.py` | 舊版促銷 DM 推播 | **有自己獨立的 in-memory WebSocket 連線清單，不用 ws_manager.py** |
| `backend/mail_symbols.py` | 會員信箱通知符號（`/api/v1/*`） | 走 `ws_manager` 推播；Prometheus counter（未裝 prometheus_client 時退化成 no-op） |
| `backend/points_store.py` | 會員點數兌換商店（`/api/v1/points/*`） | |
| `backend/marketing.py` | 模板／分眾／活動／自動觸發（管理端行銷中心） | 活動由 `main.py` lifespan 啟動的 `marketing_scheduler` 每 60 秒輪詢執行（撈 `status="scheduled"` 且 `scheduled_at` 已到的 Campaign） |
| `backend/ws_manager.py` | 共用的 per-member-id `ConnectionManager` | mail_symbols／points_store 用它做即時推播 |

所有 SQLModel 類別集中在單一 `backend/models.py`（約 900 行），每個實體遵循 `XBase`（共用欄位）→ `X(XBase, table=True)`（資料表）→ `XCreate`/`XUpdate`/`XRead`（請求／回應 schema）。**加欄位要同時更新 Base 與該暴露它的變體，不會自動繼承可見性。**

庫存相關操作（採購驗收、出貨、退貨、盤點完成）永遠是「改 `Product.stock_quantity`＋寫一筆 `InventoryLog`」成對出現（`change_type` 區分 purchase/sale/adjustment）。動這些流程時保持成對，不要直接改庫存。

## Frontend 結構

- `src/api.ts`（員工）與 `src/memberApi.ts`（會員）是兩個 axios client，各自的 interceptor 掛各自的 bearer token、401 時導向各自的登入頁。不要跨用。
- `src/pages/` 是員工頁面；`src/pages/member/` 是平行的會員入口頁面。`MemberTheme.tsx` 給會員頁面獨立的視覺主題。
- Server state 全面用 TanStack Query（`useQuery`/`useQueryClient`），單一共用 `QueryClient` 建在 `App.tsx`。
- `src/utils/costCalculator.ts` / `poCalculations.ts` 是 CNY→TWD 到岸成本公式，商品定價與採購單合計都用。公式：`成本(NTD) = (price_rmb + shipping_rmb) × exchange_rate + shipping_rate_twd × weight_kg`。兩個計算器要保持一致（採購單合計要能對回商品成本）。

## 已知缺陷與陷阱（2026-07-05 驗證）

1. **`backend/main.py:1634` 的 NameError**：`/api/v1/ws/mail-symbols/{member_id}` websocket handler 引用了該作用域內不存在的 `manager`（缺 import），一連線就炸。`backend/tests/test_ws_manager.py` 因此失敗。修法方向：在 main.py 補 `from backend.ws_manager import manager` 或把 handler 移進 mail_symbols.py。
2. **缺 conftest.py**：全 repo 沒有任何 conftest。`backend/tests/test_members_admin.py` 和 `test_mail_symbols.py` 引用不存在的 `client`/`setup_data`/`session` fixtures，一跑就 fixture error。
3. **`backend/test_attributes.py`**（在 backend/ 根、不在 tests/ 裡）：`from main import app` 假設 cwd 是 `backend/`。它和 `backend/tests/` 不能同一條指令跑；而且 repo 根有個只會 print hello 的殘留 `main.py` 會攔截這個 import。
4. **SECRET_KEY 硬編碼**：`backend/auth.py:13` 是寫死的 placeholder，沒接 `.env`（雖然依賴裡有 pydantic-settings/python-dotenv）。動認證設定時注意它未接線。
5. **README.md 過時**：只涵蓋原始 ERP，會員／行銷／DM／點數模組不在其中。它的 API 清單、檔案清單、遷移腳本清單對新模組不可信。
6. **Repo 根目錄殘留腳本**：`alter_db.py`、`check_db.py`、`fix_db.py`、`fix_member_db.py`、`fix_pointexchangerecord_db.py`、`seed_test_data.py`、`test_email.py`、`main.py` 都是過去 session 的一次性工具，直接對 `backend/database.db` 動手，不是遷移框架的一部分。當 scratch 看待，不當 schema 真相來源；未經使用者同意不要跑它們（會改資料庫）。
7. **測試基線**：backend `PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/ -q` → 6 failed / 2 passed。frontend `npx vitest run` → 8/8 passed。改動後與此基線比對。

## 教訓記錄（後續 session 依 maintenance.md 追加）

- [2026-07-05] 建檔。
- [2026-07-07] `uv run python backend/main.py` 靜默結束不報錯（main.py 只定義 app，無 uvicorn.run / __main__ 區塊），port 8000 起不來，start_dev.bat 因此看似有啟動後端實則沒有 → 啟動後端一律用 `uv run uvicorn backend.main:app --port 8000`，並以 curl :8000/docs 驗證。
- [2026-07-10] repo 根目錄的 `.env` 已填入真實的 LINE Messaging API 憑證（`LINE_CHANNEL_SECRET`、`LINE_MESSAGING_ACCESS_TOKEN`）且 `LINE_SUPPRESS_SEND=false`（正式運作中，非開發預設值）→ 任何會呼叫 `backend/line_utils.py` 推播/回覆函式的新測試，一律用 `monkeypatch.setattr(settings, "LINE_SUPPRESS_SEND", True)` 強制關閉真實發送，不可依賴 `config.py` 的預設值（預設 `True` 但 `.env` 已覆蓋成 `False`）。
- [2026-07-10] `backend/tests/` 沒有 `conftest.py`，多個測試檔各自在**模組層級**（import 時）執行 `app.dependency_overrides[get_session] = ...`；pytest 收集階段會 import 全部測試模組，等所有測試開始跑時，這個 dict 已經被「最後一個做了模組層級賦值的檔案」贏家全拿，其餘檔案的 `session`/`client` fixture 建的測試資料其實跑在別人的 engine 上、對實際 HTTP 請求不可見 → 若新測試需要 `TestClient` + 自己的 SQLite engine，一律把 `app.dependency_overrides[get_session] = ...` 的賦值挪進 `client` fixture 函式本體（不要放模組頂層），並在 fixture 內用 `previous = app.dependency_overrides.get(get_session)` 存舊值、`try/finally` 測試結束後還原，避免跟其他測試檔互相覆蓋（參考 `backend/tests/test_line_webhook.py`、`test_liff_purchase_orders.py` 的寫法）。根本修法是加一個共用 `conftest.py`，目前尚未做。
- [2026-09-18] repo 目前所在路徑 `/media/whitekirin/T7/System_Of_Speeching` 是掛載在 **exFAT**（`mount` 顯示 `type exfat`）的外接硬碟，exFAT 不支援 symlink；`uv run`／`uv sync` 預設把 `.venv` 建在 repo 目錄下，建 venv 時要對 `.venv/bin/python` 建 symlink 會直接報 `Operation not permitted (os error 1)`，`UV_LINK_MODE=copy` 治不了（那只影響套件安裝的 link 方式，不影響 venv 本身的直譯器 symlink）→ 一律加 `UV_PROJECT_ENVIRONMENT=<repo 外的路徑，例如 /tmp/claude-line-venv 或 scratchpad>` 環境變數，把 venv 建到有 symlink 支援的檔案系統上，`PYTHONPATH=.` 照舊加在同一行最前面。這個問題只在 Linux + exFAT 外接碟這個環境組合出現，CLAUDE.md 原本記載的 `D:/System_Of_Speeching`（Windows/NTFS）指令不受影響。
- [2026-09-18] 用 `UV_PROJECT_ENVIRONMENT` workaround 重跑一次基線：`PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/ -q` → 6 failed / 31 passed（失敗的 6 個測試名稱跟本檔 §7 記載的舊基線完全一樣，只是總測試數從 8 個變 31 個，因為這之間新增了不少測試檔，不是基線變糟）。
