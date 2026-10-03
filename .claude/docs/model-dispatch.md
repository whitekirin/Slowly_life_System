# 模型調度守則

> 讀者：主對話裡的任何 Claude 模型（預期通常是 Sonnet）。所有規則在 Sonnet 等級可執行。
> 派工 prompt 的具體模板在 [delegation-templates.md](delegation-templates.md)，判斷類問題（該不該升級等）在 [judgment.md](judgment.md)。

## 0. 成本前提

這個方案上 spawn subagent 是昂貴路徑：每個 agent 冷啟動、要重新建立 context。所以原則是——**該省的省在「不派小事」，該花的花在「大量讀取不進主對話」**。使用者已明確授權以下的委派模式（2026-07-05），不需再逐次請示。

## 1. 指揮官不下場（何時委派 vs 自己做）

**必須委派**（主對話只進結論，不進原始資料）：

| 任務型態 | 派給 | 理由 |
| :--- | :--- | :--- |
| 掃 repo／跨多檔搜尋（預估讀 >3 檔或 >600 行） | `Explore`（內建，read-only） | 原始內容不進主對話 |
| 網頁研究、查文件（>1 個來源） | `general-purpose` 或 `claude-code-guide`（Claude Code 相關問題） | 網頁內容極耗 token |
| 批次改檔（>5 個檔案的機械性修改） | `general-purpose`，model 見下表 | 大量 diff 不進主對話 |
| 重要交付的驗收 | `verifier`（自訂，見 §5） | 驗證不自驗 |
| 高風險／品味判斷的第二意見 | `arbiter`（自訂，見 §5） | 需要更強模型＋fresh context |

**自己做**（派工反而虧）：
- 已知確切位置的單檔讀取或修改
- 3 步以內、不需探索的小任務
- 對使用者的溝通、決策、計畫

判斷不準時的粗判準：**「這個任務的中間產物需要進主對話嗎？」** 需要 → 自己做；只需要結論 → 委派。

## 2. 派工三件套（每個派工 prompt 必含）

1. **目標與動機**：要做什麼＋為什麼（agent 是冷啟動的，不知道你的上下文；動機讓它在意外情況下做出正確取捨）。
2. **驗收條件**：可客觀檢查的完成判準（「測試 X 通過」「回傳的每個結論附檔案:行號」），不是「做好一點」。
3. **回報格式**：明確規定回什麼、多長（見 §4 回報合約）。

缺一件就不要送出。模板見 delegation-templates.md。

## 3. 模型與 effort 顯式指定

本環境實際可用（2026-07-05 查證於官方文件）：

- **Agent tool 的 `model` 參數**：`haiku` / `sonnet` / `opus` / `fable`。派工時傳入的參數**優先於** agent 定義檔的 frontmatter。
- **effort**：只能在 agent 定義檔（`.claude/agents/*.md`）的 `effort` frontmatter 設定，合法值 `low` / `medium` / `high` / `xhigh` / `max`。已建好 `verifier`（sonnet + high）與 `arbiter`（opus + xhigh）。
- **fallback**：自訂 agent 在 session 啟動時載入。若可用 agent 清單裡沒有 `verifier`/`arbiter`（例如你自己是 subagent，或載入失敗），改派 `general-purpose` ＋ 對應的 `model` 參數，並把 `.claude/agents/verifier.md`（或 arbiter.md）frontmatter 以下的規則全文貼進 prompt。效果等價，只是少了 effort 控制。
- **fable**：視為稀缺資源，日常不指定；只有使用者明說時才用。

預設路由表：

| 任務 | model | 備註 |
| :--- | :--- | :--- |
| 機械性批次套用（模式已驗證過） | `haiku` | 先在 1-2 個檔案上用 sonnet 驗證模式，再降級批跑 |
| 搜尋／探索 | `Explore` 內建（不指定 model） | 呼叫時註明 quick / medium / very thorough |
| 標準實作、重構、除錯 | `sonnet` | 預設工作馬 |
| 架構設計、難題、跨模組大改的計畫 | `opus`（或 `Plan` agent） | 先要計畫再要實作 |
| 驗收 | `verifier`（自帶 sonnet+high） | |
| 第二意見／品味裁決 | `arbiter`（自帶 opus+xhigh） | |

## 4. 回報合約

寫進每個派工 prompt 的固定條款（模板已內建）：

- 只回**結論**與**證據指標**（`檔案:行號`），不要貼大段原始碼或網頁全文。
- 超過 30 行的產物（報告、log、清單）寫成檔案，回傳路徑。程式碼修改直接改在工作樹，回報改了哪些檔、每檔一句話。
- 回報上限 400 字（不含路徑清單）。發現超出任務範圍的問題：一句話記錄，不要擅自處理。
- 失敗就明說失敗＋卡在哪，不要交出「大概可以」的半成品。

## 5. 升降級路徑

- **haiku 錯一次 → 直接升 sonnet**。不給 haiku 第二次機會，重試的 spawn 成本比升級省下的模型差價貴。
- **sonnet 同一個子任務連錯兩次 → 升 opus**，並附上**完整失敗軌跡**（兩次的 prompt、輸出、錯在哪），讓 opus 不重蹈覆轍。
- **opus 也解不了 → 停，問使用者**。附三樣：試過什麼、卡在哪、你建議的下一步。不要第三次重試。
- **降級**：sonnet/opus 解出一個可重複的模式（例如「這類頁面都要這樣改」）後，把模式寫成明確步驟，降給 haiku 批次套用，並抽查 2 個結果。
- **重試上限**：**同一個模型內**同一件事最多兩輪，升級換模型後計數重置（所以整條升級鏈最多 haiku 1 次 + sonnet 2 次 + opus 2 次）。第二輪必須改變做法（換拆法或換路），禁止原樣重跑——原樣重跑等於承認自己在賭。

## 6. 驗證不自驗

寫的人會沿用自己的錯誤假設，所以**驗收永遠給 fresh-context 的 agent 或客觀機制**：

| 產物 | 驗法 |
| :--- | :--- |
| 檔案／文件 | read-back：重新讀取關鍵段落確認落地且內容正確（這個可以自己做，因為是機械性檢查） |
| 程式碼 | 跑測試或實跑該流程（`/verify` skill）；重要改動再派 `verifier` 對照驗收條件逐條檢查 |
| 高風險判斷（架構決策、刪東西、對外動作） | 派 `arbiter` 出第二意見；或產出 2-3 個候選方案讓 arbiter 評審選優 |
| 制度檔修改 | 派 fresh `verifier` 找矛盾與弱模型會誤讀的語句（maintenance.md 有規定） |

驗收 agent 的 prompt 只給「驗收條件＋產物位置」，**不給**實作過程的敘述——避免污染它的判斷。

## 教訓記錄（後續 session 依 maintenance.md 追加）

- [2026-07-05] 建檔。
- [2026-07-05] fresh-context Sonnet 對抗審查在建檔當天就抓到 6 個問題（規則矛盾、對 subagent 不可見的工具引用、shell 綁定模糊）→ 制度檔動了規則本體後的對抗審查（maintenance.md §2 第 4 步）不可省略。
