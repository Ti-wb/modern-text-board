# Marquee Engine A/B Validation

此文件記錄 CSS Animation、HTML Canvas 2D 與 Worker OffscreenCanvas 跑馬燈候選的測試方式。實驗完成前，沒有 query parameter 的正式行為仍使用 WAAPI。

## Production 測試網址

- CSS：`/?marquee-engine=css`
- Canvas：`/?marquee-engine=canvas`
- Worker WebGL：`/?marquee-engine=worker`
- Worker WebGL 不使用方向性 trail：`/?marquee-engine=worker&marquee-blur=0`
- 保留狀態切換：`/?marquee-lab=1&marquee-engine=worker`

直接網址不顯示測量 overlay。只有加入 `marquee-lab=1` 才會顯示四種引擎的切換器。

## 引擎差異

| 引擎 | 穩態執行 | 主要代價 |
| --- | --- | --- |
| CSS Animation | 瀏覽器 compositor 執行兩個 `translate3d` copy，應用程式 rAF 為零 | 長文字仍會建立較寬的文字 layer |
| Canvas 2D | 每個 display frame 清除 viewport canvas，再繪製兩次快取 bitmap | main thread 每幀執行 rAF 與 canvas draw |
| Worker WebGL | main thread 只建立 `ImageBitmap`；Worker rAF 以兩個 texture quad 合成，高速時增加少量 trail samples | 仍受瀏覽器 compositor／OS presentation 約束；不支援 WebGL 時降級為 Worker 2D，整個 OffscreenCanvas 不可用時降級為 main-thread Canvas |
| WAAPI baseline | 既有兩個 compositor animation | 僅作基準，驗證期間不更改正式預設 |

Canvas backing store 最多 8,000,000 pixels；文字 bitmap 只在內容、字型、顏色、方向、鏡像或 viewport 改變時重建。CSS 版只有在設定或尺寸改變時執行 JavaScript，固定速度播放期間不執行應用程式 frame loop。

## 自動量測

先啟動 production build：

```bash
npm run build
npm run preview
```

單一案例：

```bash
PERF_ENGINE=css PERF_PHASE=steady PERF_DURATION_MS=60000 npm run perf:smoke
PERF_ENGINE=canvas PERF_PHASE=speed-drag PERF_DURATION_MS=60000 npm run perf:smoke
PERF_ENGINE=worker PERF_PHASE=steady PERF_DURATION_MS=60000 npm run perf:smoke
```

三階段、各三次並取中位數：

```bash
PERF_ENGINES=css,canvas,worker \
PERF_PHASES=steady,speed-drag,resize \
PERF_REPEATS=3 \
PERF_DURATION_MS=60000 \
npm run perf:ab
```

可另設定 `PERF_SCENARIO=max|emoji|whitespace`、`PERF_DIRECTION=left|right|up|down`、`PERF_DPR=1|2|3`、`PERF_VIEWPORT=390x844` 與 `PERF_FLASH=1`。

工具會記錄 dropped refresh slots、p95／p99 frame interval、long tasks、Layout／Paint、GPU raster、CSS animation restart、應用程式 rAF、Canvas backing size 與文字 bitmap 是否在穩態重建。Resize 階段會保留 dropped-frame 數值作比較，但不套用穩態 0.5% hard gate，因為測試本身會反覆強制 viewport layout。

2026-08-16 的本機 production 快速 smoke 已確認：兩個 renderer 均正確載入；CSS 與 Canvas steady／speed-drag／resize 六個案例均能完成。CSS steady 為零應用程式 rAF 與 Layout；Canvas steady 沒有 Layout，且測量期間沒有重新執行 `fillText`。

同日完成 6× CPU throttle、每格 60 秒、三次取中位數的完整矩陣：

| Engine／phase | Dropped | p99 | Long tasks | Layout | Paint | App rAF callbacks | Gate passes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CSS steady | 0.333% | 17.091ms | 0 | 0 | 22 | 0 | 0/3 |
| CSS speed-drag | 4.892% | 27.393ms | 0 | 1,377 | 2,787 | 3,577 | 0/3 |
| CSS resize | 3.911% | 35.568ms | 0 | 2,477 | 171 | 304 | 0/3 |
| Canvas steady | 0.042% | 16.903ms | 0 | 0 | 20 | 4,755 | 3/3 |
| Canvas speed-drag | 0.099% | 19.683ms | 0 | 1,244 | 2,523 | 6,976 | 2/3 |
| Canvas resize | 13.978% | 87.485ms | 92 | 2,568 | 244 | 4,299 | 0/3 |

CSS steady 的 dropped rate 仍低於 0.5%，但因 Chrome 在每次 60 秒取樣中各產生 22 次 Paint，未通過「穩態 Paint 必須為零」的嚴格 gate。Canvas steady 的 frame cadence 較好，但它以持續 main-thread rAF 換取較小的 viewport surface；在反覆 resize 與 6× CPU throttle 下成本明顯較高。兩版穩態都沒有 long task、Layout、animation restart 或 rate controller。

這些數字包含 headless Chromium tracing 與測量 instrumentation，不代表 60Hz／ProMotion 實機，也不作為最終引擎結論。實機應優先比較使用者原本回報的「固定尺寸、持續播放時偶發卡頓」，再用旋轉與 Split View 檢查 Canvas 的重建代價。

## 實機程序

每台裝置使用相同文字、字型、方向與速度，各 renderer 連續播放至少兩分鐘；第二輪交換測試順序，避免快取與溫度偏差。

至少涵蓋：

- 短大字、350 字、emoji 與多行文字。
- 左右上下四方向、最高速度，以及跑馬燈加閃爍。
- MacBook Pro Chrome、iPhone／iPad Safari（包含 ProMotion）與可取得的舊 Android。
- 調速、旋轉、Split View、背景化後返回及暫停／恢復。

實機主觀測試使用不含 `marquee-lab=1` 的直接網址，避免切換器遮擋畫面；需要保留同一份頁面狀態快速比較時才使用 lab URL。

## 選擇規則

- 某引擎在至少兩種目標裝置上可重現地減少卡頓，且 trace 中位數同方向改善，才判定勝出。
- Steady dropped frames 必須不超過 0.5%，也不得連續遺失兩個 refresh slots。
- 若 dropped rate 差距小於 0.1 個百分點且 p99 差距小於 1ms，採 CSS，以維持穩態零應用程式 JavaScript。
- 若兩版同時卡頓，下一步檢查文字 bitmap／DOM layer 像素面積；不加入 refresh-rate 猜測、frame queue 或混合自動引擎。
- 選定後刪除落選 renderer、lab query 與切換器，再由獨立提交更新正式預設。
