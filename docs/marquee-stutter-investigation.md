# 每 5–10 秒高速微頓的診斷與改善

> 以下保留 2026-09-06 的歸位路徑試驗。2026-09-07 已加入日常預設文字快取與互動流程改善，現行行為見 [日常跑馬燈效能](./marquee-daily-performance.md)。

本輪針對桌面 Chrome／Edge、固定高速播放的週期性微頓。使用者回報既有實驗頁也會卡，但尚未確認純色方塊是否同步卡頓。保持文字清晰度、最高速度與既有功能，以實機證據選擇改動。

## 已實作

- `perf:smoke` 支援實機有視窗模式、正式 App／clean fixture／三軌 probe，以及輕量 trace、完整診斷和純目視三種模式。
- 每次錄製保存 `trace.json` 與 `summary.json`；記錄瀏覽器、GPU、實際 DPR／視窗尺寸、測試文字、字型、實際 DOM 位移速度與動畫時序。
- 僅統計起訖標記內、目標 renderer 的事件。`DrawFrame` 再分 thread／layer；`PipelineReporter` 再分 layer／frame source，無法消歧就標為 unavailable。
- 配對 `PipelineReporter` 的 async begin/end，以終點呈現回饋時間計算間隔，處理每幀重用的 async id。來源不明、配對不全或無資料不視為零掉幀。
- `DrawFrame` 推估與 Chrome 呈現回饋分開保存。提供 p99.9、最長間隔、掉幀時間、距上次微頓時間，以及重疊的 Raster／Paint／GPU／GC 工作。
- 以取樣前的動畫 snapshot 推算微頓附近的循環位置，標記 probe 的端點反向；這是定位線索，不是每幀位置或因果證明。
- `perf:ab` 逐輪交錯案例、隔輪反轉順序，預設三輪；每次使用新的暫存瀏覽器 profile。不同 frame source 的結果不合併取中位數。
- 新增 `?marquee-loop=continuous` 候選：沿用 WAAPI 和兩份原生 DOM 文字，只把畫面外的瞬間歸位改成連續返回路徑。

正式預設仍為原本的 linear 循環。候選不改字型、DPR、可見區域的位移速度、兩份文字的間隔或儲存格式；60 秒 cadence 校準也保持原樣。

## 候選版本與目前證據

本機 Chromium 的 120 秒基線錄製出現 24 次約 33 ms 的長間隔，彼此約隔 5.05 秒。它們落在兩份文字交替歸位的循環位置，並伴隨 Raster 活動；該次穩態沒有 Layout 或 Paint。這比平均 FPS 更直接對應使用者描述的週期。

兩個各 30 秒的隔離試驗中，靜態點陣文字及原生文字連續返回路徑都未出現這個長間隔。採用後者作為候選，因為能沿用現有原生字型、emoji、多行排版與鏡像，不需新增圖像資源或點陣快取。點陣試驗只用於定位，沒有新增 `marquee-raster` 正式選項。

候選只在文字完全離開可見區域後，沿裁切區外返回起點。第一與最後一個 keyframe 的 transform 相同，可見區段仍使用原本的線性速度。若短文字沒有足夠的畫面外時間容納返回路徑，會維持原本的 linear 循環；不調低速度或縮小文字。未支援 WAAPI 時也沿用現有 CSS fallback。

在網址加上以下參數試用，移除 `marquee-loop` 即回到原版：

```text
/?marquee-engine=waapi&marquee-loop=continuous
```

以上本機結果來自 headless Chromium／SwiftShader 軟體 GPU，證明此環境能重現並隔離問題；仍需在原本會卡的硬體上驗證後，才能決定切換正式預設。

實際候選程式完成後，再以交錯順序各錄製三次 120 秒。六次皆為相同文字、80 px／900 字重、1024×768、DPR 2、60 Hz 取樣基準及 613.125 px/s；來源皆為 `chrome-presentation-feedback`：

| 指標 | 原版 linear | 候選 continuous |
| --- | --- | --- |
| 每輪長間隔次數（超過 25 ms） | 24、24、24 | 0、0、0 |
| 每分鐘長間隔次數中位數 | 約 12 | 0 |
| p99.9 間隔中位數 | 33.467 ms | 17.255 ms |
| 三輪中最長間隔 | 33.798 ms | 17.917 ms |
| 最多連續遺失更新週期 | 1 | 0 |
| 每輪穩態 Layout／Paint | 0／0 | 0／0 |

本機長間隔頻率中位數降低 100%；這是軟體 GPU 的 A/B 結果，尚未完成使用者原裝置的五分鐘目視驗收。原始 trace 及每輪摘要保存在本機 `perf-results/marquee-perf-validation/`，[三輪 A/B 摘要](../perf-results/marquee-perf-validation/ab-2026-09-06T20-45-13-538Z-75eb7b6f.json) 記錄完整順序與各檔案位置。

