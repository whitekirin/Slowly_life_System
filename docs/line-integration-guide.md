# LINE 通知整合使用說明書

> 適用對象：系統管理者、負責申請 LINE 官方帳號的人。
> 本文件說明如何啟用「員工個人綁定 LINE、進貨/出貨事件推播通知」功能。

## 1. 前言

系統目前支援：

- 員工在「個人設定」頁面自行綁定自己的 LINE 帳號（走 LINE Login，不需要密碼，也不會取得你的 LINE 聊天內容）。
- 綁定後，以下兩種事件會自動推播文字訊息到該員工的 LINE：
  - **採購單狀態變成「已到貨」**（進貨完成）
  - **銷貨單狀態變成「已出貨」**（出貨完成）
- 每個員工只會收到「自己觸發的那筆單」的通知（例如誰把採購單標記為已到貨，就通知誰）。
- 會員（電商前台）端目前**尚未實作**，只保留了資料庫欄位與可重用的服務層，供未來擴充（見第 11 節）。

在正式使用前，你需要先申請一個 **LINE Developers** 帳號並建立兩個 Channel。如果你完全沒碰過 LINE Developers 後台，請照著第 2-4 節一步步做。

**在你完成申請、填好設定之前，系統會自動以「模擬推播」模式運作**——所有其他功能完全不受影響，只是不會真的送出 LINE 訊息（見第 5 節 `LINE_SUPPRESS_SEND`）。

---

## 2. 申請 LINE Developers 帳號、建立 Provider

1. 前往 LINE Developers Console（用瀏覽器搜尋「LINE Developers」，或用你現有的 LINE 帳號登入 `developers.line.biz`）。
2. 用你的個人 LINE 帳號（或公司用的 LINE 帳號）登入。第一次登入會要求填寫開發者資料（姓名、Email），填完即可。
3. 登入後，點選「Create a new provider」（建立新的 Provider）。
   - Provider 可以想成是「公司/組織」這一層，之後你在同一個 Provider 底下建立的所有 Channel 才能互相搭配使用。
   - Provider 名稱可以填公司名稱，例如「你的公司名稱」。
4. 建立完成後，你會進入這個 Provider 的管理頁面，接下來要在裡面建立**兩個 Channel**（第 3、4 節）。

---

## 3. 建立 LINE Login Channel（給員工「綁定」用）

這個 Channel 負責「員工在系統裡按下綁定 LINE 時，跳出 LINE 授權頁面」這件事。

1. 在剛剛建立的 Provider 頁面裡，點選「Create a new channel」。
2. Channel 類型選擇 **LINE Login**。
3. 依序填寫：
   - Channel name（頻道名稱）：例如「XX公司 員工系統綁定」
   - Channel description：隨意填寫
   - App types：勾選 **Web app**
4. 建立完成後，進入這個 Channel 的設定頁面，切到 **Basic settings** 分頁，你會看到：
   - **Channel ID**：一串數字，等一下要填進 `.env` 的 `LINE_CHANNEL_ID`
   - **Channel secret**：點「Issue」或直接顯示，這個是機密資訊，等一下要填進 `.env` 的 `LINE_CHANNEL_SECRET`
5. 切到 **LINE Login** 分頁，找到 **Callback URL** 欄位，填入：
   ```
   http://localhost:8000/line/callback
   ```
   如果你之後把系統部署到正式主機（有網域名稱），要改成你正式環境的網址，例如 `https://your-domain.com/line/callback`，**並且要跟 `.env` 裡的 `LINE_LOGIN_CALLBACK_URL` 完全一致**，否則綁定會失敗。
6. 確認開啟的 Scope（權限範圍）包含 `profile`（讀取顯示名稱與 userId）；`openid` 通常預設就有。

---

## 4. 建立 Messaging API Channel（給系統「推播」用）

這個 Channel 負責「系統主動發訊息給已綁定的員工」這件事，**必須跟第 3 節的 LINE Login Channel 建立在同一個 Provider 底下**，否則系統無法把兩者關聯起來。

