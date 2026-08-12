import jsQR from "jsqr";
import QRCode from "qrcode";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const CHROMIUM_QR_PROJECT = "chromium-1024x768";
const CHROMIUM_REGULAR_PROJECT = "chromium-1024x768";
const CHROMIUM_COMPACT_PROJECT = "chromium-390x844";

function skipUnlessChromiumQrProject(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== CHROMIUM_QR_PROJECT,
    `Runs only in the ${CHROMIUM_QR_PROJECT} project`,
  );
}

function skipUnlessProject(testInfo: TestInfo, projectName: string): void {
  test.skip(
    testInfo.project.name !== projectName,
    `Runs only in the ${projectName} project`,
  );
}

async function expectWithinViewport(page: Page, selector: string): Promise<void> {
  const bounds = await page.locator(selector).boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!bounds || !viewport) return;

  expect(bounds.x).toBeGreaterThanOrEqual(-1);
  expect(bounds.y).toBeGreaterThanOrEqual(-1);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function dismissPwaBanner(page: Page): Promise<void> {
  const banner = page.locator(".pwa-status");
  if (!await banner.isVisible().catch(() => false)) return;
  const dismiss = banner.getByRole("button").last();
  if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
}

async function enableQrCode(page: Page, payload: string): Promise<void> {
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await page.getByRole("button", { name: "QR Code" }).click();

  const qrPanel = page.getByRole("region", { name: "QR Code" });
  const qrInput = qrPanel.getByLabel(/QR 內容|QR content/);
  await qrInput.fill(payload);

  const qrSwitch = qrPanel.getByRole("switch", {
    name: /顯示 QR Code|Show QR Code/,
  });
  if (await qrSwitch.getAttribute("aria-checked") !== "true") {
    await qrSwitch.click();
  }

  await qrPanel.getByRole("button", { name: /套用|Apply/ }).click();
  await qrPanel.getByRole("button", { name: /關閉|Close/ }).click();
  await expect(page.locator(".qr-canvas")).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".qr-canvas");
    return canvas !== null &&
      canvas.style.width !== "" &&
      canvas.style.width === canvas.style.height;
  });
}

async function expectQrSizing(page: Page, payload: string, minimum: number): Promise<void> {
  const metrics = await page.locator(".qr-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    const stageBounds = canvas.parentElement?.getBoundingClientRect();
    return {
      bitmapHeight: canvas.height,
      bitmapWidth: canvas.width,
      cssHeight: bounds.height,
      cssWidth: bounds.width,
      stageHeight: stageBounds?.height ?? 0,
      stageWidth: stageBounds?.width ?? 0,
    };
  });
  const moduleCount = QRCode.create(payload, { errorCorrectionLevel: "M" }).modules.size + 8;

  expect(metrics.cssWidth).toBeGreaterThanOrEqual(minimum);
  expect(metrics.cssWidth).toBeLessThanOrEqual(320);
  expect(metrics.cssHeight).toBeCloseTo(metrics.cssWidth, 5);
  expect(metrics.stageWidth).toBeGreaterThanOrEqual(metrics.cssWidth);
  expect(metrics.stageHeight).toBeGreaterThanOrEqual(metrics.cssHeight);
  expect(metrics.bitmapWidth).toBe(metrics.bitmapHeight);
  expect(metrics.bitmapWidth % moduleCount).toBe(0);
}

async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  if (!await page.evaluate(() => navigator.serviceWorker.controller !== null)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

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
  const payload = "https://example.com/台北";
  await enableQrCode(page, payload);
  await expectQrSizing(page, payload, 168);
});

test("low-height compact QR stays square and contained", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-390x844",
    "Runs once using the compact Chromium project",
  );
  await page.setViewportSize({ width: 844, height: 390 });
  const payload = "https://example.com/台北";

  await enableQrCode(page, payload);
  await expectQrSizing(page, payload, 168);
});

test("regular toolbar stays contained after drag and auto-hide remains recoverable", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);

  const toolbarShell = page.locator(".toolbar-shell");
  const grip = toolbarShell.locator(".grip-button");
  const gripBounds = await grip.boundingBox();
  expect(gripBounds).not.toBeNull();
  if (!gripBounds) return;

  await page.mouse.move(
    gripBounds.x + gripBounds.width / 2,
    gripBounds.y + gripBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(24, 48, { steps: 8 });
  await page.mouse.up();

  await expect(toolbarShell).toHaveClass(/edge-top/);
  await expect(page.locator(".app-shell")).toHaveClass(/toolbar-at-top/);
  await expectWithinViewport(page, ".toolbar-shell");

  await toolbarShell.locator(".tool-button").last().click();
  const moreDialog = page.locator("#tool-panel-more");
  await expect(moreDialog).toBeVisible();
  await moreDialog.locator('button.menu-row:has(img[src$="/settings.svg"])').click();

  const settingsDialog = page.locator('[role="dialog"][aria-labelledby="settings-panel-title"]');
  await expect(settingsDialog).toBeVisible();
  const autoHideSwitch = settingsDialog.getByRole("switch").first();
  if (await autoHideSwitch.getAttribute("aria-checked") !== "true") {
    await autoHideSwitch.click();
  }
  await page.keyboard.press("Escape");
  await expect(settingsDialog).toBeHidden();

  const canvas = page.getByRole("main");
  await canvas.click({ position: { x: 512, y: 384 } });
  await expect(toolbarShell).toHaveClass(/is-hidden/, { timeout: 4_500 });
  await canvas.click({ position: { x: 512, y: 384 } });
  await expect(toolbarShell).not.toHaveClass(/is-hidden/);
});

test("compact sheet remains usable across dynamic orientation changes", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_COMPACT_PROJECT);

  await page.setViewportSize({ width: 844, height: 390 });
  await page.locator(".toolbar .tool-button").nth(1).click();
  const sheet = page.locator("#tool-panel-font");
  await expect(sheet).toBeVisible();
  await expectWithinViewport(page, "#tool-panel-font");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sheet).toBeVisible();
  await expectWithinViewport(page, "#tool-panel-font");
  await sheet.locator(".panel-close").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator(".toolbar-shell")).toBeVisible();
});

test("QR canvas decodes multilingual payload exactly", async ({ page }, testInfo) => {
  skipUnlessChromiumQrProject(testInfo);
  const payload = "台北車站 🚉 / Meet at Exit 2 👋";

  await enableQrCode(page, payload);
  await expectQrSizing(page, payload, 192);

  const bitmap = await page.locator(".qr-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || canvas.width === 0 || canvas.height === 0) {
      throw new Error("QR canvas does not contain readable pixels");
    }
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return {
      data: Array.from(image.data),
      height: image.height,
      width: image.width,
    };
  });

  const decoded = jsQR(
    Uint8ClampedArray.from(bitmap.data),
    bitmap.width,
    bitmap.height,
    { inversionAttempts: "dontInvert" },
  );
  expect(decoded?.data).toBe(payload);
});

test("controlled service worker supports offline reload, editing, and QR", async ({
  context,
  page,
}, testInfo) => {
  skipUnlessChromiumQrProject(testInfo);
  await waitForServiceWorkerControl(page);

  try {
    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("main")).toBeVisible();

    const offlineText = "離線手舉牌 Offline 🚉";
    await page.getByRole("main").dblclick();
    await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(offlineText);
    await page.getByRole("button", { name: /套用|Apply/ }).click();
    await expect(page.locator(".display-text")).toHaveText(offlineText);

    const offlineQrPayload = "離線 QR ✅";
    await enableQrCode(page, offlineQrPayload);
    await expect(page.locator(".qr-canvas")).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
