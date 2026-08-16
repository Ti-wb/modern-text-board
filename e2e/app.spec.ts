import jsQR from "jsqr";
import QRCode from "qrcode";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

const CHROMIUM_QR_PROJECT = "chromium-1024x768";
const CHROMIUM_REGULAR_PROJECT = "chromium-1024x768";
const CHROMIUM_COMPACT_PROJECT = "chromium-390x844";
const CHROMIUM_DPR3_PROJECT = "chromium-dpr3";
const TOOLBAR_PROJECTS = new Set([
  CHROMIUM_REGULAR_PROJECT,
  CHROMIUM_COMPACT_PROJECT,
]);
const FONT_FILL_PROJECTS = new Set([
  CHROMIUM_REGULAR_PROJECT,
  CHROMIUM_COMPACT_PROJECT,
  "webkit",
  "iphone",
  "ipad-landscape",
]);

interface Point {
  x: number;
  y: number;
}

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

function skipUnlessToolbarProject(testInfo: TestInfo): void {
  test.skip(
    !TOOLBAR_PROJECTS.has(testInfo.project.name),
    `Runs only in the ${[...TOOLBAR_PROJECTS].join(" and ")} projects`,
  );
}

function skipUnlessFontFillProject(testInfo: TestInfo): void {
  test.skip(
    !FONT_FILL_PROJECTS.has(testInfo.project.name),
    `Runs only in the ${[...FONT_FILL_PROJECTS].join(", ")} projects`,
  );
}