1. 回到同一個 Provider 頁面，再點一次「Create a new channel」。
2. Channel 類型選擇 **Messaging API**。
3. 填寫基本資料（Channel name、Channel description、Category、Subcategory 等，隨意填寫即可，不影響功能）。
4. 建立完成後，進入 Channel 設定頁面：
   - 切到 **Basic settings** 分頁，找不到 Channel Access Token 沒關係，這個 Channel 也會有自己的 Channel ID/Secret，但這次系統不需要用到它們。
   - 切到 **Messaging API** 分頁，往下捲動找到 **Channel access token**，點選「Issue」核發一組長效 Token。
   - 這組 Token 就是要填進 `.env` 的 `LINE_MESSAGING_ACCESS_TOKEN`，**請妥善保管，不要外流**（等同於可以用你的官方帳號名義發訊息的密碼）。
5. **加自己的官方帳號好友**：在同一個「Messaging API」分頁最上方會看到一個 QR Code，用你自己的 LINE 掃描加入好友。**這一步是必要的**——LINE 規定官方帳號只能推播訊息給已經加好友的人，就算員工在系統裡完成綁定，如果沒加好友，還是收不到推播。
6. 建議關閉「自動回應訊息」「加入好友歡迎訊息」等預設互動功能（在 **Messaging API** 分頁的 **LINE Official Account features** 區塊可以連到 LINE Official Account Manager 關閉），因為這個帳號只用來單向推播通知，不需要跟員工互動聊天。

---

## 5. 設定 `.env`

1. 在專案根目錄（`D:/System_Of_Speeching`）把 `.env.example` 複製一份成 `.env`：
   ```bash
   cp .env.example .env
   ```
2. 打開 `.env`，逐項填入：

   | 欄位 | 填什麼 |
   |---|---|
   | `LINE_CHANNEL_ID` | 第 3 節 LINE Login Channel 的 Channel ID |
   | `LINE_CHANNEL_SECRET` | 第 3 節 LINE Login Channel 的 Channel secret |
   | `LINE_LOGIN_CALLBACK_URL` | 跟第 3 節第 5 步填的 Callback URL 完全一致，本機測試維持預設值 `http://localhost:8000/line/callback` 即可 |
   | `LINE_MESSAGING_ACCESS_TOKEN` | 第 4 節核發的 Channel access token |
   | `LINE_SUPPRESS_SEND` | 設定都填好、也加好友之後，改成 `false` 才會真的推播。維持 `true` 則系統照常運作，但只會把訊息寫進 `line_delivery.log`，不會真的發送 |
   | `FRONTEND_BASE_URL` | 前端網址，本機測試維持預設值 `http://localhost:5173` 即可 |

3. 存檔後**重新啟動後端**（`.env` 只在啟動時讀取一次，改完要重啟才會生效）。

`.env` 已加進 `.gitignore`，不會被提交到版本控制，金鑰外流風險較低，但仍建議不要把這個檔案分享給不需要的人。

---

## 6. 啟動方式

跟平常一樣啟動即可，不需要額外指令：

```bash
cd D:/System_Of_Speeching && uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
cd D:/System_Of_Speeching/frontend && npm run dev
```

首次啟動時，系統會自動建立新增的資料表（`userlinebinding`、`lineoauthstate`），不需要手動跑 migration。

---

## 7. 員工如何在系統內綁定 LINE

1. 登入系統後，點右上角使用者選單 →「個人設定」。
2. 切到「**LINE 通知**」分頁。
3. 尚未綁定時，畫面會顯示「尚未綁定 LINE」與一個「綁定 LINE」按鈕，點下去。
4. 會跳出一個新視窗，導向 LINE 的授權頁面，用手機或已登入的 LINE 帳號完成授權。
5. 授權成功後，視窗會顯示「LINE 帳號綁定成功」，可以把該視窗關閉，回到原本的分頁——分頁會自動偵測到綁定完成並更新畫面（最多等待 5 分鐘，通常幾秒內就會更新）。
6. 綁定完成後，畫面會顯示已綁定的 LINE 顯示名稱與綁定時間，並提供「解除綁定」按鈕。

