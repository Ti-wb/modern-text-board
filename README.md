# Modern Text Board｜現代文字手舉牌

`modern-text-board` 是一個為 iPhone、iPad 與筆電設計的純前端文字白板。除了 text board，也適合直接拿在手上當作 handheld sign、handheld board、接機牌、活動提示牌或無聲溝通板使用。

不需要帳號、API 或後端服務；文字、頁面與偏好只存在目前開啟的工作階段，重新整理或關閉頁面後會回到預設狀態。第一次成功載入並完成快取後，核心功能可以離線使用。

## 主要功能

- 文字排版：黑／白背景、四種系統字型、5–100% 畫面填滿程度、四種粗細、左／中／右對齊；文字碰到可用邊界時會自動縮小。
- 文字顏色：Basic、Neon、Pastel 色票、自訂 Hex 與自動對比；低對比時提示但不阻止套用。
- 展示效果：四向跑馬燈、約 24–600+ px/s 無段調速、柔和閃爍、文字鏡像，以及不清除設定的「暫停所有動態」。調速時會保留文字當下位置並平順加減速；重複文字預設相隔約半個畫面，前後兩段可同時出現並無縫接續。
- 本機 QR Code：可顯示文字或網址，內容可獨立於白板文字編輯，不會上傳至伺服器。
- 多頁白板：新增、複製、改名、拖曳排序、上移、下移、刪除與前後切換，最多 50 頁。
- 展示模式：先使用 CSS 展示模式，再漸進啟用瀏覽器 Fullscreen；可選擇在展示時保持螢幕常亮。
- PWA：可安裝、離線啟動、由使用者確認更新；介面支援繁體中文與 English。
- 鍵盤與觸控：焦點管理、44×44px 最小點擊區、畫布滑動換頁，且不禁止 pinch zoom。
- 浮動工具列：可在畫面中自由拖曳；閒置 10 秒後會以快速、平順的 transition 大幅降低透明度，互動時立即恢復。

## 使用方式

1. 在畫布空白處用滑鼠雙擊，或在觸控螢幕快速點兩下，即可編輯文字。
2. 編輯器保留換行與空白；按「套用」更新文字，按「取消」放棄草稿。
3. 使用浮動工具列切換主題、字型、顏色、對齊、粗體與跑馬燈；拖曳左側把手可自由移動工具列。
4. 在「更多」中設定鏡像、閃爍、QR Code、頁面、全螢幕展示與其他偏好。
5. 畫布左右滑動可快速切頁；頁面面板與鍵盤操作是完整的替代操作方式。

字型面板的「畫面填滿程度」會依實際文字區計算，而不是直接套用固定的 `vw`、`vh` 或像素值。設為 100% 時，短文字會盡量撐到安全邊界；文字變長、旋轉裝置、進入 Split View 或開啟 QR 後，會自動重新縮小以避免超出畫布。既有白板的像素設定會先保持原貌，調整新版滑桿後才改用百分比。

### 鍵盤快捷鍵

| 按鍵 | 功能 |
| --- | --- |
| `E` 或 `Enter` | 編輯文字 |
| `B` | 切換粗體 |
| `M` | 切換跑馬燈 |
| `F` | 進入／離開展示模式 |
| `Page Up` / `Page Down` | 上一頁／下一頁 |
| `Esc` | 關閉面板、取消編輯或離開展示 |
| `?` | 顯示快捷鍵說明 |
| 編輯時 `Cmd/Ctrl + Enter` | 套用文字 |

游標位於輸入欄位或文字編輯器時，全域字母快捷鍵會暫停，避免干擾輸入與中文 IME。

## RWD 與支援裝置

版面會依「可用寬度與高度」而不只依裝置名稱調整，因此也適用 iPad Split View、Stage Manager、手機橫向與軟鍵盤開啟時的畫面。

| 狀態 | 版面行為 | 常見情境 |
| --- | --- | --- |
| Compact：寬度小於 640px，或高度小於 520px | 工具列可自由拖曳，空間不足時可橫向捲動；面板改為全寬 bottom sheet | iPhone、窄 Split View、低高度手機橫向 |
| Regular：寬度至少 640px 且高度至少 520px | 浮動工具列可在畫面內自由拖曳；工具面板依位置選擇較有空間的一側 | iPad、筆電、桌面瀏覽器 |
| QR 容器至少 720px 且高度至少 420px | 文字與 QR 左右排列 | iPad／筆電寬版 |
| QR 容器較窄或高度不足 | 文字與 QR 上下排列 | 手機與窄視窗 |

畫布使用 dynamic viewport、safe-area 與 VisualViewport 資訊；工具列位置在目前工作階段以相對座標計算，旋轉裝置、Safari 工具列伸縮或軟鍵盤改變可用空間時會重新夾限在可視範圍。網站不鎖定方向，也不全域攔截觸控捲動。

## 本機開發

需求：Node.js 22 與 npm。

