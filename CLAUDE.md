# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

回覆使用者一律用繁體中文。程式碼、指令、檔名保持原文。

## 制度檔案路由（先看這張表，需要時才讀對應檔案）

| 情境 | 讀這個檔 |
| :--- | :--- |
| 要理解 codebase 結構、模組關係、已知 bug | `.claude/docs/architecture.md` |
| 要派 subagent、選模型、決定自己做還是委派 | `.claude/docs/model-dispatch.md` |
| 拿不準「該不該升級模型／算不算完成／該不該問使用者／方向對不對」 | `.claude/docs/judgment.md` |
| 要寫派工 prompt（搜尋／實作／重構／研究／審查） | `.claude/docs/delegation-templates.md` |
| 要修改任何 `.claude/docs/` 下的制度檔或本檔 | `.claude/docs/maintenance.md`（改之前必讀） |
| Session 開始時想快速理解這套制度為何存在 | `.claude/docs/00-diagnosis.md` 與 `.claude/docs/letter.md` |

## 硬規則（每個 session 無條件遵守）

1. **路徑絕對化**：Bash 指令用絕對路徑，或每條都以 `cd D:/System_Of_Speeching && ...` 開頭。cwd 會在指令之間殘留漂移，別依賴它。
2. **搜尋必排除**：Glob/Grep 避開 `node_modules`、`.venv`、`dist`、`__pycache__`、`.backup`——用 `path` 參數鎖定 `backend/` 或 `frontend/src/`，不從 repo 根目錄裸搜。
3. **臨時檔進 scratchpad**：一次性腳本、實驗、中間產物寫到系統提示給的 scratchpad 目錄（若系統提示沒給，退而用 `C:/Users/white/AppData/Local/Temp/claude-scratch/`，自行建立）。repo 根目錄不新增任何 `fix_*.py` / `check_*.py` 類的臨時腳本（現存的那些是歷史殘留，見 architecture.md）。
4. **完成 = 驗過**：改程式要跑對應測試或實跑（可用 `/verify` skill）；改檔案要 read-back；宣告完成前對照 `.claude/docs/judgment.md` 的完成判準。
5. **改制度檔先備份**：修改本檔或 `.claude/docs/*` 之前，先 `cp` 一份到 `.backup/`（檔名加日期），並遵守 maintenance.md 的權限分級。
6. **測試輸出截尾**：跑測試加 `-q` 並 `| tail -40`，完整 log 重導到 scratchpad。
7. **大量讀取派 agent**：要讀超過 3 個檔或 600 行才能回答的問題，派 `Explore` agent，只收結論與 `檔案:行號`（見 model-dispatch.md）。

## 專案概觀

Smart Inventory & ERP Lite：進銷存系統（員工後台）＋外掛的會員電商入口與行銷模組。Backend：Python/FastAPI/SQLModel/SQLite（單一 `backend/models.py` 放所有 model）。Frontend：React 19 + TypeScript + Vite + Ant Design 6。

**注意**：`README.md` 只涵蓋原始 ERP 功能，會員／行銷／DM／點數商店模組寫在它之後——那些區域以原始碼為準，別信 README 的檔案清單。

## 指令（已驗證可跑，直接抄，不要即興重組）

以下全部是 POSIX 語法，**必須用 Bash 工具執行，不可用 PowerShell 工具**（`PYTHONPATH=. uv run ...` 這種 env 前綴在 PowerShell 5.1 是語法錯誤）。

### Backend（在 repo 根目錄跑，不是 backend/ 裡）

backend 套件用絕對 import（`from backend.models import ...`），必須讓 repo 根在 `PYTHONPATH` 上。

```bash
cd D:/System_Of_Speeching && uv sync                        # 裝依賴
cd D:/System_Of_Speeching && uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000  # 啟動 API（:8000，首跑建 DB + admin/password）
# 舊指令 `uv run python backend/main.py` 已失效（main.py 無 __main__/uvicorn.run 區塊，載入後直接結束）— 2026-07-07 驗證
```

pytest 和 httpx **不在**專案依賴裡，測試要臨時注入：

```bash
cd D:/System_Of_Speeching && PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/ -q 2>&1 | tail -40
# 單一測試：
cd D:/System_Of_Speeching && PYTHONPATH=. uv run --with pytest --with httpx pytest backend/tests/test_ws_manager.py::test_websocket_connection -q 2>&1 | tail -40
```

已知現狀（2026-07-05）：backend 測試 6 failed / 2 passed。失敗原因（缺 conftest fixtures、`backend/main.py:1634` 的 `manager` NameError）記錄在 architecture.md。改動前先跑一次基線，只對你改動相關的失敗負責，但不要讓基線變得更糟。

### Frontend（在 frontend/ 裡跑）

```bash
cd D:/System_Of_Speeching/frontend && npm run dev       # :5173，proxy 到 :8000
cd D:/System_Of_Speeching/frontend && npm run build     # tsc -b && vite build
cd D:/System_Of_Speeching/frontend && npm run lint
cd D:/System_Of_Speeching/frontend && npx vitest run    # 全套（目前 8/8 通過）
cd D:/System_Of_Speeching/frontend && npx vitest run src/pages/member/Dashboard.test.tsx  # 單檔
```

## 最容易踩的三個坑（完整清單在 architecture.md）

1. **雙身分系統**：員工（`User`，`/token`，`localStorage["token"]`，`src/api.ts`）和會員（`Member`，`/members/login`，`localStorage["member_token"]`，`src/memberApi.ts`）是兩套平行的認證與前端，共用同一個 JWT signer 但 payload 不同。加 endpoint 或前端頁面前先確認自己在哪一側，不可混用。
2. **models.py 的四層模式**：每個實體都是 `XBase` → `X(table=True)` → `XCreate/XUpdate/XRead`。加欄位要同時更新 Base 和該暴露它的 Create/Update/Read 變體，可見性不會自動繼承。
3. **庫存變動必配 InventoryLog**：進貨、出貨、退貨、盤點改 `Product.stock_quantity` 時一律成對寫入 `InventoryLog`，不可直接改數量。