async function toolbarCenter(page: Page): Promise<Point> {
  const bounds = await page.locator(".toolbar-shell").boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("Toolbar does not have measurable bounds");
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

async function dragToolbarPointerTo(page: Page, pointerTarget: Point): Promise<Point> {
  await dismissPwaBanner(page);
  const toolbarShell = page.locator(".toolbar-shell");
  const grip = toolbarShell.locator(".grip-button");
  const gripBounds = await grip.boundingBox();
  expect(gripBounds).not.toBeNull();
  if (!gripBounds) throw new Error("Toolbar grip does not have measurable bounds");

  await grip.hover();
  await page.mouse.down();
  await expect(toolbarShell).toHaveClass(/is-dragging/);
  await page.mouse.move(pointerTarget.x, pointerTarget.y, { steps: 8 });
  await page.mouse.up();
  await expect(toolbarShell).not.toHaveClass(/is-dragging/);
  return toolbarCenter(page);
}

async function dragToolbarCenterTo(page: Page, target: Point): Promise<Point> {
  const toolbarShell = page.locator(".toolbar-shell");
  const grip = toolbarShell.locator(".grip-button");
  const shellBounds = await toolbarShell.boundingBox();
  const gripBounds = await grip.boundingBox();
  expect(shellBounds).not.toBeNull();
  expect(gripBounds).not.toBeNull();
  if (!shellBounds || !gripBounds) {
    throw new Error("Toolbar does not have measurable bounds");
  }

  const pointerOffset = {
    x:
      gripBounds.x + gripBounds.width / 2 -
      (shellBounds.x + shellBounds.width / 2),
    y:
      gripBounds.y + gripBounds.height / 2 -
      (shellBounds.y + shellBounds.height / 2),
  };
  return dragToolbarPointerTo(page, {
    x: target.x + pointerOffset.x,
    y: target.y + pointerOffset.y,
  });
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

async function editBoardText(page: Page, text: string): Promise<void> {
  await page.getByRole("main").dblclick();
  const editor = page.getByRole("textbox", { name: /編輯文字|Edit text/ });
  await editor.fill(text);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await expect(page.locator(".display-text")).toHaveText(text);
}

async function textFitMetrics(page: Page) {
  return page.locator(".text-viewport").evaluate((viewport) => {
    const moving = viewport.querySelector<HTMLElement>(".moving-text");
    const display = viewport.querySelector<HTMLElement>(".display-text");
    if (!moving || !display) throw new Error("Displayed text is missing");
    const viewportBounds = viewport.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(display);
    const contentBounds = range.getBoundingClientRect();
    return {
      contentHeight: contentBounds.height,
      contentWidth: contentBounds.width,
      fontSize: Number.parseFloat(getComputedStyle(moving).fontSize),
      viewportHeight: viewportBounds.height,
      viewportWidth: viewportBounds.width,
    };
  });
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  const moreDialog = page.locator("#tool-panel-more");
  await expect(moreDialog).toBeVisible();
  await moreDialog.locator('button.menu-row:has(img[src$="/settings.svg"])').click();

  const settingsDialog = page.locator(
    '[role="dialog"][aria-labelledby="settings-panel-title"]',
  );
  await expect(settingsDialog).toBeVisible();
  return settingsDialog;
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

test("marquee speed changes continuously without moving the current frame", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await editBoardText(page, "Smooth marquee speed control");
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const marqueeDialog = page.locator("#tool-panel-marquee");
  await marqueeDialog
    .getByRole("button", { name: /啟用跑馬燈|Enable marquee/ })
    .click();
  await expect(page.locator(".app-shell")).toHaveClass(/has-active-marquee/);
  const activeSurfaceFilters = await page.evaluate(() => ({
    panel: getComputedStyle(document.querySelector<HTMLElement>(".tool-panel")!).backdropFilter,
    toolbar: getComputedStyle(document.querySelector<HTMLElement>(".toolbar")!).backdropFilter,
  }));
  expect(activeSurfaceFilters).toEqual({ panel: "none", toolbar: "none" });

  const slider = marqueeDialog.getByRole("slider", { name: /速度|Speed/ });
  await expect(slider).toHaveAttribute("max", "40");
  await expect(slider).toHaveAttribute("step", "0.1");
  await page.waitForFunction(
    () => {
      const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
      return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
    },
  );

  const before = await page.locator(".moving-text").evaluate((moving) => {
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    if (animations.some((animation) => !animation) || !Number.isFinite(duration)) {
      throw new Error("Marquee animations are unavailable");
    }
    animations[0].currentTime = duration * 0.4;
    animations[1].currentTime = duration * 0.9;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
    (window as typeof window & { __marqueeAnimations?: Animation[] }).__marqueeAnimations = animations;
    return { duration, sampledAt: performance.now(), x: matrix.m41, y: matrix.m42 };
  });

  await slider.fill("37.5");
  await expect(slider).toHaveValue("37.5");

  const immediatelyAfter = await page.locator(".moving-text").evaluate((moving) => {
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const remembered = (window as typeof window & { __marqueeAnimations?: Animation[] })
      .__marqueeAnimations;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    return {
      duration,
      animationCount: animations.length,
      sameAnimations: animations.every((animation, index) => animation === remembered?.[index]),
      sampledAt: performance.now(),
      x: matrix.m41,
      y: matrix.m42,
    };
  });

  const elapsedSeconds =
    (immediatelyAfter.sampledAt - before.sampledAt) / 1000;
  const distanceMoved = Math.hypot(
    immediatelyAfter.x - before.x,
    immediatelyAfter.y - before.y,
  );
  expect(immediatelyAfter.animationCount).toBe(2);
  expect(immediatelyAfter.sameAnimations).toBe(true);
  expect(immediatelyAfter.duration).toBeCloseTo(before.duration, 5);
  expect(immediatelyAfter.x).toBeLessThanOrEqual(before.x + 2);
  expect(distanceMoved).toBeLessThanOrEqual(614 * elapsedSeconds + 8);

  await page.waitForTimeout(450);
  const finalRates = await page.locator(".moving-text").evaluate((moving) =>
    [...moving.querySelectorAll<HTMLElement>(".marquee-copy")].map(
      (copy) => copy.getAnimations()[0]?.playbackRate,
    ),
  );
  expect(finalRates).toHaveLength(2);
  finalRates.forEach((rate) => expect(rate).toBeCloseTo(4.8, 1));
});

test("marquee speed preview keeps the board state untouched until release", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await editBoardText(page, "Imperative speed preview");
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const dialog = page.locator("#tool-panel-marquee");
  await dialog.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  const slider = dialog.getByRole("slider", { name: /速度|Speed/ });
  await page.waitForFunction(() => {
    const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
    return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
  });
  await page.waitForTimeout(100);

  await page.evaluate(() => {
    (window as typeof window & { __boardMutationCount?: number }).__boardMutationCount = 0;
    const board = document.querySelector("main.board");
    if (!board) throw new Error("Board is unavailable");
    const observer = new MutationObserver((records) => {
      (window as typeof window & { __boardMutationCount?: number }).__boardMutationCount =
        ((window as typeof window & { __boardMutationCount?: number }).__boardMutationCount ?? 0) + records.length;
    });
    observer.observe(board, { attributes: true, childList: true, subtree: true });
    (window as typeof window & { __boardObserver?: MutationObserver }).__boardObserver = observer;
  });

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "37.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(180);
  expect(await page.evaluate(() =>
    (window as typeof window & { __boardMutationCount?: number }).__boardMutationCount,
  )).toBe(0);

  await slider.dispatchEvent("pointerup");
  await expect(slider).toHaveValue("37.5");
  await page.evaluate(() => {
    (window as typeof window & { __boardObserver?: MutationObserver }).__boardObserver?.disconnect();
  });
});

test("a real marquee pointer drag commits only after release", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();

  const dialog = page.locator("#tool-panel-marquee");
  const slider = dialog.getByRole("slider", { name: /速度|Speed/ });
  const bounds = await slider.boundingBox();
  if (!bounds) throw new Error("Marquee speed slider is unavailable");

  const initialSpeed = Number(await slider.inputValue());
  const minSpeed = Number(await slider.getAttribute("min"));
  const maxSpeed = Number(await slider.getAttribute("max"));
  const initialRatio = (initialSpeed - minSpeed) / (maxSpeed - minSpeed);
  const trackInset = Math.min(12, bounds.width * 0.08);
  const startX = bounds.x + trackInset + initialRatio * (bounds.width - trackInset * 2);
  const endX = bounds.x + bounds.width * 0.82;
  const y = bounds.y + bounds.height / 2;

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await expect(slider).not.toHaveValue(String(initialSpeed));

  // A cancelled physical gesture must restore the last workspace value.
  await slider.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(slider).toHaveValue(String(initialSpeed));
  await dialog.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const reopenedDialog = page.locator("#tool-panel-marquee");
  const reopenedSlider = reopenedDialog.getByRole("slider", { name: /速度|Speed/ });
  await expect(reopenedSlider).toHaveValue(String(initialSpeed));

  const reopenedBounds = await reopenedSlider.boundingBox();
  if (!reopenedBounds) throw new Error("Reopened marquee speed slider is unavailable");
  const reopenedStartX =
    reopenedBounds.x + trackInset + initialRatio * (reopenedBounds.width - trackInset * 2);
  const reopenedEndX = reopenedBounds.x + reopenedBounds.width * 0.7;
  const reopenedY = reopenedBounds.y + reopenedBounds.height / 2;
  await page.mouse.move(reopenedStartX, reopenedY);
  await page.mouse.down();
  await page.mouse.move(reopenedEndX, reopenedY, { steps: 8 });
  await page.mouse.up();

  const releasedSpeed = await reopenedSlider.inputValue();
  expect(Number(releasedSpeed)).toBeGreaterThan(initialSpeed);
  await reopenedDialog.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await expect(
    page.locator("#tool-panel-marquee").getByRole("slider", { name: /速度|Speed/ }),
  ).toHaveValue(releasedSpeed);
});

