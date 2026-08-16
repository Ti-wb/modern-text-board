import { expect, test } from "@playwright/test";

const CLEAN_PATH = "/experiments/marquee-clean/";

test.describe("framework-free marquee fixture", () => {
  test("loads only the clean static runtime and reaches zero application rAF", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const instrumentedWindow = window as typeof window & {
        __cleanTestRafRequests: number;
      };
      const original = window.requestAnimationFrame.bind(window);
      instrumentedWindow.__cleanTestRafRequests = 0;
      window.requestAnimationFrame = (callback) => {
        instrumentedWindow.__cleanTestRafRequests += 1;
        return original(callback);
      };
    });

    await page.goto(`${CLEAN_PATH}?text=Clean%20marquee&direction=left`);
    await expect(page.locator("html")).toHaveAttribute(
      "data-clean-marquee-state",
      "ready",
    );

    await expect(page.locator("#app, .toolbar, .marquee-lab-switcher")).toHaveCount(0);
    await expect(page.locator(".clean-marquee__copy")).toHaveCount(2);
    await expect(page.locator("canvas")).toHaveCount(0);

    const runtime = await page.evaluate(async () => {
      const instrumentedWindow = window as typeof window & {
        __cleanMarqueeSnapshot?: {
          fontSize: number;
          gapRatio: number;
          speed: number;
          speedPixelsPerSecond: number;
          text: string;
        };
        __cleanTestRafRequests: number;
      };
      const before = instrumentedWindow.__cleanTestRafRequests;
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = instrumentedWindow.__cleanTestRafRequests;
      const resources = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name);
      const registrations = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      return {
        after,
        before,
        registrations: registrations.length,
        resources,
        scripts: [...document.scripts].map((script) => script.src),
        snapshot: instrumentedWindow.__cleanMarqueeSnapshot,
      };
    });

    expect(runtime.after).toBe(runtime.before);
    expect(runtime.registrations).toBe(0);
    expect(runtime.scripts).toEqual([
      expect.stringContaining("/experiments/marquee-clean/marquee-clean.js"),
    ]);
    expect(runtime.resources.some((url) => url.includes("/assets/index-"))).toBe(false);
    expect(runtime.resources.some((url) => url.includes("/@vite/client"))).toBe(false);
    expect(runtime.snapshot).toMatchObject({
      fontSize: 80,
      gapRatio: 0.5,
      speed: 40,
      text: "Clean marquee",
    });
    expect(runtime.snapshot?.speedPixelsPerSecond).toBeCloseTo(
      613.3333333333334,
      8,
    );
  });

  for (const direction of ["left", "right", "up", "down"] as const) {
    test(`keeps two half-cycle CSS copies moving ${direction}`, async ({ page }) => {
      await page.goto(
        `${CLEAN_PATH}?text=Direction%20test&speed=20&gap=0.5&direction=${direction}`,
      );
      await expect(page.locator("html")).toHaveAttribute(
        "data-clean-marquee-state",
        "ready",
      );

      const state = await page.locator("#clean-marquee").evaluate((element) => {
        const copies = [
          ...element.querySelectorAll<HTMLElement>(".clean-marquee__copy"),
        ];
        const rootStyle = document.documentElement.style;
        const snapshot = (
          window as typeof window & {
            __cleanMarqueeSnapshot?: {
              copyGap: number;
              direction: string;
              distance: number;
              durationMs: number;
              speed: number;
              speedPixelsPerSecond: number;
              viewportExtent: number;
            };
          }
        ).__cleanMarqueeSnapshot;
        return {
          animationCounts: copies.map((copy) => copy.getAnimations().length),
          delays: copies.map((copy) => getComputedStyle(copy).animationDelay),
          endX: Number.parseFloat(rootStyle.getPropertyValue("--clean-end-x")),
          endY: Number.parseFloat(rootStyle.getPropertyValue("--clean-end-y")),
          snapshot,
          startX: Number.parseFloat(rootStyle.getPropertyValue("--clean-start-x")),
          startY: Number.parseFloat(rootStyle.getPropertyValue("--clean-start-y")),
        };
      });

      expect(state.animationCounts).toEqual([1, 1]);
      expect(state.snapshot).toBeTruthy();
      expect(state.snapshot?.direction).toBe(direction);
      expect(state.snapshot?.copyGap).toBeCloseTo(
        (state.snapshot?.viewportExtent ?? 0) * 0.5,
        4,
      );
      expect(state.snapshot?.durationMs).toBeCloseTo(
        ((state.snapshot?.distance ?? 0) /
          (state.snapshot?.speedPixelsPerSecond ?? 1)) * 1000,
        4,
      );
      expect(Number.parseFloat(state.delays[0])).toBeCloseTo(0, 4);
      expect(Number.parseFloat(state.delays[1]) * 1000).toBeCloseTo(
        -(state.snapshot?.durationMs ?? 0) / 2,
        1,
      );

      if (direction === "left") expect(state.endX).toBeLessThan(state.startX);
      if (direction === "right") expect(state.endX).toBeGreaterThan(state.startX);
      if (direction === "up") expect(state.endY).toBeLessThan(state.startY);
      if (direction === "down") expect(state.endY).toBeGreaterThan(state.startY);
    });
  }
});
