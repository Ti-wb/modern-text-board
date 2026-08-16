# Marquee Motion Probe

這個獨立 production fixture 用來區分跑馬燈的隨機頓挫究竟發生在文字 layer，還是更下游的 compositor／GPU／系統 presentation。它不會替換正式跑馬燈。

## 測試模型

預設畫面有兩條同步的水平軌道；加上 `raster=1` 後會插入第三種測試：

```text
上軌：[藍色方塊][Aa]  ← 方塊與文字位於同一 transform layer
中軌：[藍色方塊][Aa]  ← Aa 啟動時只繪製一次成 Canvas 點陣圖
下軌：[藍色方塊]      ← 獨立、只有方塊的小 layer
```

所有藍色方塊尺寸、顏色與每一刻的 X 座標相同。所有 CSS animations 在同一次 style update 啟動，共用起點、終點、duration、linear easing 與零 delay。Canvas 只在啟動時繪字一次，穩態位移仍是 CSS transform，沒有逐幀 JavaScript 重繪。

預設使用 `alternate` 往返：到達端點時只反轉方向，不會跳回另一側。端點本身的瞬間反向是預期行為，因此只判讀兩端之間的移動。另可使用 `mode=once` 做單次移動，完全沒有第二個 iteration；完成後重新載入再測。

## 隔離條件

- 純 HTML、CSS 與一次性 vanilla JavaScript。
- 不載入 Preact、正式 App、PWA runtime、Service Worker registration、工具列或儲存；只有 `raster=1` 時建立一張靜態 Canvas 點陣圖。
- JavaScript 只等待系統字型後使用一個 rAF 量測 marker 行程並設定 CSS variables。
- 穩態沒有應用程式 rAF、timer、observer、listener 或 state update。
- 沒有 filter、shadow、transition 或 opacity animation。
- 預設 `labels=0`，不顯示 header、footer、lane labels 或格線；`labels=1` 只供初次理解畫面。
- 沒有 resize／orientation listener；尺寸變更後需重新載入。
- 整個 experiments 目錄均排除於 Workbox precache。

## 獨立 production origin

```bash
npm run build
npm run preview:probe -- --host 0.0.0.0 --port 4176 --strictPort
```

主要測試網址：

```text
http://localhost:4176/?pps=600
http://localhost:4176/?pps=120
http://localhost:4176/?pps=120&mode=once
http://localhost:4176/?pps=240&raster=1
```

初次查看說明版：

```text
http://localhost:4176/?pps=240&labels=1
```

## Query parameters

| Parameter | 範圍／值 | 預設 | 說明 |
| --- | --- | --- | --- |
| `text` | 最多 350 Unicode code points | `Aa` | 上軌文字；超出可視 runner 的部分會被裁切。 |
| `pps` | `1`–`1200` | `240` | 兩條軌道共同的 CSS px/s。 |
| `fontSize` | `24`–`200` | `112` | 上軌固定字級，不做 auto-fit。 |
| `weight` | `300`, `400`, `700`, `900` | `900` | 系統字型粗細。 |
| `mode` | `alternate`, `once` | `alternate` | 無 teleport 往返，或單次無 iteration reset。 |
| `theme` | `dark`, `light` | `dark` | 純色背景與文字組合。 |
| `labels` | `0`, `1` | `0` | 是否顯示靜態說明與格線；正式觀察維持 `0`。 |
| `raster` | `0`, `1` | `0` | 插入「文字先繪成點陣圖再位移」的中軌實驗。 |

## 判讀

- 上下兩個藍色方塊在軌道中段同時停住／跳動：問題位於 compositor、GPU、瀏覽器或作業系統 presentation，不是 glyph 本身。
- 上方藍色方塊與文字一起頓、下方藍色方塊仍連續：文字 layer 的 raster、tile、layer 面積或合成成本較可疑。
- DOM 文字軌會頓、Canvas 點陣字軌平滑：原生 glyph raster/sampling 較可疑。
- DOM 與 Canvas 文字軌都頓、純方塊平滑：較可能是大型 texture/layer 合成或傳輸成本。
- 兩個方塊都等速，只有文字邊緣亮暗／抖動：glyph texture 的 fractional-pixel sampling。
- 只在左右端點感到停頓：這是 linear animation 瞬間反向的自然速度不連續，不列入結果；改用 `mode=once` 複驗。

先關閉 DevTools、螢幕錄影、瀏覽器效能 overlay 與省電模式，每個案例 warm-up 後觀察至少 60–120 秒。建議在同一台 Mac 上依序比較 Chrome／Safari，以及 ProMotion／固定 60Hz；第二輪反轉順序。

`window.__motionProbeSnapshot` 只保存初始化後的 frozen 幾何資料，包含 marker 寬度、行程、duration 與實際 px/s，不會驅動動畫。Playwright 只驗證隔離、同步與端點數學連續性；它不能代替實機 presentation 掉幀結論。