test("marquee repeats seamlessly with two compositor copies and a half-screen gap", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await editBoardText(page, "Seamless repeat");
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page
    .locator("#tool-panel-marquee")
    .getByRole("button", { name: /啟用跑馬燈|Enable marquee/ })
    .click();
  await page.waitForFunction(
    () => {
      const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
      return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
    },
  );

  const samples = await page.locator(".moving-text").evaluate((moving) => {
    const viewport = moving.closest<HTMLElement>(".text-viewport");
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    if (!viewport || animations.some((animation) => !animation) || !Number.isFinite(duration)) {
      throw new Error("Marquee geometry is unavailable");
    }
    animations.forEach((animation) => animation.pause());
    if (copies.length !== 2) throw new Error("Marquee copies are unavailable");
    const viewportRect = viewport.getBoundingClientRect();
    const copyWidth = copies[0].getBoundingClientRect().width;
    const copyGap = Number.parseFloat(
      getComputedStyle(moving).getPropertyValue("--marquee-copy-gap"),
    );
    const cycleDistance = copyWidth + copyGap;

    const sampleAt = (time: number) => {
      animations[0].currentTime = time;
      animations[1].currentTime = time + duration / 2;
      return copies
        .map((copy) => {
          const rect = copy.getBoundingClientRect();
          return {
            left: rect.left - viewportRect.left,
            right: rect.right - viewportRect.left,
          };
        })
        .filter((rect) => rect.right > 0 && rect.left < viewportRect.width)
        .sort((left, right) => left.left - right.left);
    };

    return {
      copyCount: copies.length,
      copyGap,
      copyWillChange: copies.map((copy) => getComputedStyle(copy).willChange),
      gapRatio: copyGap / viewportRect.width,
      hostWillChange: getComputedStyle(moving).willChange,
      viewportWidth: viewportRect.width,
      beforeReset: sampleAt(duration - 1),
      overlap: sampleAt(duration * ((copyGap / 2) / (cycleDistance * 2))),
      reset: sampleAt(duration + 1),
      start: sampleAt(0),
    };
  });

  expect(samples.copyCount).toBe(2);
  expect(samples.copyWillChange).toEqual(["transform", "transform"]);
  expect(samples.hostWillChange).not.toBe("transform");
  expect(samples.gapRatio).toBeCloseTo(0.5, 2);
  expect(samples.start).toHaveLength(1);
  expect(samples.overlap).toHaveLength(2);
  expect(Math.abs(
    samples.overlap[1].left - samples.overlap[0].right - samples.copyGap,
  )).toBeLessThan(1);
  expect(samples.beforeReset).toHaveLength(1);
  expect(samples.reset).toHaveLength(2);
  expect(samples.beforeReset[0].left).toBeCloseTo(samples.start[0].left, 0);
  expect(samples.beforeReset[0].right).toBeCloseTo(samples.start[0].right, 0);
  expect(samples.reset[0].left).toBeCloseTo(samples.start[0].left, 0);
  expect(samples.reset[0].right).toBeCloseTo(samples.start[0].right, 0);
  expect(samples.viewportWidth - samples.reset[1].left).toBeLessThan(2);
});

