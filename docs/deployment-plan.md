# 部署架構升級計畫：Docker + PostgreSQL + 多機共用同一套系統

**狀態：Phase 0＋Phase 1＋Phase 3（Server 部署）核心流程已全部驗證成功！`https://slowlyshops.com` 對外可正常存取（2026-09-18）。剩下的是收尾清理與正式上線後的複測（見 §7）。**

**已確認的決策**：
1. ~~Server 公網但暫無網域 → 先上 HTTP~~ **已取得網域 `slowlyshops.com`。**
2. `backend/database.db` 現有資料不需要保留 → 跳過搬遷，Phase 2 直接在 Postgres 用 `create_db_and_tables()` 建全新 schema。
3. `SECRET_KEY` 已改讀 `.env`（見下方 Phase 0 清單）。
4. **架構簡化**：前端＋後端合併成同一個 `app` container（FastAPI 直接吃前端的 build 產物），不用 nginx。
5. ~~docker-compose 是 `db` + `app` + `caddy` 三個 service（Caddy 負責網域＋自動 HTTPS，對外開 80/443）~~ **改成 `db` + `app` + `cloudflared` 三個 service（2026-09-17 變更）。原因：家用路由器的 UPnP 拒絕自動開放 80/443（`729 ConflictWithOtherMechanisms`），且尚未嘗試手動 port forwarding 使用者已決定不想開放任何對外 port；網域註冊商（遠振資訊）又沒有 Caddy 支援的 ACME DNS-01 外掛，Let's Encrypt 的 HTTP-01/TLS-ALPN-01 挑戰協定規定只能用真正的 80/443，換成其他對外 port（例如 2487/2488）在協定層面就過不了。改用 Cloudflare Tunnel：DNS 委託給 Cloudflare 代管、`cloudflared` container 主動連出去到 Cloudflare 邊緣，路由器完全不用開任何 port，HTTPS 憑證由 Cloudflare 邊緣處理。`Caddyfile` 已刪除，`docker-compose.yml` 已改。

## 實作進度

- [x] **Phase 0（程式碼改動，已完成並驗證）**：
  - `backend/config.py`：新增 `DATABASE_URL`、`SECRET_KEY`、`PUBLIC_BASE_URL`、`CORS_ORIGINS` 設定。
  - `backend/database.py`：改讀 `DATABASE_URL`；`PRAGMA table_info` 改寫成 `sqlalchemy.inspect()`（SQLite/Postgres 通用）。
  - `backend/auth.py`：`SECRET_KEY` 改讀 `settings.SECRET_KEY`。
  - `backend/main.py`：CORS 改讀白名單；`static`/`upload` 目錄改絕對路徑；上傳檔回傳網址、忘記密碼信、行銷追蹤像素的寫死 `localhost` 全部改讀 settings；檔案尾端新增前端 SPA 掛載＋catch-all fallback route。
  - `backend/marketing.py`、`backend/email_utils.py`：追蹤像素/reset 信連結改讀 `settings.PUBLIC_BASE_URL`／`settings.FRONTEND_BASE_URL`。
  - `frontend/src/api.ts`、`frontend/src/memberApi.ts`：`baseURL` 改成 dev 用 `localhost:8000`、production 用相對路徑（同源）。
  - `pyproject.toml`：加 `psycopg[binary]`。
  - **驗證**：`uv sync` 成功；backend `pytest` 6 failed/21 passed（跟改動前的既有已知失敗完全一致，無新增失敗，失敗清單見 `architecture.md`）；frontend `npx vitest run` 9/9 全過；`npm run build` 成功，且確認 build 產物路徑（`assets/`、根目錄 `index.html`/`vite.svg`）跟 `main.py` 新增的 catch-all 邏輯吻合。