```bash
npm ci
npm run dev
```

常用指令：

```bash
npm run test       # Vitest 單元與元件測試
npm run test:e2e   # Playwright 瀏覽器測試
npm run perf:smoke # 對已啟動的 production preview 跑 compositor trace 診斷
npm run perf:accept # 60 秒／情境的 DPR 1–3 production 強制驗收矩陣
npm run build      # TypeScript 檢查與 production build
npm run check      # ESLint、Vitest、build 與初始 JS 150 KiB gzip 預算
```

`perf:smoke` 可用 `PERF_DPR=1|2|3`、`PERF_SCENARIO=short|large|max|whitespace|emoji`、`PERF_DIRECTION=left|right|up|down` 與 `PERF_FLASH=1` 組合測試。Headless Chromium 不會因 `PERF_REFRESH_HZ=120` 就模擬出 120Hz；120Hz／ProMotion 結論仍需在對應實機上驗收，工具會另外回報量測到的 cadence 是否符合期待值。

Trace 會要求穩態 Layout 為 0，並拒絕持續 Paint。Chromium 對接近實體 layer 上限的離屏文字，可能在重新進場時做一次 backing-store refresh；工具只容許單一、50ms 內且單事件不超過 4ms 的 isolated burst，並仍同時要求掉幀率、連續遺失 refresh slot、動畫重建與調速 controller 全部通過，不會把逐幀 repaint 視為合格。

第一次執行 E2E 前，請先安裝 Playwright 瀏覽器：

```bash
npx playwright install
```

Production 預覽：

```bash
npm run build
npm run preview
```

> Service Worker 預設只在 production build 註冊。若要驗證安裝、離線啟動或更新提示，請使用 `npm run build && npm run preview`，不要只使用 dev server。

## 專案結構

- `src/components/`：畫布、工具列、面板、編輯器、QR、頁面與通知 UI。
- `src/domain/`：型別、預設資料、限制與 reducer。
- `src/hooks/`：自動縮字與跑馬燈動態控制。
- `src/platform/`：Fullscreen、Wake Lock 與 PWA 瀏覽器能力封裝。
- `e2e/`：多尺寸、互動、離線與 Figma 視覺基準測試。
- `public/_headers`：Cloudflare Pages 的安全標頭與快取規則。

應用程式採 Preact、Vite、TypeScript、CSS Custom Properties、container queries 與 `useReducer`；沒有 Router、大型狀態庫、Tailwind 或伺服器端 runtime。

## 資料、限制與瀏覽器能力

- 每頁文字最多 350 個 Unicode code points；頁名最多 60 個；QR 內容最多 512 UTF-8 bytes。
- 至少保留一頁；內容不寫入 localStorage、IndexedDB 或任何遠端服務，重新載入後會重設。
- Fullscreen 與 Screen Wake Lock 都是漸進增強。Fullscreen 被拒絕時仍保留 CSS 展示模式；Wake Lock 不支援、權限遭拒或頁面進入背景時，不影響其他功能。
- Wake Lock 需要安全來源（HTTPS；localhost 僅供開發），並可能被作業系統省電策略釋放。頁面回到前景後會依偏好重新請求。
- PWA 更新採 prompt 模式；只有使用者確認後才重新載入。由於內容只存在目前工作階段，更新或重新整理會清除本次內容。

## Cloudflare Pages 部署

此專案是靜態 Vite 站點，不使用 Pages Functions、Wrangler runtime、資料庫或環境變數。

在 Cloudflare Pages 連接 Git repository 後設定：

| 設定 | 值 |
| --- | --- |
| Production branch | `main` |
| Framework preset | Vite（或 None） |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 留空（repository 根目錄） |
| Node.js | 22 |

`public/_headers` 會隨 build 複製到 `dist/_headers`，提供 CSP、Permissions Policy 與正確快取策略：只有帶內容雜湊的 `/assets/*` 長效快取；HTML、manifest 與 Service Worker 每次重新驗證。專案不需要 `_redirects`，也不應加入全域 SPA rewrite。

部署後建議確認：

1. HTTPS 頁面可以進入展示／全螢幕模式。
2. 啟用「保持螢幕常亮」後，只有在展示中且頁面可見時顯示為實際啟用。
3. 線上載入一次並看到「已可完整離線使用」後，飛航模式重新開啟仍能建立文字、換頁與產生 QR Code。
4. 發布新版本時先顯示更新提示；只有按下「更新並重新載入」才啟用新版。

## 隱私與網路

Production runtime 不載入第三方字型、分析工具或遠端資源。QR Code 在瀏覽器本機產生；專案也不會把白板內容上傳到任何服務。

## 授權

本專案以 [GNU General Public License v3.0 only](./LICENSE) 授權，SPDX identifier 為 `GPL-3.0-only`。散布本專案或其修改版本時，請依 GPLv3 保留授權聲明並提供對應原始碼；本軟體不提供任何擔保。
