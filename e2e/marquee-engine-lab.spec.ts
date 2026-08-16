import { expect, test, type Page } from "@playwright/test";

async function dismissPwaBanner(page: Page) {
  const banner = page.locator(".pwa-status");
  if (await banner.isVisible().catch(() => false)) {
    const dismiss = banner.getByRole("button").last();
    if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
  }
}

async function enableMarquee(page: Page, engine: "css" | "canvas") {
  await page.goto(`/?marquee-engine=${engine}`);
  await dismissPwaBanner(page);
  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ })
    .fill("Marquee engine continuity test 🚀");
  await page.getByRole("button", { name: /套用|Apply/ }).click();
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  await expect(page.locator(".text-viewport"))
    .toHaveAttribute("data-marquee-engine", engine);
  return panel.getByRole("slider", { name: /速度|Speed/ });
}

test("CSS engine preserves animation identity and phase during speed preview", async ({
  page,
}) => {
  const slider = await enableMarquee(page, "css");
  await page.waitForFunction(() => {
    const copies = [...document.querySelectorAll<HTMLElement>(".marquee-copy")];
    return copies.length === 2 && copies.every((copy) => copy.getAnimations().length === 1);
  });

  const before = await page.locator(".moving-text").evaluate((moving) => {
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const duration = Number(animations[0]?.effect?.getTiming().duration);
    if (animations.some((animation) => !animation) || !Number.isFinite(duration)) {
      throw new Error("CSS marquee animations are unavailable");
    }
    animations.forEach((animation) => {
      animation.pause();
      animation.currentTime = duration * 0.3;
    });
    const matrix = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
    (window as typeof window & { __cssMarqueeAnimations?: Animation[] })
      .__cssMarqueeAnimations = animations;
    return { duration, x: matrix.m41, y: matrix.m42 };
  });

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "37.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  const after = await page.locator(".moving-text").evaluate((moving) => {
    const copies = [...moving.querySelectorAll<HTMLElement>(".marquee-copy")];
    const animations = copies.map((copy) => copy.getAnimations()[0]);
    const remembered = (
      window as typeof window & { __cssMarqueeAnimations?: Animation[] }
    ).__cssMarqueeAnimations;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(copies[0]).transform);
    return {
      duration: Number(animations[0]?.effect?.getTiming().duration),
      sameAnimations: animations.every(
        (animation, index) => animation === remembered?.[index],
      ),
      x: matrix.m41,
      y: matrix.m42,
    };
  });

  expect(after.sameAnimations).toBe(true);
  expect(after.duration).not.toBeCloseTo(before.duration, 2);
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeLessThanOrEqual(2);
});

test("Canvas engine keeps one bounded surface during live speed changes", async ({
  page,
}) => {
  const slider = await enableMarquee(page, "canvas");
  const canvas = page.locator(".canvas-marquee-surface");
  await expect(canvas).toBeVisible();
  await expect(page.locator(".marquee-copy")).toHaveCount(0);

  const before = await canvas.evaluate((surface) => {
    const element = surface as HTMLCanvasElement;
    (window as typeof window & { __canvasMarqueeSurface?: HTMLCanvasElement })
      .__canvasMarqueeSurface = element;
    return {
      area: element.width * element.height,
      height: element.height,
      width: element.width,
    };
  });
  expect(before.area).toBeLessThanOrEqual(8_000_000);

  await slider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "37.5";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));

  const after = await canvas.evaluate((surface) => {
    const element = surface as HTMLCanvasElement;
    return {
      height: element.height,
      sameSurface: element === (
        window as typeof window & { __canvasMarqueeSurface?: HTMLCanvasElement }
      ).__canvasMarqueeSurface,
      width: element.width,
    };
  });
  expect(after).toEqual({
    height: before.height,
    sameSurface: true,
    width: before.width,
  });
});