- [x] **Phase 1（Docker 化，已完成，2026-09-17 更新過對外曝露方式）**：根目錄新增 `Dockerfile`（多階段：node 建前端 → python+uv 跑 backend，把 `frontend/dist` 內嵌成 `frontend_dist`）、`docker-compose.yml`（`db`/`app`/`cloudflared` 三個 service，原本是 `caddy`，已改為 Cloudflare Tunnel，見上方決策 5）、`.dockerignore`、`.env.production.example`（機密範本，已加進 `.gitignore`，新增 `CLOUDFLARE_TUNNEL_TOKEN` 欄位）。
- [ ] **Phase 2**：略（已確認不搬遷舊資料）。
- [ ] **Phase 3（部署到你的 Server）**：見下方「§6 Server 部署步驟」，待你在 Server 上執行。

## 0. 先釐清一個常見誤解

「多台電腦要連到同一個資料庫」不代表每台電腦都要裝一份程式去連 DB。這是一個網頁系統（React SPA + FastAPI），正確模型是：

```
公司/各地電腦（純瀏覽器）─┐
公司/各地電腦（純瀏覽器）─┼──HTTP(S)──▶  Linux Server
公司/各地電腦（純瀏覽器）─┘                ├─ app container（FastAPI，同時 serve 前端靜態檔＋API，單一份）
                                          └─ db container（PostgreSQL，只在 server 內部網路）
```

**只有 Server 上的 app container 會連 DB。** 各電腦只需要瀏覽器開網址（例如 `http://<server-ip>` 或未來的網域），資料庫本身完全不對外開放。這份文件把「換成 Linux 可跑的軟體」「Docker 化」「資料庫換成可多人共用的引擎」「怎麼部署到你已經有的 Server」四件事一次講完。

## 1. 現況調查結論（已用 Explore agent 讀過原始碼確認）

| 項目 | 現況 | 檔案:行號 |
| :--- | :--- | :--- |
| DB engine | SQLite，連線字串寫死、絕對路徑，非讀環境變數 | `backend/database.py:6-11` |
| SQLite 專屬參數 | `check_same_thread: False`，換 DB 要拿掉 | `backend/database.py:10` |
| Schema migration | 手寫 `PRAGMA table_info(...)` + `ALTER TABLE`，**SQLite 專屬語法，Postgres 會直接報錯** | `backend/database.py:13-71` |
| DB driver | 沒裝 `psycopg2`/`asyncpg`，只有 sqlmodel 帶入的 sqlalchemy 2.0.49 | `pyproject.toml`, `uv.lock` |
| 環境變數 | 有 `.env` 機制（pydantic-settings），但**完全沒有 `DATABASE_URL`** | `backend/config.py:5-18` |
| 背景排程 | `marketing_scheduler` 用 `asyncio.create_task()` 跑在 process 記憶體內，無分散式鎖 | `backend/main.py:54-103` |
| WebSocket 狀態 | `ws_manager.py`、`dms.py` 各自一份 in-memory 連線清單 | `backend/ws_manager.py:8-36`, `backend/dms.py:14-34` |
| 靜態/上傳路徑 | `static/`、`static/uploads` 用**相對路徑**（吃 uvicorn 啟動時的 cwd），但 `file_manager.py` 的 NAS 模組用**絕對路徑**，兩套基準不一致 | `backend/main.py:277,288-291`, `backend/file_manager.py:27-29` |
| Frontend API base | `api.ts`／`memberApi.ts` 寫死 `http://localhost:8000`，未讀環境變數；`liffApi.ts` 已有讀 `VITE_API_BASE_URL` 的先例可比照 | `frontend/src/api.ts:3-5`, `frontend/src/memberApi.ts:3-5`, `frontend/src/liffApi.ts:6` |
| CORS | `allow_origins=["*"]` + `allow_credentials=True`，合併成單一 container 後前後端同源，CORS 需求大幅降低，但仍建議收斂 | `backend/main.py:108-114` |
| **路由衝突檢查（新確認，關鍵）** | 逐一比對 `App.tsx` 的前端頁面路徑與 `main.py` 的 API 路徑：**沒有直接衝突**。前端多為無尾斜線（`/products`、`/suppliers`）或連字號命名（`/purchase-orders`），後端 API 多為有尾斜線（`/products/`）或底線命名（`/purchase_orders/`），兩者字串不同 → 可以安全地讓 FastAPI 用「先比對 API 路由，都不中再 fallback 回傳前端 `index.html`」的方式同源共用一個 port。 | `frontend/src/App.tsx:351-403`, `backend/main.py`（各路由定義） |
| Docker 相關檔案 | 完全沒有，需從零建立 | — |
| Windows 專屬程式碼 | 沒有找到（`uv.lock` 裡的 `win32` 只是 PyPI wheel 平台標籤，Linux 安裝時自動略過） | — |
| Frontend build | `npm run build` → `tsc -b && vite build`，輸出 `frontend/dist/` | `frontend/package.json:8` |
| 已知資安缺口（順便一提，非本計畫強制項目） | `SECRET_KEY` 寫死在 `backend/auth.py:13`，未接 `.env`；建議上 Server 前一併修掉 | `backend/auth.py:13`（見 `architecture.md` 已知缺陷#4） |

