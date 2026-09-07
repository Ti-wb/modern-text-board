import { expect, test, type Page } from "@playwright/test";

async function edit(page: Page, text: string) {
  await page.getByRole("main").dblclick();
  await page.getByRole("textbox", { name: /編輯文字|Edit text/ }).fill(text);
  await page.getByRole("button", { name: /套用|Apply/ }).click();
}

async function prepare(page: Page, text: string, cached: boolean, vertical = false) {
  await page.goto(`/?marquee-raster=${cached ? 1 : 0}`);
  await edit(page, text);
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  if (vertical) await panel.getByRole("button", { name: /向上|^Up$/ }).click();
  await panel.getByRole("button", { name: /關閉|Close/ }).click();
  await expect(page.locator(".marquee-copy")).toHaveCount(2);
  if (cached) await expect(page.locator(".moving-text")).toHaveAttribute("data-marquee-ink", "cached");
  else await expect(page.locator(".marquee-ink-cache")).toHaveCount(0);
  await expect.poll(() => page.locator(".marquee-copy").first().evaluate((copy) => copy.getAnimations().length)).toBe(1);
}

test("reuses full-DPR ink while changing speed and replaces it after editing", async ({ page }) => {
  await prepare(page, "Hello 你好 👩🏽‍💻", true);
  await page.locator(".moving-text").evaluate((moving) => {
    Reflect.set(window, "savedInk", moving.querySelector("canvas"));
  });
  const dimensions = await page.locator(".marquee-ink-cache").first().evaluate((canvas) => {
    const element = canvas as HTMLCanvasElement;
    return { width: element.width, cssWidth: Number.parseFloat(element.style.width), dpr: devicePixelRatio };
  });
  expect(dimensions.width).toBeCloseTo(dimensions.cssWidth * dimensions.dpr, 5);
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  const panel = page.locator("#tool-panel-marquee");
  await panel.getByRole("slider", { name: /速度|Speed/ }).fill("40");
  await panel.getByRole("button", { name: /關閉|Close/ }).click();
  expect(await page.evaluate(() => Reflect.get(window, "savedInk") === document.querySelector(".marquee-ink-cache"))).toBe(true);
  await edit(page, "更新內容 New text 🚀");
  await expect(page.locator(".moving-text")).toHaveAttribute("data-marquee-ink", "cached");
  expect(await page.evaluate(() => Reflect.get(window, "savedInk") === document.querySelector(".marquee-ink-cache"))).toBe(false);
  await expect(page.locator(".display-text").first()).toHaveText("更新內容 New text 🚀");
});

test("native fallback preserves tab stops", async ({ page }) => {
  await page.goto("/?marquee-raster=1");
  await edit(page, "A\tB");
  await page.getByRole("button", { name: /跑馬燈|Marquee/ }).click();
  await page.locator("#tool-panel-marquee").getByRole("button", { name: /啟用跑馬燈|Enable marquee/ }).click();
  await expect(page.locator(".moving-text")).toHaveAttribute("data-marquee-ink", "native");
  await expect(page.locator(".marquee-ink-cache")).toHaveCount(0);
  await expect(page.locator(".display-text").first()).toHaveCSS("opacity", "1");
});

test("refreshes the cache after an optional web font becomes ready", async ({ page }) => {
  await prepare(page, "字型切換 Font", true);
  const original = await page.locator(".marquee-ink-cache").first().elementHandle();
  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  const panel = page.locator("#tool-panel-font");
  await panel.getByRole("tab", { name: "Web Fonts" }).click();
  await panel.locator("button.web-font-option").filter({ hasText: "Iansui" }).click();
  await expect(page.locator(".moving-text")).toHaveCSS("font-family", /Iansui/, { timeout: 15000 });
  await expect(page.locator(".moving-text")).toHaveAttribute("data-marquee-ink", "cached");
  expect(await original!.evaluate((element) => element.isConnected)).toBe(false);
  await expect(page.locator(".display-text").first()).toHaveText("字型切換 Font");
});

