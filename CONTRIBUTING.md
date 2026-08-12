# Contributing to Modern Text Board

感謝你協助改善 Modern Text Board。這是一個純前端、可離線使用的 text board／handheld sign PWA；提交變更時，請維持輕量、本機優先與跨裝置可操作的核心方向。

## 開發環境

需求：Node.js 22 與 npm。

```bash
npm ci
npx playwright install
npm run dev
```

## 提交變更

1. 從最新的 `main` 建立功能分支。
2. 保持改動聚焦，並為行為變更補上對應測試。
3. UI 變更需檢查 iPhone compact、iPad／Split View 與筆電 regular 版面。
4. 保留鍵盤操作、焦點管理、44×44px 點擊區與 pinch zoom。
5. 不要加入必須連線才能使用的 runtime 資源、追蹤程式、遠端字型或後端依賴，除非專案方向已明確改變。
6. 若變更資料格式、限制、瀏覽器能力或部署方式，請同步更新 README 與 migration／validation 測試。

提交前執行：

```bash
npm run check
npm run test:e2e
```

`npm run check` 涵蓋 ESLint、Vitest 單元／元件測試與 production build；Playwright E2E 需另外執行。

## Commit 與 Pull Request

- 使用能說明結果的聚焦 commit；避免把無關格式化或產出檔混在同一筆變更。
- Pull Request 請描述使用者可見影響、測試結果與已檢查的 viewport／瀏覽器。
- 若視覺結果有改變，請附上對應畫面或更新視覺回歸基準。

## 授權

提交內容即表示你有權提供該內容，並同意以本專案的 [GNU General Public License v3.0 only](./LICENSE)（`GPL-3.0-only`）授權。