**結論**：程式碼本身沒有 Windows 專屬障礙，可以直接跑 Linux；主要工程量在「把寫死的設定改成環境變數」「SQLite→PostgreSQL 的驅動與 schema migration 邏輯」「讓 FastAPI 同時 serve 前端 build 產物」三塊。

## 2. 資料庫：PostgreSQL 16

理由：SQLModel/SQLAlchemy 原生支援良好、官方 Docker image 成熟、多人並發寫入沒有 SQLite 的檔案鎖問題。

## 3. 需要修改的既有程式碼（Phase 0，Docker 化之前先做，風險最低）

1. **`backend/database.py`**：改讀 `DATABASE_URL` 環境變數，沒設定時 fallback 回現在的 SQLite（本機開發不受影響）；`check_same_thread` 只在 SQLite 分支套用；把 `PRAGMA table_info(...)` 改寫成 `sqlalchemy.inspect(engine).get_columns(table_name)`（dialect-agnostic，SQLite/Postgres 都能跑，不需要馬上導入 Alembic）。
2. **`backend/config.py`**：新增 `DATABASE_URL: str = "sqlite:///./database.db"`；`FRONTEND_BASE_URL`、`LINE_LOGIN_CALLBACK_URL` 的正式環境值改由 Server 上的 `.env.production` 提供。
3. **`backend/main.py:108-114`**：CORS `allow_origins` 改成從環境變數讀白名單（同源部署後主要是防護 LIFF/開發環境呼叫，不是必要防線）。
4. **`backend/main.py:277,288-291` + `backend/file_manager.py`**：統一成用 `BASE_DIR`-based 絕對路徑（或固定 Docker `WORKDIR`），確保掛 volume 後上傳的檔案不會因為 cwd 不同而找不到。
5. **`backend/main.py`（新增，檔案尾端、所有 router 註冊之後）**：加兩段：
   - `app.mount("/assets", StaticFiles(directory=FRONTEND_DIST/"assets"), name="frontend-assets")`（前端 build 出的 hashed JS/CSS）。
   - 一個放在**最後面**的 catch-all route：`@app.get("/{full_path:path}")` → 如果路徑對到 `frontend_dist` 裡的實體檔案（如 `favicon.ico`）就回傳該檔案，否則一律回傳 `frontend_dist/index.html`（SPA 由 react-router 接手前端路由）。因為註冊順序在所有 API 路由之後，FastAPI 只有在前面所有路由都比對不到時才會落到這條，不會搶走任何 API 路徑。
6. **`frontend/src/api.ts`、`frontend/src/memberApi.ts`**：`baseURL` 改成同源相對路徑（空字串，讓 axios 打相對路徑），開發模式（`import.meta.env.DEV`）才 fallback 回 `http://localhost:8000`，這樣本機開發（vite :5173 + uvicorn :8000 分開跑）和正式環境（同一 origin）都對。
7. **`pyproject.toml`**：加 `psycopg[binary]`（或 `psycopg2-binary`）作為 Postgres driver。
8. **`backend/auth.py:13`**：`SECRET_KEY` 改讀 `.env`，正式環境用隨機長字串（例如 `openssl rand -hex 32` 產生），不要沿用預設值。

