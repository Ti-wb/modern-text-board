# Modern Text Board｜現代文字手舉牌

`modern-text-board` 是一個為 iPhone、iPad 與筆電設計的純前端文字白板。除了 text board，也適合直接拿在手上當作 handheld sign、handheld board、接機牌、活動提示牌或無聲溝通板使用。

所有文字、頁面與偏好都留在目前瀏覽器；不需要帳號、API 或後端服務。第一次成功載入並完成快取後，核心功能可以離線使用。

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
npm run build      # TypeScript 檢查與 production build
npm run check      # lint、測試與 build 完整 gate
```

Production 預覽：

```bash
npm run build
npm run preview
```

> Service Worker 預設只在 production build 註冊。若要驗證安裝、離線啟動或更新提示，請使用 `npm run build && npm run preview`，不要只使用 dev server。

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

`public/_headers` 會隨 build 複製到 `dist/_headers`，提供 CSP、Permissions Policy 與正確的快取策略：只有帶內容雜湊的 `/assets/*` 長效快取；HTML、manifest 與 Service Worker 每次重新驗證。專案不需要 `_redirects`，也不應加入全域 SPA rewrite。

部署後請確認：

1. HTTPS 頁面可以進入展示／全螢幕模式。
2. 啟用「保持螢幕常亮」後，只有在展示中且頁面可見時顯示為實際啟用。
3. 線上載入一次並看到「已可離線使用」後，飛航模式重新開啟仍能編輯與產生 QR Code。
4. 發布新版本時先顯示更新提示；只有按下「更新並重新載入」才啟用新版，不會自動中斷目前內容。

## 瀏覽器能力與資料說明

- Fullscreen 與 Screen Wake Lock 都是漸進增強。Fullscreen 被拒絕時仍保留 CSS 展示模式；Wake Lock 不支援、權限遭拒或頁面進入背景時，不影響白板其他功能。
- Wake Lock 需要安全來源（HTTPS；localhost 僅供開發），並可能被作業系統的省電策略釋放。頁面回到前景後會依使用者偏好重新請求。
- 資料只保存在目前瀏覽器／安裝的 Web App。Safari 分頁與加入主畫面的 Web App 可能使用不同儲存空間；清除網站資料也會移除內容。重要資料請定期匯出 JSON 備份。
- PWA 更新採 prompt 模式。套用新版前，呼叫端可透過 `beforeApplyUpdate` 先同步保存尚未寫入的內容。

## 平台模組

- `src/platform/fullscreen.ts`：CSS 展示模式、原生 Fullscreen 漸進增強與狀態訂閱。
- `src/platform/wake-lock.ts`：只在「使用者已啟用＋展示中＋頁面可見＋安全來源」時持有 Screen Wake Lock，並提供 Preact hook。
- `src/platform/pwa.ts`：離線就緒、離線、更新可用與註冊錯誤狀態；更新一定由使用者操作觸發。
- `src/components/PwaStatus.tsx`：可直接使用的中英雙語狀態與更新提示。

## 隱私與網路

Production runtime 不載入第三方字型、分析工具或遠端資源。QR Code 在瀏覽器本機產生；專案也不會把白板內容上傳到任何服務。
