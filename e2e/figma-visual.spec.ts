import { expect, test, type Page, type TestInfo } from "@playwright/test";

const FIGMA_VISUAL_PROJECT = "chromium-1024x768";
const BOARD_TEXT = "下一站：台北車站";

function skipOutsideFigmaViewport(testInfo: TestInfo): void {
  test.skip(
    testInfo.project.name !== FIGMA_VISUAL_PROJECT,
    `Visual baselines run only in the ${FIGMA_VISUAL_PROJECT} project`,
  );
}

async function dismissPwaBanner(page: Page): Promise<void> {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return;
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => window.setTimeout(resolve, 1_500)),
    ]);
  });

  const banner = page.locator(".pwa-status");
  if (await banner.isVisible({ timeout: 1_000 }).catch(() => false)) {
    const dismiss = banner.getByRole("button", {
      name: /關閉|Dismiss|稍後|Later/,
    });
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }

  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        caret-color: transparent !important;
        scroll-behavior: auto !important;
        transition: none !important;
      }
      .pwa-status,
      .toast-stack {
        display: none !important;
      }
    `,
  });
}

async function enterBoardText(page: Page): Promise<void> {
  await page.getByRole("main").dblclick();
  const editor = page.getByRole("textbox", { name: /編輯文字|Edit text/ });
  await editor.fill(BOARD_TEXT);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await expect(page.locator(".display-text")).toHaveText(BOARD_TEXT);
}

async function captureState(page: Page, snapshotName: string): Promise<void> {
  await expect(page.locator(".app-shell")).toHaveScreenshot(snapshotName, {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.002,
    scale: "css",
  });
}

test.beforeEach(async ({ page }, testInfo) => {
  skipOutsideFigmaViewport(testInfo);

  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.defineProperty(navigator, "language", {
      configurable: true,
      get: () => "zh-TW",
    });
    Object.defineProperty(navigator, "languages", {
      configurable: true,
      get: () => ["zh-TW", "zh"],
    });
  });
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await dismissPwaBanner(page);
  await enterBoardText(page);
});

test("matches the five primary Figma-derived 1024x768 states", async ({ page }) => {
  await captureState(page, "01-default-light.png");

  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  await expect(page.getByRole("dialog", { name: /字型與字級|Font & size/ })).toBeVisible();
  await captureState(page, "02-font-panel.png");

  await page.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /切換為黑底|dark background/ }).click();
  await expect(page.getByRole("main")).toHaveClass(/board-dark/);
  await captureState(page, "03-dark-canvas.png");

  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await expect(page.getByRole("dialog", { name: /跑馬燈|Marquee/ })).toBeVisible();
  await page.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  await expect(page.locator(".moving-text")).toHaveClass(/is-marquee/);
  await page.waitForFunction(
    () => document.querySelector(".moving-text")?.getAnimations().length === 1,
  );
  await page.locator(".moving-text").evaluate((moving) => {
    const animation = moving.getAnimations()[0];
    const duration = Number(animation?.effect?.getTiming().duration);
    if (!animation || !Number.isFinite(duration)) throw new Error("Marquee animation is unavailable");
    animation.pause();
    animation.currentTime = duration * 0.5;
    const frozenTransform = getComputedStyle(moving).transform;
    animation.cancel();
    moving.style.transform = frozenTransform;
    moving.style.willChange = "auto";
  });
  await captureState(page, "04-marquee-panel.png");
  await page.locator(".moving-text").evaluate((moving) => {
    moving.style.removeProperty("transform");
    moving.style.removeProperty("will-change");
  });

  await page.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await expect(page.getByRole("dialog", { name: /更多工具|More tools/ })).toBeVisible();
  await captureState(page, "05-more-panel.png");
});