這一批都是小改動，改完後本機用 SQLite 照樣能跑，先確認沒有壞掉既有功能，再進 Phase 1。

## 4. Docker 化設計（Phase 1）

### 4.1 單一 `Dockerfile`（多階段建置，前後端合併）

- **Stage 1（frontend builder）**：`node:20-alpine`，`npm ci && npm run build`，產出 `frontend/dist/`。
- **Stage 2（runtime）**：`python:3.13-slim` + `uv`：
  - `uv sync --frozen` 裝 backend 依賴（複用現有 `uv.lock`）。
  - `COPY --from=frontend-builder /frontend/dist ./frontend_dist`（放進 image 內固定路徑，供 §3 第 5 點的 mount/catch-all 讀取）。
  - `WORKDIR /app`，`COPY . .`（repo 根目錄留在 image 裡，因為 backend 用絕對 import `from backend.models import ...`，跟 CLAUDE.md 記載的規則一致）。
  - `CMD ["uv", "run", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]`。
  - 對外只需要暴露 **一個 port（8000）**，前端頁面和 API 都走這個 port。

### 4.2 `docker-compose.yml`（`db` + `app` + `cloudflared` 三個 service，已建立在 repo 根目錄）

實際檔案就是 repo 根目錄的 `docker-compose.yml`，重點行為：

- `db`：`postgres:16`，不對外開 port，只有 `app` 能連。
- `app`：`build: .`（用上面的 Dockerfile），只設 1 個 replica（`marketing_scheduler`／`ws_manager` 是 process 內記憶體狀態，多開會排程重複執行、WebSocket 推播漏訊息），完全沒有 `ports:`，只在 compose 內部網路可見（`expose: 8000`）。
- `cloudflared`：`cloudflare/cloudflared:latest`，`tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}`，同樣沒有 `ports:`——它是主動撥出去連 Cloudflare 邊緣的，路由器/防火牆完全不用開任何對外 port。

環境變數靠根目錄的 `.env.production`（範本是 `.env.production.example`）用 `--env-file` 帶入，細節見下方「§6 Server 部署步驟」。

### 4.3 網域與 HTTPS（已確認：`slowlyshops.com`，改用 Cloudflare Tunnel，2026-09-17 變更）

**原計畫是 Caddy 自動 HTTPS（`{$DOMAIN} { reverse_proxy app:8000 }`），已放棄**，原因見上方「已確認的決策」第 5 點：家用網路的 UPnP/路由器/註冊商三個環節都卡住了對外開 80/443 這條路，而 Let's Encrypt 的 ACME 驗證協定規定只能用真正的 80（HTTP-01）或 443（TLS-ALPN-01），換成別的對外 port 在協定層面就是無解。

改用 **Cloudflare Tunnel**：`cloudflared` container 從這台主機主動連出去到 Cloudflare 邊緣（outbound-only），Cloudflare 邊緣終止 TLS（憑證由 Cloudflare 簽發管理，自動續期），再把流量轉給 `cloudflared`、`cloudflared` 轉給 `app:8000`（純 HTTP，同一個 compose 內部網路）。

**前提**（見 §6 的實際操作步驟）：
1. `slowlyshops.com` 的 nameserver 要從遠振資訊改指到 Cloudflare 指定的兩組 nameserver（在 Cloudflare 後台加站台時會給）。
2. 在 Cloudflare Zero Trust 後台建一個 Tunnel（Docker connector），拿到 `--token` 後面那串 token，填進 `.env.production` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
3. Tunnel 的 Public Hostname 設定：`slowlyshops.com` → HTTP → `app:8000`（在 Cloudflare 後台設定，不是本機檔案）。
4. 路由器、防火牆**完全不需要**開放任何 port（包含 80/443），因為連線方向是主機主動連出去，不是被動等外部連進來。

## 5. 資料庫搬遷（Phase 2，已確認：不搬，全新開始）