**注意**：如果員工還沒有加官方帳號好友（第 4 節第 5 步），即使綁定成功，也收不到任何推播訊息（這是 LINE 平台的規定，不是系統的 bug）。

---

## 8. 會收到的通知範例

**進貨完成**（採購單狀態變成「已到貨」時）：

```
[進貨完成通知]
採購單編號：PO-25
供應商：Test Supplier
總金額：100.0
狀態已更新為「已到貨」
```

**出貨完成**（銷貨單狀態變成「已出貨」時）：

```
[出貨完成通知]
銷貨單編號：SO-11
狀態已更新為「已出貨」
```

---

## 9. 解除綁定 / 換帳號重新綁定

- 在「個人設定」→「LINE 通知」分頁按「解除綁定」，會清除綁定紀錄，之後不會再收到推播。
- 如果要換成別的 LINE 帳號，直接再按一次「綁定 LINE」重新走一次授權流程即可，不需要先解除綁定——系統會自動把綁定對象換成最新授權的那個 LINE 帳號。
- 如果同一個 LINE 帳號被綁定到員工 A，之後又拿去綁定員工 B，系統會自動把原本 A 的綁定移除，改綁到 B（一個 LINE 帳號同時只能綁定一位員工）。

---

## 10. 疑難排解

| 現象 | 可能原因 |
|---|---|
| 按下「綁定 LINE」後，LINE 頁面顯示「用戶端 ID 無效」 | `.env` 的 `LINE_CHANNEL_ID` 沒填或填錯，記得改完 `.env` 要重啟後端 |
| LINE 授權完成後顯示「向 LINE 驗證身分時發生錯誤」 | 通常是 `LINE_CHANNEL_SECRET` 填錯，或 Callback URL 跟 LINE Login Channel 後台設定的不一致 |
| 綁定成功，但完全收不到推播訊息 | 1) 檢查 `.env` 的 `LINE_SUPPRESS_SEND` 是不是還是 `true`；2) 檢查是否已經用該 LINE 帳號加官方帳號好友（第 4 節第 5 步）；3) 檢查 `LINE_MESSAGING_ACCESS_TOKEN` 是否為第 4 節那個 Messaging API Channel 核發的，而不是誤填成 LINE Login Channel 的 Channel secret |
| 授權頁面顯示連結已過期 | 綁定連結 10 分鐘內沒完成授權會失效，回到系統重新按一次「綁定 LINE」即可 |
| 想確認推播有沒有真的被呼叫 | 看專案根目錄的 `line_delivery.log`，每次推播（不管成功、失敗、或跳過）都會記一行 |
| 建立銷貨單時直接把狀態設成「已出貨」不會收到推播 | 既有行為，只有「先建立、之後再把狀態改成已出貨」才會觸發推播，這次沒有一併修正這個落差 |

---

## 11. 未來擴充：會員端

目前 `Member`（會員）資料表已經保留 `line_id`、`social_provider`、`social_id` 欄位，但**尚未實作**任何綁定或推播邏輯。未來若要讓會員也能收到 LINE 通知（例如訂單出貨通知），可以：

1. 沿用同一個 LINE Login Channel（不需要重新申請）。
2. 比照 `backend/line_router.py` 的 `state` 驗證模式，另外設計一套給會員用的綁定端點。
3. 推播邏輯可以直接重用 `backend/line_utils.py` 的 `push_line_message_sync()`，它只認 LINE userId 字串，不關心呼叫者是員工還是會員。
4. `Member.line_id` 目前是「使用者自己填寫、未經驗證」的純文字欄位，語意上不同於這次員工端「OAuth 驗證過」的綁定資料，建議會員端要做的話也走 OAuth 驗證，不要繼續沿用 `line_id` 這個舊欄位。