test("marquee shares one synchronized flash timeline regardless of toggle order", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await editBoardText(page, "Synchronized flash");

  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await page.getByRole("button", { name: /柔和閃爍|Gentle flash/ }).click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page.locator("#tool-panel-marquee")
    .getByRole("button", { name: /啟用跑馬燈|Enable marquee/ })
    .click();

  const flashTimelines = await page.locator(".moving-text").evaluate((moving) => ({
    flashElements:
      Number(moving.matches(".is-flashing")) +
      moving.querySelectorAll(".is-flashing").length,
    opacityAnimations: moving
      .getAnimations({ subtree: true })
      .filter((animation) => {
        const effect = animation.effect;
        return effect instanceof KeyframeEffect && effect.getKeyframes()
          .some((frame) => frame.opacity !== undefined);
      }).length,
  }));
  expect(flashTimelines).toEqual({ flashElements: 1, opacityAnimations: 1 });
});

test("marquee keeps two synchronized compositor layers in every direction", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  await editBoardText(page, "Four-direction motion");
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const marqueeDialog = page.locator("#tool-panel-marquee");
  await marqueeDialog
    .getByRole("button", { name: /啟用跑馬燈|Enable marquee/ })
    .click();

  const directions = [
    { axis: "x", buttonIndex: 0, sign: -1 },
    { axis: "x", buttonIndex: 1, sign: 1 },
    { axis: "y", buttonIndex: 2, sign: -1 },
    { axis: "y", buttonIndex: 3, sign: 1 },
  ] as const;

  for (const direction of directions) {
    await marqueeDialog.locator(".segmented button").nth(direction.buttonIndex).click();
    await page.waitForFunction(
      ({ axis, sign }) => {
        const copies = [
          ...document.querySelectorAll<HTMLElement>(".marquee-copy"),
        ];
        const animation = copies[0]?.getAnimations()[0];
        const frames = animation?.effect instanceof KeyframeEffect
          ? animation.effect.getKeyframes()
          : [];
        if (copies.length !== 2 || frames.length < 2) return false;
        const start = new DOMMatrixReadOnly(String(frames[0].transform));
        const end = new DOMMatrixReadOnly(String(frames.at(-1)?.transform));
        const delta = axis === "x" ? end.m41 - start.m41 : end.m42 - start.m42;
        return Math.sign(delta) === sign;
      },
      direction,
    );

    const metrics = await page.locator(".moving-text").evaluate(
      (moving, { axis }) => {
        const viewport = moving.closest<HTMLElement>(".text-viewport");
        const copies = [
          ...moving.querySelectorAll<HTMLElement>(".marquee-copy"),
        ];
        const animations = copies.map((copy) => copy.getAnimations()[0]);
        const duration = Number(animations[0]?.effect?.getTiming().duration);
        if (!viewport || animations.some((animation) => !animation) || !Number.isFinite(duration)) {
          throw new Error("Marquee animations are unavailable");
        }
        const initialTimes = animations.map(
          (animation) => Number(animation.currentTime) % duration,
        );
        const phaseDistance = Math.abs(initialTimes[1] - initialTimes[0]);
        const phaseError = Math.abs(
          Math.min(phaseDistance, duration - phaseDistance) - duration / 2,
        );

        animations.forEach((animation) => animation.pause());
        animations[0].currentTime = 0;
        const start = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
        animations[0].currentTime = duration * 0.25;
        const quarter = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
        const hostRect = moving.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();

        return {
          axisDelta: axis === "x" ? quarter.m41 - start.m41 : quarter.m42 - start.m42,
          copyCount: copies.length,
          crossAxisDelta: axis === "x" ? quarter.m42 - start.m42 : quarter.m41 - start.m41,
          hostHeight: hostRect.height,
          hostWidth: hostRect.width,
          phaseError,
          viewportHeight: viewportRect.height,
          viewportWidth: viewportRect.width,
        };
      },
      direction,
    );

    expect(metrics.copyCount).toBe(2);
    expect(Math.sign(metrics.axisDelta)).toBe(direction.sign);
    expect(Math.abs(metrics.crossAxisDelta)).toBeLessThan(0.5);
    expect(metrics.phaseError).toBeLessThan(0.5);
    expect(metrics.hostWidth).toBeCloseTo(metrics.viewportWidth, 1);
    expect(metrics.hostHeight).toBeCloseTo(metrics.viewportHeight, 1);
  }
});