`backend/database.db` 目前的資料不需要保留，Phase 2 直接在 Postgres 上跑 `create_db_and_tables()` 建全新的 schema（SQLModel 的 table 定義會照 `backend/models.py` 建出所有表）。啟動後系統會照 `backend/main.py` 的 lifespan 邏輯自動建立預設 admin 帳號（`admin`/`password`），跟現在本機開發第一次啟動的行為一致——**上線後第一件事就是改掉這組預設密碼**。

## 6. Server 部署步驟（Phase 3，帶去 Linux 主機照做）

### 6.0 目前驗證到哪裡（誠實現狀，2026-09-17）

- ✅ `docker build .` 在本機（Windows + Docker Desktop）成功建出 `app` image，多階段建置（frontend build → backend runtime）流程跑得通。
- ✅ 本機非 Docker 直接跑 `uv run uvicorn backend.main:app`（用真實 `.env`）：啟動無錯誤、`GET /docs` 200、`POST /token`（admin/password）200，代表 Phase 0 的程式碼改動沒有破壞既有功能。
- ✅ **`db` + `app` 整合測試已完成（2026-09-17，於 `whitekirin-System-Product-Name` 這台實機）**：`docker compose --env-file .env.production up -d db app` 成功，`db` healthy；`app` log 乾淨啟動無錯誤；容器內部呼叫 `GET /docs` 200、`POST /token`（admin/password）200 拿到合法 JWT；`psql \dt` 確認 Postgres 上 `create_db_and_tables()` 建出全部 40 張表。**這台機器就是實際要部署的正式 Server**，公網 IP 為固定制（`<主機公網 IP>`），區網位址 `<區網 IP>`。
- ✅ **`cloudflared` 技術面已驗證成功（2026-09-17）**：nameserver 已從遠振資訊改指到 Cloudflare（`woz.ns.cloudflare.com` / `savanna.ns.cloudflare.com`）；Cloudflare Zero Trust 建了 Tunnel（Docker connector），Public Hostname 設定 `slowlyshops.com → HTTP → app:8000`；`docker compose up -d cloudflared` 後 log 顯示 4 條連線都 `Registered tunnel connection`、connectivity pre-checks 全過、`Updated to new configuration` 顯示 ingress 規則正確套用。**Tunnel 本身完全沒問題。**
- ✅ **對外連線＋憑證驗證通過（2026-09-18）**：Cloudflare 網域已轉 Active，`slowlyshops.com` 的 A 記錄由 Tunnel 記錄接管、指向 Cloudflare 邊緣 IP（`172.67.186.167`／`104.21.68.46`）。`curl --resolve slowlyshops.com:443:172.67.186.167 https://slowlyshops.com/docs` 回應 200、TLS 憑證是 Let's Encrypt 簽發、`CN=slowlyshops.com`、`SSL certificate verify ok`；`POST /token`（admin/password）回應 200 拿到合法 JWT。**Cloudflare → cloudflared → app:8000 → FastAPI 整條鏈路確認打通。**
  - 從卡在 Pending 到轉 Active 大約花了一天多，過程中觀察到全球 DNS 解析不一致（部分節點還在回應舊的 `a.g-dns.com`／`<主機公網 IP>`），這是 nameserver 遷移的正常過渡期現象，最終會自然收斂，不需要額外操作。
  - 這台主機自己的 DNS 快取（`systemd-resolved`）在轉換完成後一段時間內仍可能回應舊 IP，屬於本機快取延遲，不影響外部使用者實際訪問；需要驗證時可用 `curl --resolve slowlyshops.com:443:<Cloudflare edge IP>` 跳過本機快取直接測試。
  - 過程中一度誤觸兩個舊 tunnel token（在對話中意外明碼曝光過），已捨棄重建為目前這個 tunnel（`cd5723ad-...`，DNS 記錄裡顯示名稱 `Slowly`），**建議找時間去 Cloudflare 後台把這幾組舊 token 對應的 tunnel 刪掉清理**，並清掉 `www.slowlyshops.com` 那筆重複的舊 A 記錄（`<舊公網 IP>`／`<主機公網 IP>` 兩筆中的一筆）。
