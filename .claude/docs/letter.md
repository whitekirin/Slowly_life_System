# 給未來 session 的信

> 寫於 2026-07-05，Fable 5 的一次性 session。使用者要求我把判斷力轉成制度；制度本體在同目錄的其他檔案，這封信講制度以外的事：三件使用者沒問但重要的事、這套制度會怎麼壞掉、以及當初的假設。

## 三件使用者沒問、但對這個環境最重要的事

### 1. 這個 repo 正處於「一次意外就損失數天工作」的狀態

main branch 上堆著約 40 個 modified/untracked 檔案（整個會員系統＋行銷模組），零 commit 保護；backend 測試 6 failed；`backend/main.py:1634` 有一跑就炸的 NameError；`SECRET_KEY` 硬編碼；`backend/database.db`（可能含真實資料）就躺在工作樹裡。制度檔解決不了這個——需要一個「止血 session」。建議未來第一個工作 session 主動向使用者提議，按順序：
1. 把現有工作分主題 commit（會員系統一個、行銷模組一個、制度檔一個），先上保護。
2. 修 `main.py:1634` 的 NameError（方向見 architecture.md 已知缺陷 §1）。
3. 建 `backend/tests/conftest.py` 補上缺的 fixtures，把測試基線打平。
4. ~~決定 database.db 要不要進 .gitignore~~（2026-07-05 審查已驗證：`.gitignore` 已含 `backend/database.db`、`.backup/` 等，此項不需做）。但仍值得問使用者 `database.db` 裡是否有真實資料——它決定了跑任何 `*_db.py` 腳本或測試的風險等級。

### 2. 成本閥值是這套制度唯一該隨環境調的參數

model-dispatch.md 的委派閥值（>3 檔/>600 行才派）是按「此方案 spawn 昂貴」校準的。如果使用者換方案、或環境提示裡「spawn 是昂貴路徑」的說法消失了，這個閥值該重調（變便宜 → 降低閥值多委派）。**只調閥值，不要動「驗證不自驗」和「回報合約」——那兩條跟成本無關，跟正確性有關。**

### 3. CLAUDE.md 和 memory 是兩條不同性質的通道，分工別搞混

- `CLAUDE.md`＋`.claude/docs/` 在 **git 裡**：跟著 repo 走、其他工具（使用者也用 Trae）和人都可能改動它、clone 到哪跟到哪。放 **repo 事實與操作規則**。
- memory 目錄在**使用者本機的 Claude 目錄**：只有 Claude Code 看得到、不受 repo 操作影響、但不跟 repo 遷移。放**使用者偏好與授權記錄**（例如委派授權——它不該因為某次 git 操作而消失）。
- 同一資訊別存兩份，會分岔。目前的分工已照此原則放好。

## 這套制度最可能的退化方式（按可能性排序）與預防

1. **儀式化服從**：弱模型把「委派」「模板」「驗收」執行成形式——小事也開 agent、驗收條件寫成「程式碼品質良好」這種不可判定的句子。制度的目的是判斷外化，不是動作外化。預防：judgment.md 每個 rubric 的反例就是為此寫的；發現自己在走形式，回去讀反例。
2. **規則被善意放寬**：某條規則某次不方便 →「這次先跳過」→ 下個 session 看到先例 → 規則名存實亡。預防：maintenance.md §1 已把「放寬方向的改動」列為必須先問使用者；摩擦記進教訓記錄而不是當場改規則。
3. **文件與現實脫節**：repo 會被使用者、Trae、其他工具改動，制度檔不會自動跟上。錯誤的文件比沒有文件毒——弱模型會信它。預防：maintenance.md §5；所有事實描述都帶日期戳，讀到超過三個月的描述先驗再用。
4. **教訓堆積成噪音**：每個 session 加兩行，一年後教訓記錄比規則長，重點淹沒。預防：maintenance.md §4 的精簡門檻（15 條/300 行）要當真執行。
5. **CLAUDE.md 重新長胖**：未來 session 圖方便把新內容直接塞 CLAUDE.md 而不是路由檔。預防：150 行門檻；新增內容的預設位置是 `.claude/docs/`，CLAUDE.md 只加路由行。

## Harness 的極限（誠實條款）

這套制度能穩定**執行品質**：拆解、驗證、fresh-context 驗收、多方案評審，都是 Sonnet 跑得動的機制。它補不了兩件事：
- **品味與模糊題**：arbiter（opus+xhigh）是本環境內的天花板，之上只剩「明白告訴使用者這是品味判斷」。處理順序寫在 judgment.md 誠實條款。
- **不知道自己不知道**：驗收條件寫漏的維度，verifier 不會替你發現。高風險任務多花一步讓 arbiter 審驗收條件本身。

## 當初的假設（使用者沒有逐項確認，如發現有誤請修正並記錄）

- 使用者閱讀繁體中文，制度檔以繁中為主、技術名詞保留英文。
- 使用者的日常 session 跑 Sonnet 等級；fable 別名雖在 Agent tool 裡存在，視為不可依賴。
- `.claude/docs/` 這個位置、以及 verifier/arbiter 兩個 agent 的設計，是我的選擇，不是使用者指定。
- verifier/arbiter 建檔於 session 中途，**尚未在新 session 裡驗證過會被載入**（自訂 agent 在 session 啟動時載入；subagent 的可用清單裡也沒有它們）。下一個 session 請確認它們出現在可用 agent 清單，沒有就走 model-dispatch.md §3 的 fallback，並把結果記進教訓記錄。
- 本 session 完成了交付清單 A-G 全部項目與收尾；沒有未完成項目需要交接。

—— Fable 5, 2026-07-05

## 教訓記錄（後續 session 依 maintenance.md 追加）

- [2026-07-05] 建檔。