test("horizontal marquee keeps legal worst-case text within the layer budget", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_REGULAR_PROJECT);
  await dismissPwaBanner(page);
  const worstCase = "W".repeat(350);
  await editBoardText(page, worstCase);
  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  await page.getByRole("slider", { name: /畫面填滿程度|Screen fill/ }).fill("100");
  await page.getByRole("button", { name: /關閉|Close/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page.locator("#tool-panel-marquee")
    .getByRole("button", { name: /啟用跑馬燈|Enable marquee/ })
    .click();

  await expect.poll(async () => page.locator(".marquee-copy").first().evaluate(
    (copy) => copy.getBoundingClientRect().width,
  )).toBeLessThanOrEqual(16_385);
  const metrics = await page.locator(".moving-text").evaluate((moving) => ({
    copyWidth: moving.querySelector<HTMLElement>(".marquee-copy")
      ?.getBoundingClientRect().width ?? 0,
    fontSize: Number.parseFloat(getComputedStyle(moving).fontSize),
  }));
  expect(metrics.copyWidth).toBeLessThanOrEqual(16_385);
  expect(metrics.fontSize).toBeGreaterThanOrEqual(24);
});

test("an extreme DPR 3 vertical marquee is safely suppressed with guidance", async ({
  page,
}, testInfo) => {
  skipUnlessProject(testInfo, CHROMIUM_DPR3_PROJECT);
  await dismissPwaBanner(page);
  const multiline = Array.from({ length: 175 }, () => "W").join("\n");
  expect(Array.from(multiline)).toHaveLength(349);
  await editBoardText(page, multiline);
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.locator(".segmented button").nth(2).click();
  await panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();

  const moving = page.locator(".moving-text");
  await expect(moving).toHaveClass(/is-marquee-suppressed/);
  await expect(page.locator(".canvas-overflow-warning")).toBeVisible();
  const metrics = await moving.evaluate((host) => {
    const copy = host.querySelector<HTMLElement>(".marquee-copy");
    if (!copy) throw new Error("Marquee copy is unavailable");
    const rect = copy.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    const physicalWidth = Math.ceil(
      Math.max(rect.width, copy.offsetWidth, copy.scrollWidth) * dpr,
    );
    const physicalHeight = Math.ceil(
      Math.max(rect.height, copy.offsetHeight, copy.scrollHeight) * dpr,
    );
    return {
      animationCount: copy.getAnimations().length,
      dpr,
      physicalArea: physicalWidth * physicalHeight,
      physicalWidth,
    };
  });
  expect(metrics.dpr).toBe(3);
  expect(metrics.animationCount).toBe(0);
  expect(
    metrics.physicalWidth > 16_384 || metrics.physicalArea > 8_000_000,
  ).toBe(true);
});