- 沿路排除過的替代方案（記錄原因，避免之後重複嘗試）：① 路由器 UPnP 自動開 80/443 被拒絕（`729 ConflictWithOtherMechanisms`）；② 使用者評估後決定不手動於路由器後台開 80/443；③ 改用非標準 port（如 2487/2488）在協定層面過不了 Let's Encrypt 只認真正 80/443 的限制；④ 網域註冊商遠振資訊沒有 Caddy 支援的 ACME DNS-01 外掛可用。最終收斂到 Cloudflare Tunnel 方案，`Caddyfile` 已刪除、`docker-compose.yml` 已改為 `db`+`app`+`cloudflared`。
- 環境安裝細節：本機原本只有 Ubuntu 預設庫的 `docker.io`，沒有 `docker compose`（v2）plugin；額外加了 Docker 官方 apt repo（`/etc/apt/sources.list.d/docker.list`）才裝到 `docker-compose-plugin`（v5.5.1）。`.env.production` 已產生（`POSTGRES_PASSWORD`/`SECRET_KEY` 用 `openssl rand` 隨機產生；`LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`/`LIFF_ID`/`LIFF_CHANNEL_ID` 暫留空，因為本機 `.env` 裡這幾項也只是佔位符，之後有正式 LINE 憑證再補）。

### 6.1 準備工作

1. **Server 裝 Docker**（已完成，2026-09-17）：這台機器原本只有 Ubuntu 預設庫的 `docker.io`，額外加了 Docker 官方 apt repo 才裝到 `docker-compose-plugin`（v2，指令是 `docker compose` 不是 `docker-compose`）。
2. **防火牆**：完全不用開任何對外 port（不管 80、443 還是其他），`cloudflared` 是主動連出去的，5432（Postgres）本來就沒有對外開。

### 6.1a Cloudflare Tunnel 設定（已完成，2026-09-17）

