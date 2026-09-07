# 日常跑馬燈效能：原 DPR 文字快取

2026-09-07：使用者確認原版與 continuous 歸位版本都仍有體感微頓。本輪改善兩者共用的文字繪製流程，以及編輯、字級拖曳與調速時的多餘工作。

## 目前行為

一般網址的 WAAPI 跑馬燈預設使用靜態文字快取，無須實驗參數。文字仍由原生 DOM 排版並提供無障礙內容；兩份 Canvas 只保存一次繪製的字形，沿用既有 WAAPI 速度、方向、循環間隔、暫停、鏡像及閃爍。

- 依原始 DPR 建立 backing store，沒有縮小解析度或降低速度。
- 使用 DOM 的實際換行、grapheme 邊界與基線，不重新猜測字距／換行。
- Canvas 接到文件中再解析字型，保留專案 `font-synthesis: none`，避免 fallback 中文被額外加粗。字型來源的機制見 [HTML Canvas 標準](https://html.spec.whatwg.org/multipage/canvas.html#text-styles)。
- 字型載入、內容、顏色、字級、版面、DPR 或文件語言改變時才重建。調速與鏡像不重畫文字。
- 字級／視窗拖曳期間維持原生文字，停止調整 80 ms 後才產生一次快取，避免每幀配置新圖像。
- 幾何量測排除快取的透明 glyph 邊界，確保原有速度與重複間距不變。
- 兩份 backing store 合計最多 8,000,000 像素（RGBA 約 32 MB，不含瀏覽器額外開銷），單邊最多 16,384 像素。超出預算、tab stop、不支援的排版或建立失敗時保留原生文字。
- 編輯／暫停切換不再重啟整組顯示器監測與校準；原本的啟動、顯示環境變更及播放中每 60 秒校準仍保留。收集滿 48 筆之前不再每幀排序樣本。
- 重複指定相同速度不再啟動無效的 rAF 調速回呼。

原生比較：`/?marquee-raster=0`。強制要求嘗試快取：`/?marquee-raster=1`（仍保留資源／相容性 fallback）。`marquee-loop=continuous` 繼續可獨立選擇；快取並不依賴它，也涵蓋原本必須回到 linear 的短文字。

## 本機驗證

`npm run check` 通過（174 個單元測試及 8 個 trace 分析案例，包含 build、bundle 與字型資產檢查）。另外 11 個 Chromium E2E 通過，包含：

- 四方向原有動畫、短文字 fallback、調速與 resize。
- 快取使用原 DPR，調速重用快取，編輯與 web font 載入後正確替換。
- 字級連續調整期間不畫新快取，停止後只繪製一次。
- 中英、emoji／ZWJ、空白行、重音符號、直向換行與鏡像的字形比較；允許一個實體像素的字緣抗鋸齒差異，並核對兩版的幾何數值完全一致。

另 8 個既有跑馬燈功能案例通過，包括同步閃爍、速度預覽與提交、連續接續及 DPR 3 保護。修正一個仍假設舊 480 px/s 上限的測試預期，執行時的速度曲線保持原樣。

最終版本的 5 秒完整診斷通過，取樣期間動畫重建、調速回呼、rAF 回呼、Canvas 畫字／貼圖及 Long Task 均為 0；這個短取樣不涵蓋每 60 秒的顯示器校準。

下列取樣都是 headless Chromium／SwiftShader 軟體 GPU，CPU 1 倍、DPR 2、60 Hz 判讀基準、字級 80 px。每次使用新的瀏覽器 context，暖機後錄製，來源皆為 `chrome-presentation-feedback`。**這些結果不能代替使用者裝置的體感驗證。**

速度 10 的三組各錄製 60 秒，實際速度皆為 159.375 px/s。原生與快取均無超過 25 ms 的長間隔，也沒有穩態 Layout／Paint／Raster；本機未重現這三組的微頓，因此只作相容性及退步檢查：

| 情境 | 原生 p99.9 | 快取 p99.9 | 原生／快取長間隔次數 |
| --- | --- | --- | --- |
| 單字元 `i`，continuous 要求實際回到 linear | 17.436 ms | 18.210 ms | 0／0 |
| `Hello 你好 🚀`，linear | 17.692 ms | 18.472 ms | 0／0 |
| 直向多行／換行，continuous | 17.820 ms | 18.464 ms | 0／0 |

快取在這三組的 p99.9 稍高，仍未跨過長間隔門檻；不宣稱所有情境的尾端延遲都改善。原始 trace 與完整摘要保存於 `perf-results/daily-pipeline-v2/`。取樣後加入的 80 ms 重建等待只影響設定變更期間；最終版本另外驗證拖曳與穩態診斷。

最終版本另以較長的中英文字、一般速度 20 各錄製 45 秒，實際速度均為 309.375 px/s、循環距離均為 6,192 px：

| 指標 | 原生 | 快取 |
| --- | --- | --- |
| 長間隔次數 | 4 | 0 |
| p99.9 | 33.315 ms | 17.429 ms |
| 最長間隔 | 33.493 ms | 17.471 ms |
| Raster 活動 | 27 次／4.059 ms | 0 次 |

這組重現了循環微頓，快取版本在本次取樣中未再出現。這是各一次的本機比較，不代表所有實機已消除卡頓；[完整摘要及 trace 路徑](../perf-results/daily-long/daily-ab.json) 可供後續比對。

## 重現方式

啟動 `npm run build` 和 `npm run preview -- --host 127.0.0.1 --port 4173 --strictPort`，在另一個終端比較：

```bash
PERF_PROFILE=real PERF_CHANNEL=chrome PERF_REFRESH_HZ=60 \
PERF_BASE_URL='http://127.0.0.1:4173/?marquee-raster=0' \
PERF_SPEED=20 npm run perf:smoke

PERF_PROFILE=real PERF_CHANNEL=chrome PERF_REFRESH_HZ=60 \
PERF_BASE_URL='http://127.0.0.1:4173/?marquee-raster=1' \
PERF_SPEED=20 npm run perf:smoke
```

依實際更新率更改 60，Edge 使用 `PERF_CHANNEL=msedge`。核對 `motion.inkMode`、`motion.distance`、速度、字型和 viewport 是否符合要求，再比較 frame source、長間隔和 p99.9。快取若回到 native，不把它列為成功的快取測試。

純目視時用相同網址、文字和速度觀看至少五分鐘；可用 `PERF_TRACE=none PERF_DURATION_MS=300000`。一般網址已採用新預設，既有頁面內容及設定不需重建。