test("keeps font dragging native and rasterizes once after settling", async ({ page }) => {
  await page.addInitScript(() => {
    Reflect.set(window, "inkDraws", 0);
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (...args) {
      Reflect.set(window, "inkDraws", Reflect.get(window, "inkDraws") + 1);
      return fillText.apply(this, args);
    };
  });
  await prepare(page, "Hello 你好", true);
  await page.getByRole("button", { name: /字型與字級|Font and size/ }).click();
  const slider = page.getByRole("slider", { name: /畫面填滿程度|Screen fill/ });
  const before = await page.evaluate(() => Reflect.get(window, "inkDraws") as number);
  await slider.evaluate(async (element) => {
    const input = element as HTMLInputElement;
    for (const value of [10, 11, 12, 13, 14, 15]) {
      await new Promise(requestAnimationFrame);
      input.value = String(value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await new Promise(requestAnimationFrame);
  });
  expect(await page.evaluate(() => Reflect.get(window, "inkDraws"))).toBe(before);
  await expect(page.locator(".moving-text")).toHaveAttribute("data-marquee-ink", "cached");
  expect(await page.evaluate(() => Reflect.get(window, "inkDraws"))).toBe(before + 1);
});

for (const [name, text, vertical, mirrored] of [
  ["mixed", "Hello 你好 🚀", false, false],
  ["graphemes", "👩🏽‍💻 👨‍👩‍👧‍👦 🇹🇼", false, false],
  ["multiline", "日常使用 Daily\n\n第二行 café Á", false, false],
  ["wrapped", "第一行文字比較長，需要完整換行。\n第二行 Hello world 🚀", true, false],
  ["mirrored", "Hello 你好 🚀", false, true],
] as const) {
  test(`${name} preserves glyph shapes within one physical pixel`, async ({ browser }) => {
    const shots: string[] = [];
    const geometries: string[][] = [];
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
    try {
      for (const cached of [false, true]) {
        // A new page/context avoids previously persisted marquee settings.
        const isolated = await browser.newContext({ viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2 });
        try {
          const page = await isolated.newPage();
          await prepare(page, text, cached, vertical);
          // Let the existing resize settling pass finish before comparing paths.
          await page.waitForTimeout(150);
          geometries.push(await page.locator(".moving-text").evaluate((moving) => {
            const style = getComputedStyle(moving);
            return ["--marquee-start-x", "--marquee-start-y", "--marquee-end-x", "--marquee-end-y", "--marquee-base-duration", "--marquee-copy-gap"]
              .map((property) => style.getPropertyValue(property));
          }));
          await page.locator(".moving-text").evaluate((moving, mirror) => {
            moving.querySelectorAll<HTMLElement>(".marquee-copy").forEach((copy, index) => {
              copy.getAnimations().forEach((animation) => animation.cancel());
              copy.style.transform = "translate3d(20px, 30px, 0)";
              if (index) copy.style.visibility = "hidden";
              if (mirror) copy.querySelector(".marquee-ink")!.classList.add("is-mirrored");
            });
          }, mirrored);
          await page.addStyleTag({ content: ".toolbar-shell,.tool-panel-wrap,.pwa-status,.page-indicator{visibility:hidden!important}" });
          shots.push((await page.screenshot()).toString("base64"));
        } finally { await isolated.close(); }
      }
      expect(geometries[0]).toEqual(geometries[1]);
      const page = await context.newPage();
      const unmatched = await page.evaluate(async (images) => {
        let width = 0;
        let height = 0;
        const pixels = await Promise.all(images.map(async (encoded) => {
          const image = new Image();
          image.src = `data:image/png;base64,${encoded}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          width = canvas.width = image.width;
          height = canvas.height = image.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, width, height).data;
        }));
        const dark = (data: Uint8ClampedArray, x: number, y: number) => {
          if (x < 0 || y < 0 || x >= width || y >= height) return false;
          const index = (y * width + x) * 4;
          return Math.min(data[index], data[index + 1], data[index + 2]) < 160;
        };
        let ink = 0;
        let different = 0;
        for (let source = 0; source < 2; source += 1) {
          for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
            if (!dark(pixels[source], x, y)) continue;
            ink += 1;
            let matches = false;
            for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
              if (dark(pixels[1 - source], x + dx, y + dy)) matches = true;
            }
            if (!matches) different += 1;
          }
        }
        return { ink, ratio: different / Math.max(1, ink) };
      }, shots);
      expect(unmatched.ink).toBeGreaterThan(1000);
      // Allows raster edge antialiasing, but catches shifts, synthesized bold,
      // missing glyphs, lost line breaks and clipped accents.
      expect(unmatched.ratio).toBeLessThan(0.005);
    } finally { await context.close(); }
  });
}