test("responsive font fill grows beyond 200px and shrinks at the canvas boundary", async ({
  page,
}, testInfo) => {
  skipUnlessFontFillProject(testInfo);
  await dismissPwaBanner(page);
  await editBoardText(page, "A");

  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  const fontDialog = page.locator("#tool-panel-font");
  const fillSlider = fontDialog.getByRole("slider", {
    name: /畫面填滿程度|Screen fill/,
  });
  await expect(fillSlider).toHaveAttribute("min", "5");
  await expect(fillSlider).toHaveAttribute("max", "100");
  await fillSlider.fill("50");
  await fontDialog.locator(".panel-close").click();
  await expect.poll(async () => (await textFitMetrics(page)).fontSize).toBeGreaterThan(200);
  await page.waitForTimeout(160);
  const shortHalf = await textFitMetrics(page);

  await editBoardText(page, "AAAA");
  await expect.poll(async () => (await textFitMetrics(page)).fontSize).toBeLessThanOrEqual(
    shortHalf.fontSize,
  );
  await page.waitForTimeout(160);
  const longerHalf = await textFitMetrics(page);
  expect(longerHalf.fontSize).toBeLessThanOrEqual(shortHalf.fontSize);

  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  await fillSlider.fill("100");
  await expect(fillSlider).toHaveValue("100");
  await fontDialog.locator(".panel-close").click();

  await expect.poll(async () => (await textFitMetrics(page)).fontSize).toBeGreaterThan(200);
  await page.waitForTimeout(160);
  await expect.poll(async () => {
    const metrics = await textFitMetrics(page);
    return Math.min(
      (metrics.viewportHeight - metrics.contentHeight) / metrics.viewportHeight,
      (metrics.viewportWidth - metrics.contentWidth) / metrics.viewportWidth,
    );
  }).toBeLessThanOrEqual(0.06);
  const shortText = await textFitMetrics(page);
  expect(shortText.contentHeight).toBeLessThanOrEqual(shortText.viewportHeight + 2);
  expect(shortText.contentWidth).toBeLessThanOrEqual(shortText.viewportWidth + 2);

  await editBoardText(
    page,
    "這是一段會依照目前畫布寬高自動縮小的長文字 Responsive text",
  );
  await expect.poll(async () => (await textFitMetrics(page)).fontSize).toBeLessThan(
    shortText.fontSize,
  );
  await expect.poll(async () => {
    const metrics = await textFitMetrics(page);
    return Math.max(
      metrics.contentHeight - metrics.viewportHeight,
      metrics.contentWidth - metrics.viewportWidth,
    );
  }).toBeLessThanOrEqual(2);
  const longText = await textFitMetrics(page);
  expect(longText.fontSize).toBeLessThan(shortText.fontSize);
  expect(longText.contentHeight).toBeLessThanOrEqual(longText.viewportHeight + 2);
  expect(longText.contentWidth).toBeLessThanOrEqual(longText.viewportWidth + 2);

  await enableQrCode(page, "responsive-fit-check");
  await page.waitForTimeout(160);
  const withQr = await textFitMetrics(page);
  expect(withQr.fontSize).toBeLessThan(longText.fontSize);
  expect(withQr.contentHeight).toBeLessThanOrEqual(withQr.viewportHeight + 24);
  expect(withQr.contentWidth).toBeLessThanOrEqual(withQr.viewportWidth + 24);
});

test("adds a page and switches with accessible controls", async ({ page }) => {
  await page.getByRole("button", { name: /更多工具|More tools/ }).click();
  await page.getByRole("button", { name: /頁面管理|Manage pages/ }).click();
  await page.getByRole("button", { name: /新增頁面|Add page/ }).click();
  await expect(page.locator(".page-list > li")).toHaveCount(2);
  await expect(page.locator(".page-indicator")).toContainText(/2/);
});