1. ✅ [dash.cloudflare.com](https://dash.cloudflare.com) 帳號、加入 `slowlyshops.com` 站台。
2. ✅ 遠振資訊的 nameserver 已改成 Cloudflare 給的兩組（`woz.ns.cloudflare.com`、`savanna.ns.cloudflare.com`），註冊層級已生效，正在等全球 DNS 收斂（見 §6.0）。
3. ✅ Cloudflare Zero Trust 後台建了 Tunnel（Docker connector），token 已填進 `.env.production` 的 `CLOUDFLARE_TUNNEL_TOKEN`。
4. ✅ Public Hostname 設定：`slowlyshops.com` → HTTP → `app:8000`，log 確認 ingress 規則已套用。
5. **待辦**：DNS 全球收斂後（不確定要多久，見 §6.0），重新跑 §6.3 的驗證清單確認 `https://slowlyshops.com` 能連、憑證合法。收斂後建議去 Cloudflare 後台清掉過程中建立又捨棄的舊 tunnel。

### 6.2 把程式碼與設定放上 Server

1. `git clone <repo>` 或 `rsync` 整個 repo 到 Server（含新增的 `Dockerfile`、`docker-compose.yml`、`.dockerignore`、`.env.production.example`）。
2. 在 repo 根目錄複製範本並填入正式機密（**已完成**，2026-09-17）：
   ```bash
   cp .env.production.example .env.production
   nano .env.production   # 填入 DOMAIN、POSTGRES_PASSWORD、SECRET_KEY、CLOUDFLARE_TUNNEL_TOKEN、LINE_* 真實值
   ```
   - `POSTGRES_PASSWORD`：`openssl rand -hex 24` 產生（已完成）。
   - `SECRET_KEY`：`openssl rand -hex 32` 產生，**不要**沿用 repo 裡的預設值（已完成）。
   - `CLOUDFLARE_TUNNEL_TOKEN`：見 §6.1a，待使用者從 Cloudflare 後台取得。
   - `LINE_*`：`LINE_MESSAGING_ACCESS_TOKEN` 已從本機 `.env` 複製；`LINE_CHANNEL_ID`/`LINE_CHANNEL_SECRET`/`LIFF_ID`/`LIFF_CHANNEL_ID` 本機 `.env` 也只是佔位符，暫留空，之後有正式 LINE 憑證再補（空字串有預設值，不影響啟動）。
   - 這個檔案**不會進 git**（`.gitignore` 已排除 `.env.production`），只存在 Server 上。

### 6.3 啟動與驗證

```bash
docker compose --env-file .env.production build
docker compose --env-file .env.production up -d
docker compose --env-file .env.production ps              # 三個 container 都應該是 Up/healthy
docker compose --env-file .env.production logs app         # 看有沒有啟動錯誤（例如 DB 連不上）
docker compose --env-file .env.production logs cloudflared # 看 tunnel 有沒有連上 Cloudflare（"Registered tunnel connection"）
```

驗證清單：
- [x] `db` + `app` 已驗證（見 §6.0）：Postgres healthy、`create_db_and_tables()` 建出 40 張表、`/docs`／`/token` 都正常。
- [x] `docker compose ps` 三個 service（`db`/`app`/`cloudflared`）都在跑。
- [x] `docker compose logs cloudflared` 看到成功註冊 tunnel connection 的訊息，ingress 規則正確套用。
- [x] `https://slowlyshops.com` 回應 200，憑證合法（Let's Encrypt，`CN=slowlyshops.com`）——見 §6.0，2026-09-18 驗證通過。
- [x] `POST /token`（admin/password）透過公開網域回應 200，拿到合法 JWT——見 §6.0。
- [ ] 瀏覽器實際開 `https://slowlyshops.com`，肉眼確認能看到登入頁（目前只用 `curl` 驗證過，還沒用瀏覽器實際點過）。
- [ ] 用 `admin`/`password` 登入成功，**立刻**在系統內改掉這組預設密碼。
- [ ] 隨便測一個會寫資料庫的流程（例如建一筆供應商），確認資料庫真的能寫入。

### 6.4 備份

```bash
# 排進 cron，例如每天凌晨 3 點
0 3 * * * docker compose -f /path/to/repo/docker-compose.yml --env-file /path/to/repo/.env.production exec -T db pg_dump -U <POSTGRES_USER> <POSTGRES_DB> | gzip > /path/to/backups/erp-$(date +\%F).sql.gz
```
備份檔案要存到 Server 以外的地方（另一台機器、雲端物件儲存），不要只放在同一顆硬碟。

## 7. 分階段順序總結

- [x] Phase 0：程式碼改動（env 化 DB 連線、CORS、frontend baseURL 改相對路徑、路徑統一、SECRET_KEY 讀 .env、backend 加前端 SPA 掛載＋catch-all route）——已驗證不影響既有功能
- [x] Phase 1：`Dockerfile`／`docker-compose.yml`（`db`+`app`+`cloudflared`）已建立，`docker build` 驗證成功
- [ ] Phase 2：（已確認不需搬遷，跳過）
- [x] Phase 3a：`db`+`app` 整合測試（Postgres 連線、建表、登入 API）——已完成
- [x] Phase 3b：Cloudflare Tunnel 設定（帳號／nameserver／tunnel token／Public Hostname）與 `cloudflared` 連線驗證——已完成（見 §6.1a、§6.0）
- [x] Phase 3c：`https://slowlyshops.com` 外部連線＋憑證＋登入 API 全部驗證通過（2026-09-18，見 §6.0）
- [ ] Phase 4（收尾，待辦）：
  - 瀏覽器實際打開 `https://slowlyshops.com` 肉眼確認、登入後**立刻改掉 `admin`/`password` 預設密碼**、測一筆會寫資料庫的操作（如建供應商）
  - 清掉 Cloudflare 後台過程中捨棄的舊 tunnel（token 曾在對話中曝光的那兩組）
  - 清掉 `www.slowlyshops.com` 重複的舊 A 記錄
  - 排備份排程（§6.4）

