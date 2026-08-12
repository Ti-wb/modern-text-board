import jsQR from "jsqr";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const CHROMIUM_QR_PROJECT = "chromium-1024x768";

function skipUnlessChromiumQrProject(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== CHROMIUM_QR_PROJECT,
    `Runs only in the ${CHROMIUM_QR_PROJECT} project`,
  );
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
  await enableQrCode(page, "https://example.com/台北");
});

test("QR canvas decodes multilingual payload exactly", async ({ page }, testInfo) => {
  skipUnlessChromiumQrProject(testInfo);
  const payload = "台北車站 🚉 / Meet at Exit 2 👋";

  await enableQrCode(page, payload);

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
