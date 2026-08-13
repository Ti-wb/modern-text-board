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

async function freezeMarqueeAt(page: Page, progress: number): Promise<void> {
  await page.locator(".moving-text").evaluate((moving, frozenProgress) => {
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    if (animations.some((animation) => !animation) || !Number.isFinite(duration)) {
      throw new Error("Marquee animations are unavailable");
    }
    animations.forEach((animation, index) => {
      animation.pause();
      animation.currentTime =
        duration * ((frozenProgress + index * 0.5) % 1);
    });
    copies.forEach((copy, index) => {
      const frozenTransform = getComputedStyle(copy).transform;
      animations[index].cancel();
      copy.style.transform = frozenTransform;
      copy.style.willChange = "auto";
    });
  }, progress);
}

async function clearFrozenMarquee(page: Page): Promise<void> {
  await page.locator(".moving-text").evaluate((moving) => {
    moving.querySelectorAll<HTMLElement>(".marquee-copy").forEach((copy) => {
      copy.style.removeProperty("transform");
      copy.style.removeProperty("will-change");
    });
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
    () => {
      const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
      return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
    },
  );
  await freezeMarqueeAt(page, 0.25);
  await captureState(page, "04-marquee-panel.png");
  await clearFrozenMarquee(page);

  const marqueeToggle = page.getByRole("button", {
    name: /啟用跑馬燈|Enable marquee/,
  });
  await marqueeToggle.click();
  await marqueeToggle.click();
  await page.waitForFunction(
    () => {
      const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
      return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
    },
  );

  await page.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await expect(page.getByRole("dialog", { name: /更多工具|More tools/ })).toBeVisible();
  await freezeMarqueeAt(page, 0.36);
  await captureState(page, "05-more-panel.png");
});
