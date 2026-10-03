# 慢生活製造所 Design System（員工後台）

2026-09-28 起的員工後台風格。改版前的樣子記錄在 `docs/ui-style-before-slowlife.md`。
一鍵退回：`bash scripts/ui-revert-slowlife.sh`（加 `--no-deploy` 只還原檔案）。

## 檔案

| 檔案 | 內容 |
| --- | --- |
| `frontend/src/theme/slowlife.ts` | Design token（`sl` 物件）＋ antd `ThemeConfig`。**頁面要用顏色一律從 `sl` 拿** |
| `frontend/src/theme/slowlife.css` | 版面（Sidebar／Header／內容區）、字體階層、空狀態、Dashboard、登入頁、手機版 |
| `frontend/src/theme/SlowLifeTheme.tsx` | 包住 `/login`、`/reset-password`、`/*`（員工後台）的 ConfigProvider＋`zh_TW` locale＋空狀態 |
| `frontend/src/theme/EmptyState.tsx` | 溫暖空狀態（線性收納盒插圖） |
| `frontend/src/App.tsx` | `ROUTE_META`：每個路由的選單 key、分組、Header 顯示的頁名與一句話說明。**新增頁面時要一起加** |

會員前台（`MemberTheme`）不吃這套。LIFF（`LiffTheme`，LINE 內的頁面）從 2026-10-03 起用同一組顏色與字體，版面 class 是 `.sl-liff-*`（基準字級 `--liff-fs` 跟著手機寬度）。

### LINE 介面

- 圖文選單的圖由 `backend/line_menu_render.py` 用 Pillow 即時畫（容器裝 `fonts-noto-cjk`）：米白底紙卡、名稱第一個字的圓章、襯線標題、分組主色短線；「全部功能」是品牌棕反白卡。
- 分組可選的 8 個色票在 `backend/line_menu_config.py` 的 `PALETTE`：`accent`（白字放上面 ≥4.5:1）、`tint`（淡底）、`ink`（放在 tint 上的字 ≥6.6:1）。新增色票前先量對比度。
- 名稱、副標、顏色、順序、開關在後台「設定 → LINE 介面設定」（`pages/LineMenuSettings.tsx`）調整；誰看得到哪個功能照系統權限。
- LINE 內的頁面要同時顧到手機與平板：版面一律用 `.sl-liff` 的寬度決定（container query、`repeat(auto-fit, minmax(…))` 格線），不分裝置寫死。首頁分組卡手機一欄、平板兩到三欄。
- 從 LINE 開進後台頁（`/liff/go`，`isLiffMode()`）時，寬度 1200 以下側欄預設收合。
- 從 LINE 開啟時的「建立／編輯採購單」彈窗（`PurchaseOrderList.tsx` 的 `lineCls()`）：全螢幕、分區卡片、`.sl-liff-grid` 把 Row/Col 換成 auto-fit 格線（窄手機一欄、平板三到五欄）、款式卡並排、試算是數字方塊、取消／建立固定在底部、輸入框字級至少 16px（iOS 才不會自動放大）。電腦上維持原本的彈窗。原本 LINE 的「填寫進貨單」已於 2026-10-03 移除。
- 各管理頁的頁首（標題＋工具列）加 `className="sl-page-head"`，窄畫面時工具列自動換行，新頁面請沿用。
- 表格：`theme/useResponsiveTables.ts`（App 掛一次）把表頭文字標到每格的 `data-label`；內容區 ≤640px（彈窗、抽屜看視窗寬度）時 `.sl-table-cards` 把每列排成卡片，不用左右滑。多層表頭、樹狀表格維持原樣。新表格不用額外處理。
- 寫死 `span` 的 `<Col>`（彈窗、抽屜、內容區）：手機上 1/3 以下的欄位一列兩個、較寬的獨佔一列；平板上 1/6 以下放大成一列三個。要自己控制就寫 `xs`／`sm`。
- 只在寬畫面有用的東西（例如表單上方的欄名列）加 `className="sl-hide-narrow"`。

## 色彩