原版與候選在同一裝置交錯測試：

```bash
PERF_PROFILE=real PERF_CHANNEL=chrome PERF_REFRESH_HZ=60 \
PERF_ENGINE=waapi PERF_LOOPS=linear,continuous npm run perf:ab
```

先核對每輪 `workload.loopMode` 是否確實為所要求的模式；短文字若回到 linear，該輪不能當成候選改善的證據。再核對實際速度、字型與畫面尺寸相同。

完成 A/B 後，以候選網址和原本使用設定連續觀看五分鐘，確認中段與歸位處的體感、文字清晰度及操作行為；或使用 `PERF_PROFILE=real PERF_ENGINE=waapi PERF_LOOP=continuous PERF_TRACE=none PERF_DURATION_MS=300000 npm run perf:smoke` 進行無 trace 的觀察。

## 先在原本會卡的裝置建立基線

需要 Node 22、專案依賴，以及該裝置上已安裝的 Chrome 或 Edge。先啟動 production 預覽：

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

另一個終端執行。以下假設螢幕已固定在 **60 Hz**；依實際設定更改，Edge 改用 `PERF_CHANNEL=msedge`：

```bash
PERF_PROFILE=real PERF_CHANNEL=chrome PERF_REFRESH_HZ=60 \
PERF_TARGETS=app,probe PERF_ENGINES=waapi \
npm run perf:ab
```

每個案例暖機後錄製 120 秒，共三輪，約 14 分鐘。App 預設是短測試文字，probe 預設是 `Aa`，兩者是隔離對照，不能直接宣稱其中一個渲染器較快。用 `PERF_CONTENT` 指定可重現的文字；需要公平比較時匹配相同字型、實際字級、DPR、viewport 與 px/s。

`real` 預設不模擬 DPR 或 viewport，使用目標視窗的原生數值。顯式指定 DPR 時也必須指定 viewport；保留兩者未設定即可測原生顯示。視窗需持續可見，避免測量期間 resize、切換螢幕或變更更新率。硬體／OS 的 VRR 狀態無法由此工具可靠讀出，請在 `PERF_DEVICE_NOTE` 記錄螢幕、固定 Hz／VRR、外接螢幕與電源狀態。VRR 結果需另列，不能拿固定 Hz 的 missed-slot 門檻直接驗收。

沒有指定 `PERF_REFRESH_HZ` 時，報告使用錄製前的 rAF 中位數估計；這不是實體螢幕規格的證明。使用 `PERF_REQUIRE_EXPECTED_CADENCE=1` 可要求校準值與指定值相差不超過 8%。

## 分開目視與 trace

無 DevTools、overlay、錄影及測量掛鉤的五分鐘觀察：

```bash
PERF_PROFILE=real PERF_TRACE=none PERF_TARGET=probe \
PERF_DURATION_MS=300000 npm run perf:smoke
```

腳本只在開始前暖機與校準；穩態沒有測試側每幀 callback。觀察三條軌道是否在**移動中段同時**卡頓，端點瞬間反向不算。`none` 不產生 trace，`acceptance.passed` 是 `null`。

需要檢查圖層與應用程式回呼時，另外錄製完整診斷：

```bash
PERF_PROFILE=real PERF_TRACE=diagnostic PERF_TARGET=app \
PERF_REFRESH_HZ=60 npm run perf:smoke
```

`frames` 不掛鉤動畫／Canvas API，也不啟用 LayerTree；`diagnostic` 會增加觀測成本。不要將不同模式的數字混合比較。

## 改變單一因素

用 clean fixture 固定字級，不讓 App auto-fit 干擾文字長度實驗。以下兩輪只改速度：

```bash
PERF_PROFILE=real PERF_TARGET=clean PERF_FONT_SIZE=80 \
PERF_CONTENT='高速跑馬燈 High speed marquee' PERF_PPS=600 npm run perf:ab

PERF_PROFILE=real PERF_TARGET=clean PERF_FONT_SIZE=80 \
PERF_CONTENT='高速跑馬燈 High speed marquee' PERF_PPS=300 npm run perf:ab
```

再固定 `PERF_PPS=600`、`PERF_FONT_SIZE=80`，改變 `PERF_CONTENT` 的長度。實際對照 App 時，從其 `motion.effectivePixelsPerSecond`、`motion.font` 取得數值；速度 40 經既有像素對齊後不一定正好是 600 px/s。

也可在 `PERF_BASE_URL` 指定獨立 fixture origin，例如 `http://127.0.0.1:4175/`。單一 target 原樣使用 URL；多 target A/B 會在同一 origin 使用內建 experiments 路徑。fixture 使用全新 profile 並阻擋 Service Worker，不會動到使用者原有的 workspace 或快取。

## 判讀與下一個改動

