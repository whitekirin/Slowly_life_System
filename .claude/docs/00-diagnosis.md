# Harness 診斷：三大漏洞與修法

> 寫於 2026-07-05（Fable 5 session）。這份是後面所有制度檔的依據。每一條都有本 session 內的實際證據，不是理論推測。
> 讀者：未來在此環境工作的任何 Claude 模型。

## 弱點一：最漏 token —— 主對話直接吞大量原始內容

**證據（本 session 實際發生）**：
- 用 `Glob("README.md")` 找專案 README，結果匹配到 376 個檔案，其中 375 個在 `frontend/node_modules/` 裡，全部列進了主對話 context。
- 直接 Read 了 895 行的 README.md 全文、900 行的 models.py，只為了取其中一小部分資訊。
- 在主對話跑完整測試套件，數十行的 traceback stderr 全部進 context。

**代價**：主對話 context 被一次性原始資料塞滿 → 後面的推理品質下降、session 提早需要壓縮、壓縮後遺失早期指令。

**修法（可立即執行）**：
1. **搜尋必排除**：任何 Glob/Grep 都要避開 `node_modules`、`.venv`、`dist`、`__pycache__`、`.backup`。Grep 用 `path` 參數鎖定 `backend/` 或 `frontend/src/`，不要從 repo 根搜。
2. **大量讀取派 Explore agent**：預估要讀超過 3 個檔案或超過 600 行才能回答的問題，派 `Explore` agent（read-only、便宜），只要結論和 `檔案:行號`。詳見 [model-dispatch.md](model-dispatch.md)。
3. **Read 帶 offset/limit**：知道要看哪段就只讀那段。看 class 清單用 `Grep pattern="^class "` 而不是讀全檔。
4. **測試輸出截尾**：跑測試一律 `| tail -40`（或 pytest 加 `-q`）。要完整 log 就重導到 scratchpad 檔案再挑著讀。

## 弱點二：最容易失焦 —— 產出物散落、工作狀態不落地

**證據（repo 現狀，是過去多個 AI session 累積的結果）**：
- Repo 根目錄躺著 `alter_db.py`、`check_db.py`、`fix_db.py`、`fix_member_db.py`、`fix_pointexchangerecord_db.py`、`test_email.py` 等一次性腳本——每次都是某個 session 的臨時工具，用完沒清，現在沒人知道哪個還有效。
- `git status` 有約 40 個 modified/untracked 檔案堆在 main branch 上未 commit，橫跨至少兩個大功能（會員系統、行銷模組）。任何一次誤操作或環境問題都可能讓數天的工作消失。
- 根目錄的 `main.py` 是一個只會 print hello 的殘留檔，和 `backend/main.py` 同名，已實際造成 import 混淆（`backend/test_attributes.py` 因此 import 失敗）。

**代價**：session 之間互相看不懂彼此的殘留物 → 重複勞動、誤刪有用的東西、或把垃圾當正典。

**修法**：
1. **臨時檔進 scratchpad**：一次性腳本、實驗、中間產物一律寫到系統提示裡給的 scratchpad 目錄，永不放 repo 根目錄。如果一個腳本值得留在 repo，它就值得有註解說明用途並放進合適的子目錄。
2. **多步驟任務要落地追蹤**：預估 3 步以上的工作，開工先列出步驟——環境有 task 工具（TaskCreate/TaskUpdate）就用它，沒有就在 scratchpad 開一個 todo 檔。session 中斷時這份清單就是交接文件。
3. **commit 紀律**：完成一個可驗證的單位就提議 commit（遵守「使用者要求才 commit」的規則——所以是*主動提議*，說明這次要 commit 什麼、為什麼）。看到工作樹堆積超過 20 個檔案未 commit，要主動向使用者提出。
4. **動手前查殘留**：要建新的輔助腳本前，先 Glob 一下是否已有同用途的殘留物，避免第 6 個 `fix_*.py`。

## 弱點三：最容易出錯 —— Windows 雙 shell 陷阱＋「未驗證就宣告完成」

**證據**：
- 本 session 中 Bash 的 cwd 因為前一個指令 `cd frontend` 而漂移，導致下一個 `head alter_db.py` 直接失敗。cwd 在 Bash 呼叫之間會殘留。
- 這台機器是 PowerShell 5.1 + Git Bash 雙 shell，語法互斥（PS 5.1 沒有 `&&`、預設 UTF-16 編碼；Bash 沒有 PS cmdlet）。混用是常態性錯誤來源。
- 過去的 session 留下了「宣告完成但實際壞掉」的成品：`backend/main.py:1634` 的 websocket handler 引用了未 import 的 `manager`（一跑就 NameError）；`backend/tests/` 裡兩個測試檔引用不存在的 pytest fixtures（沒有任何 conftest.py）；backend 測試套件目前 6 failed / 2 passed。這些都是「寫完沒跑過就交付」的直接證據。

**修法**：
1. **路徑絕對化**：所有 Bash 指令用絕對路徑，或每條指令都以 `cd D:/System_Of_Speeching && ...` 開頭。永不依賴上一條指令留下的 cwd。
2. **一條指令一種 shell**：POSIX 語法用 Bash 工具，PS cmdlet 用 PowerShell 工具，不在同一條指令裡混。經過驗證的標準指令已寫在 CLAUDE.md，直接抄，不要即興重組。
3. **完成的定義是「驗過」不是「寫完」**：改了程式 → 跑對應測試或實跑該流程（有 `/verify` skill 可用）；改了檔案 → read-back 關鍵段落；改了設定 → 執行一次會用到該設定的操作。判準與範例見 [judgment.md](judgment.md) 的「何時算真的完成」。
4. **驗收不自驗**：重要交付的驗收派 fresh-context agent 做，因為寫的人會沿用自己的錯誤假設。機制見 [model-dispatch.md](model-dispatch.md) 的「驗證不自驗」。

## 教訓記錄（後續 session 依 maintenance.md 追加）

- [2026-07-05] 建檔。以上三條為初始基線。