| 角色 | 值 |
| --- | --- |
| 背景 | `#F5EFE6`（主）、`#FDF6EC`（柔） |
| 表面 | `#FFFDF8` / `#FCF8F1` / `#F8F3EA` |
| 品牌棕（主按鈕、active、連結、focus） | `#8B6545`（hover `#A07A57`、深 `#5E4330`、淡底 `#F1E6D6`） |
| 墨綠（正常、完成、成功） | `#4F6B58`／淡底 `#E6EEE6` |
| 暖橘（不足、待處理） | `#B98035`／淡底 `#F7EAD3`／字 `#7A5427` |
| 磚紅（錯誤、缺貨、負數） | `#B25B4C`／淡底 `#F6E3DD` |
| 文字 | `#3E352D` 主（11.8:1）、`#66594C` 次（6.7:1）、`#786A5A` 三級（5.2:1，放在背景上 4.6:1）、`#968877` placeholder（3.4:1） |
| 圖示 | 選單 `#6E6052`（5.6:1，比選單文字 `#554A3F` 淺一階）；棕 `#6E5238`／綠 `#45604E`／橘 `#7A5427` 放在各自淡底上都約 5.7:1 |
| 線 | `#E3D9CB` 邊框、`#EFE8DD` 分隔 |
| 圖表 | `#8B6545` → `#4F6B58` → `#B07F45` → `#8E8171`（都 ≥ 3.4:1） |

antd 的 preset 色（`<Tag color="green">` 等）已在 token 裡把種子色調成低飽和，所以既有頁面的 Tag 不用改。

## 對比原則（2026-09-28 調整）

文字 ≥ 4.5:1（placeholder 例外，約 3.4:1）；圖示與插圖線條 ≥ 3.5:1。圖示比旁邊的文字淺一階就好，不要差太多。三張統計卡的圖示放在淡底上統一約 5.7:1。新增顏色前可以先量對比度。

## 字體與階層

- UI：Noto Sans TC；標題：Noto Serif TC（Google Fonts，`index.html` 載入）
- 頁面標題（各頁 `<Title level={2}>`）自動套 serif 26px；區塊標題 serif 17–20px；內文 14px；說明 12.5–13px

## 動態尺寸（跟著視窗大小）

- **基準字級** `fs`：`theme/useViewport.ts` 的 `fluidFontSize()` 依視窗寬度決定。手機 14；桌面 1024 為 13、1440 為 14、1920 為 15、2560 為 16，最大 17。
  `SlowLifeTheme` 用 `buildSlowlifeTheme(fs)` 產生 antd 主題，控制項高度、表格 padding、選單高度、Card、Modal 標題等都依 `fs` 等比例推出。
  同時把 `--sl-fs` 寫到 `.slowlife` 和 `body` 上，CSS 裡的自訂文字一律寫成 `calc(var(--sl-fs) * 比例)`，**不要再寫固定 px 字級**。
- **間距**：內容區外距、內距、圓角、`--sl-gap` 都用 `clamp(最小, vw, 最大)`，隨視窗連續變化。
- **側欄寬度**：`fluidSiderWidth()`，約為視窗的 15%，介於 208～280px。
- **格線**：`.sl-surface` 是 container（`container-type: inline-size`）。總覽的卡片依「內容區實際寬度」排版：4 欄 → 2 欄（≤ 900px）→ 1 欄（≤ 440px），收合側欄也會重排。
- **保護**：各頁寫死 `width` 的輸入框、下拉、日期選擇器加了 `max-width: 100%`；Modal 不超出視窗；表頭不換行，表格太寬時橫向捲動。
- `useViewport(select)` 只有在算出來的值改變時才重繪，拖拉視窗不會讓整個 App 每一幀都 re-render。

## 圓角／陰影

按鈕、輸入 10px；卡片 16px；Modal 16px；內容大容器 20px。陰影 `0 2px 12px rgba(80,60,40,.05)`。

## 狀態徽章（自訂頁面用）

`<span className="sl-badge sl-badge--done|pending|warn|error|info">文字</span>`

## 尚未做的（下一輪可以做）

- 手機版表格改卡片式（目前是橫向捲動）
- 各頁內部的表單分區、Drawer 重構（這輪只換了外觀，沒改各頁的操作流程）
- Dashboard 的銷售趨勢與近期訂單還是原本的範例資料（後端沒有對應 API）