| 證據 | 下一步 |
| --- | --- |
| 速度減半後，微頓間隔跟著變長；改變文字長度後也跟著循環移動 | 對照 `animationPhases` 與 Raster／Paint，A/B 比較本輪新增的連續返回候選。 |
| 連續返回後 DOM 仍會卡、靜態點陣字順 | 再考慮原 DPR 一次點陣化候選。需驗證字型、emoji、鏡像、四方向與 glyph 邊緣，超出資源預算時回到原 renderer，不以降低清晰度換取通過。 |
| DOM 與點陣字都卡、純方塊順 | 用現有 `?marquee-engine=worker&marquee-blur=0` 比較 viewport 畫布成本，核對有效點陣解析度。Worker 未改善就不切換預設。 |
| 三軌同時卡，與文字長度或速度無關 | 檢查 GPU／presentation；在同一裝置比較固定更新率、單螢幕與原設定，再用 Firefox 手動對照。Chrome 與 Edge 共用 Chromium，兩者一致不能排除共同瀏覽器原因。 |
| 只有 App 在約 60 秒出現額外活動 | 單獨隔離 cadence 校準；不能用這個現象解釋獨立頁每 5–10 秒的卡頓。 |

## 報告與驗收

預設輸出到 `perf-results/marquee-perf/`（已在 Git ignore 範圍內），每次使用獨立目錄，不覆寫前次結果，也不會被一般 Playwright E2E 的輸出目錄清理移除。`PERF_OUTPUT_DIR` 可更改位置；不要指定到 `test-results/`。把 `trace.json` 載入 Chrome DevTools Performance 查看 Frames／GPU／Raster。

- `chromeTrace.frameSignals.source` 是本次的統計來源；`cadence` 是該來源的間隔，`inferred` 永遠只是 DrawFrame 推估。
- `presentation.counts` 分開保存 normal／partial／dropped；掉幀百分比和間隔超過 1.5 個更新週期的 `stutters` 是不同指標。
- `stutters.events` 有完整時間點和重疊工作；`nearProbeTurnaround` 只是協助排除目視反向錯覺，不會偷偷刪掉真正的長間隔。
- A/B 摘要保存每輪結果、原始檔路徑和順序。只比較相同工作量、實際速度、瀏覽器／GPU／更新率及 frame source；缺少數值維持 `null`。
- 三輪微頓頻率中位數至少降低 80%，p99.9 不退步，沒有連續遺失兩個更新週期，再完成原裝置五分鐘目視確認。基準未重現或只有 DrawFrame 推估時，不宣告改善成立。
- `acceptance.passed` 只代表自動 gate；`physicalDeviceValidated` 固定為 false，工具不代替人眼驗收。
- 候選通過上述門檻後才以獨立提交切換正式預設，保留可單獨回退的變更。

相關檢查：`npm run test:perf` 驗證取樣邊界、frame source、async 配對與尾端間隔；`npm run check` 已包含此檢查。`useMarqueeMotion.test.tsx` 驗證四方向可見位置／速度與原版相同、返回區段不會露出，以及短文字 fallback；`npx playwright test e2e/marquee-continuous-loop.spec.ts --project=chromium-1024x768` 驗證瀏覽器整合、調速與 resize。

## 參數速查

| 參數 | 預設與用途 |
| --- | --- |
| `PERF_PROFILE` | `stress` 保留既有 headless／6 倍 CPU／10 秒；`real` 使用有視窗／1 倍 CPU／120 秒。 |
| `PERF_CHANNEL` | real 預設 `chrome`；可用 `msedge`、`chromium`、`bundled`。real 不會偷偷降級成 headless。 |
| `PERF_TARGET` / `PERF_TARGETS` | 單次 target／A/B target 清單：`app,clean,probe`。fixture 只支援 steady。 |
| `PERF_LOOP` / `PERF_LOOPS` | App WAAPI 單次／A/B 循環模式：`linear,continuous`。A/B 預設 linear；單次未設定則保留 URL 指定。 |
| `PERF_TRACE` | `frames`、`diagnostic`、`none`；real 預設 frames，stress 預設 diagnostic。 |
| `PERF_PPS` / `PERF_FONT_SIZE` | clean／probe 的實際 px/s 與固定字級；App 沿用 `PERF_SPEED` 與既有 auto-fit。 |
| `PERF_DURATION_MS` / `PERF_REPEATS` | 單次取樣長度／A/B 重複次數；repeats 預設 3。 |
| `PERF_DPR` / `PERF_VIEWPORT` | 可顯式覆寫；real 未設定時採原生值，stress 保留 DPR 2／1024×768。 |
| `PERF_OUTPUT_DIR` | 原始 trace 與 JSON 報告目錄。 |

Chrome 的正常、部分呈現與掉幀定義見 [Performance Frames 文件](https://developer.chrome.com/docs/devtools/performance/reference#frames)。瀏覽器呈現回饋與實際顯示器掃描仍是不同層次。
