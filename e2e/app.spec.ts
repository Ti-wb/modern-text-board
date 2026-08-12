import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("edits text and keeps the core toolbar operable", async ({ page }) => {
  await page.getByRole("main").dblclick();
  const editor = page.getByRole("textbox", { name: /編輯文字|Edit text/ });
  await editor.fill("台北車站 Taipei 🚉");
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await expect(page.locator(".display-text")).toHaveText("台北車站 Taipei 🚉");

  await page.getByRole("button", { name: /白底|黑底|background/ }).click();
  await expect(page.getByRole("main")).toHaveClass(/board-dark/);
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  await expect(page.locator(".moving-text")).toHaveClass(/is-marquee/);
});

test("adds a page and switches with accessible controls", async ({ page }) => {
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await page.getByRole("button", { name: /頁面管理|Manage pages/ }).click();
  await page.getByRole("button", { name: /新增頁面|Add page/ }).click();
  await expect(page.locator(".page-list > li")).toHaveCount(2);
  await expect(page.locator(".page-indicator")).toContainText(/2/);
});

test("compact layout uses a bottom dock and QR panel", async ({ page }) => {
  await expect(page.locator(".toolbar-shell")).toBeVisible();
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await page.getByRole("button", { name: "QR Code" }).click();
  const qrInput = page.getByLabel(/QR 內容|QR content/);
  await qrInput.fill("https://example.com/台北");
  await page.getByRole("switch", { name: /顯示 QR Code|Show QR Code/ }).click();
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await expect(page.locator(".qr-canvas")).toBeVisible();
});