test("compact layout keeps its floating toolbar and QR panel usable", async ({ page }) => {
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

test("toolbar drags freely, clamps, and idles smoothly", async ({
  page,
}, testInfo) => {
  skipUnlessToolbarProject(testInfo);
  await dismissPwaBanner(page);

  const toolbarShell = page.locator(".toolbar-shell");
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (!viewport) return;

  const initial = await toolbarCenter(page);
  const desired = {
    x: viewport.width * (testInfo.project.name === CHROMIUM_COMPACT_PROJECT ? 0.508 : 0.68),
    y: viewport.height * 0.38,
  };
  const freelyMoved = await dragToolbarCenterTo(page, desired);
  expect(Math.abs(freelyMoved.x - initial.x)).toBeGreaterThan(
    testInfo.project.name === CHROMIUM_COMPACT_PROJECT ? 2 : 80,
  );
  expect(Math.abs(freelyMoved.y - initial.y)).toBeGreaterThan(100);
  expect(freelyMoved.x).toBeCloseTo(desired.x, 0);
  expect(freelyMoved.y).toBeCloseTo(desired.y, 0);

  await dragToolbarPointerTo(page, { x: 0, y: 0 });
  await expectWithinViewport(page, ".toolbar-shell");
  await dragToolbarPointerTo(page, {
    x: viewport.width - 1,
    y: viewport.height - 1,
  });
  await expectWithinViewport(page, ".toolbar-shell");

  await dragToolbarCenterTo(page, desired);

  await page.clock.install();
  await page.reload({ waitUntil: "domcontentloaded" });
  await dismissPwaBanner(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const canvas = page.getByRole("main");
  await canvas.click({ position: { x: 12, y: viewport.height / 2 } });
  await expect(toolbarShell).not.toHaveClass(/is-idle/);

  const opacityTransition = await toolbarShell.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: Number.parseFloat(style.transitionDuration) * 1_000,
      property: style.transitionProperty,
    };
  });
  expect(opacityTransition.property).toContain("opacity");
  expect(opacityTransition.duration).toBeGreaterThan(0);
  expect(opacityTransition.duration).toBeLessThanOrEqual(500);

  await page.clock.fastForward(9_000);
  await expect(toolbarShell).not.toHaveClass(/is-idle/);
  await page.clock.fastForward(1_000);
  await expect(toolbarShell).toHaveClass(/is-idle/);
  await expect(toolbarShell).toHaveCSS("opacity", "0.18");

  await canvas.click({ position: { x: 12, y: viewport.height / 2 } });
  await expect(toolbarShell).not.toHaveClass(/is-idle/);
  await expect(toolbarShell).toHaveCSS("opacity", "1");
});

test("settings switches keep fixed geometry while toggling", async ({
  page,
}, testInfo) => {
  skipUnlessToolbarProject(testInfo);
  await dismissPwaBanner(page);
  const settingsDialog = await openSettings(page);
  await expectWithinViewport(
    page,
    '[role="dialog"][aria-labelledby="settings-panel-title"]',
  );

  const settingSwitch = settingsDialog.getByRole("switch").nth(1);
  const geometry = await settingSwitch.evaluate((element) => {
    const button = element.getBoundingClientRect();
    const before = getComputedStyle(element, "::before");
    const after = getComputedStyle(element, "::after");
    return {
      button: { height: button.height, width: button.width },
      before: {
        height: Number.parseFloat(before.height),
        left: Number.parseFloat(before.left),
        top: Number.parseFloat(before.top),
        width: Number.parseFloat(before.width),
      },
      after: {
        height: Number.parseFloat(after.height),
        left: Number.parseFloat(after.left),
        top: Number.parseFloat(after.top),
        transitionDuration: Number.parseFloat(after.transitionDuration) * 1_000,
        width: Number.parseFloat(after.width),
      },
    };
  });

  expect(geometry.button.width).toBeCloseTo(48, 1);
  expect(geometry.button.height).toBeCloseTo(44, 1);
  expect(geometry.before).toMatchObject({
    height: 28,
    left: 2,
    top: 8,
    width: 44,
  });
  expect(geometry.after).toMatchObject({
    height: 24,
    left: 4,
    top: 10,
    width: 24,
  });
  expect(geometry.after.transitionDuration).toBeGreaterThan(0);
  expect(geometry.after.transitionDuration).toBeLessThanOrEqual(500);

  await expect(settingSwitch).toHaveAttribute("aria-checked", "false");
  await settingSwitch.click();
  await expect(settingSwitch).toHaveAttribute("aria-checked", "true");
  await expect.poll(async () => settingSwitch.evaluate((element) => {
    const transform = getComputedStyle(element, "::after").transform;
    return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m41;
  })).toBeCloseTo(16, 1);
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
