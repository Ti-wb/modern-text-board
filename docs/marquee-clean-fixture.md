# Clean Marquee Fixture

這是一個用來判斷跑馬燈偶發卡頓是否來自主應用程式的最小基準頁。它不是新的正式引擎，也不讀寫 workspace。

## 隔離範圍

此頁只有一份 HTML、一份 CSS 與一份 vanilla JavaScript：

- 不載入 Preact、Vite App bundle、PWA runtime 或 Service Worker registration。
- 沒有工具列、面板、QR、儲存、auto-fit、VisualViewport、ResizeObserver、transition、filter 或 backdrop blur。
- 保留兩份文字、半畫面預設間隔、四個方向與線性無限循環。
- JavaScript 等待系統字型就緒後，只用一個 `requestAnimationFrame` 量測 viewport 與文字尺寸並寫入 CSS variables。
- 進入穩態後沒有應用程式 rAF、timer、observer、listener 或 state update；位移由原生 CSS Animation 執行。

這個基準刻意不處理旋轉與 resize。尺寸改變後請重新載入頁面，避免把 viewport event pipeline 混入穩態測試。

## 獨立 production origin

同一個部署 origin 若曾開啟正式首頁，scope `/` 的既有 Service Worker 仍可能 control 實驗路徑。最乾淨的本機／區網測試方式，是只把 fixture 目錄當成 production root：

```bash
npm run build
npm run preview:clean -- --host 0.0.0.0 --port 4175 --strictPort
```

開啟：

```text
http://localhost:4175/?speed=40&direction=left
```

這個 origin 的 `/` 就是 fixture，頁面也不會請求 `/sw.js` 或任何正式 App asset。部署到 Cloudflare Pages 時，fixture 也被排除在 Workbox precache 之外並使用 `Cache-Control: no-store`；但實機診斷仍優先使用全新的 origin 或無痕瀏覽內容。

## Query parameters

| Parameter | 範圍／值 | 預設 | 說明 |
| --- | --- | --- | --- |
| `text` | 最多 350 Unicode code points | 內建測試字串 | 原樣保留空白與換行；顯式空字串顯示空白。 |
| `direction` | `left`, `right`, `up`, `down` | `left` | 移動方向。 |
| `speed` | `1`–`40` | `40` | 與主 App 相同的無段速度刻度。 |
| `pps` | `1`–`1200` | 無 | 直接指定 CSS px/s；存在時覆寫 `speed` 換算結果。 |
| `fontSize` | `12`–`1024` | `80` | 固定字級；此 fixture 刻意沒有 auto-fit。 |
| `gap` | `0`–`2` | `0.5` | 兩份文字間距相對於移動軸 viewport 的比例。 |
| `weight` | `300`, `400`, `700`, `900` | `900` | 系統字型粗細。 |
| `theme` | `light`, `dark` | `light` | 預設前景與背景組合。 |
| `color` | CSS color | 依 theme | 自訂文字顏色。 |
| `background` | CSS color | 依 theme | 自訂背景顏色。 |

例如：

```text
/?text=HELLO%20TAIPEI&direction=right&pps=480&fontSize=180&gap=0.5&theme=dark
```

為避免加入新的共同成本，這個 fixture 不提供鏡像、閃爍、QR、互動式控制或畫面 overlay。改參數時直接修改網址並重新載入。

## 驗證方式

1. 同一台裝置固定文字、方向、字級、間距與 px/s，先連續播放至少兩分鐘。
2. 再以同樣條件測正式 App 的 CSS 引擎；測試順序第二輪反轉。
3. 測試期間關閉瀏覽器 DevTools、錄影、效能 overlay 與作業系統省電模式。
4. 若 clean fixture 與三個 App 引擎同樣卡頓，主因較可能是 glyph raster、compositor、GPU、瀏覽器／OS 排程或高速位移的自然 motion judder，而不是 Preact 穩態工作。
5. 若只有完整 App 卡頓，再針對 toolbar idle transition、viewport／auto-fit／resize pipeline 與 UI compositing 做 trace。

測試程式可讀取 `window.__cleanMarqueeSnapshot` 確認實際距離、duration 與 px/s；這只是初始化後的 frozen snapshot，不會驅動動畫。
