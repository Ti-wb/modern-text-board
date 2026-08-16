import { expect, test } from "@playwright/test";

const PROBE_PATH = "/experiments/marquee-motion-probe/";

interface MotionProbeSnapshot {
  durationMs: number;
  endX: number;
  fontSize: number;
  fontWeight: number;
  labelsVisible: boolean;
  laneWidth: number;
  markerWidth: number;
  mode: "alternate" | "once";
  objectWidth: number;
  pixelsPerSecond: number;
  startX: number;
  text: string;
  theme: "dark" | "light";
  travelDistance: number;
}

test.describe("isolated marquee motion probe", () => {
  test("loads only the static probe and reaches zero application rAF", async ({
    page,
    request,
  }) => {
    await page.addInitScript(() => {
      const instrumentedWindow = window as typeof window & {
        __motionProbeTestRafRequests: number;
      };
      const original = window.requestAnimationFrame.bind(window);
      instrumentedWindow.__motionProbeTestRafRequests = 0;
      window.requestAnimationFrame = (callback) => {
        instrumentedWindow.__motionProbeTestRafRequests += 1;
        return original(callback);
      };
    });

    await page.goto(PROBE_PATH);
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-probe-state",
      "ready",
    );

    await expect(
      page.locator("#app, .toolbar, .marquee-lab-switcher, canvas"),
    ).toHaveCount(0);
    await expect(page.locator("[data-probe-runner]")).toHaveCount(2);
    await expect(page.locator("link[rel=manifest]")).toHaveCount(0);

    const runtime = await page.evaluate(async () => {
      const instrumentedWindow = window as typeof window & {
        __motionProbeSnapshot?: MotionProbeSnapshot;
        __motionProbeTestRafRequests: number;
      };
      const before = instrumentedWindow.__motionProbeTestRafRequests;
      await new Promise((resolve) => setTimeout(resolve, 350));
      const after = instrumentedWindow.__motionProbeTestRafRequests;
      const resources = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name);
      const registrations = "serviceWorker" in navigator
        ? await navigator.serviceWorker.getRegistrations()
        : [];
      return {
        after,
        animationCounts: [
          ...document.querySelectorAll<HTMLElement>("[data-probe-runner]"),
        ].map((runner) => runner.getAnimations().length),
        before,
        controlled:
          "serviceWorker" in navigator &&
          navigator.serviceWorker.controller !== null,
        registrations: registrations.length,
        resources,
        scripts: [...document.scripts].map((script) => script.src),
        snapshot: instrumentedWindow.__motionProbeSnapshot,
      };
    });

    expect(runtime.after).toBe(runtime.before);
    expect(runtime.animationCounts).toEqual([1, 1]);
    expect(runtime.controlled).toBe(false);
    expect(runtime.registrations).toBe(0);
    expect(runtime.scripts).toEqual([
      expect.stringContaining(
        "/experiments/marquee-motion-probe/motion-probe.js",
      ),
    ]);
    expect(runtime.resources.some((url) => url.includes("/assets/index-"))).toBe(
      false,
    );
    expect(runtime.resources.some((url) => url.includes("/@vite/client"))).toBe(
      false,
    );
    expect(runtime.snapshot).toMatchObject({
      fontSize: 112,
      fontWeight: 900,
      labelsVisible: false,
      mode: "alternate",
      pixelsPerSecond: 240,
      text: "Aa",
      theme: "dark",
    });
    await expect(page.locator(".motion-probe__header")).toBeHidden();

    const serviceWorker = await request.get("/sw.js");
    expect(serviceWorker.ok()).toBe(true);
    const serviceWorkerBody = await serviceWorker.text();
    expect(serviceWorkerBody).not.toContain("marquee-motion-probe");
    expect(serviceWorkerBody).not.toContain("marquee-clean");
  });

  test("keeps the text and solid runners phase-locked", async ({ page }) => {
    await page.goto(
      `${PROBE_PATH}?text=Probe&pps=600&fontSize=160&weight=700`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-probe-state",
      "ready",
    );

    const result = await page.locator("#motion-probe").evaluate((root) => {
      const runners = [
        ...root.querySelectorAll<HTMLElement>("[data-probe-runner]"),
      ];
      const animations = runners.map(
        (runner) => runner.getAnimations()[0] as CSSAnimation,
      );
      const snapshot = (
        window as typeof window & {
          __motionProbeSnapshot?: MotionProbeSnapshot;
        }
      ).__motionProbeSnapshot;
      if (!snapshot || animations.some((animation) => !animation)) {
        throw new Error("Probe did not initialize");
      }

      const startTimes = animations.map((animation) => animation.startTime);
      const currentTimes = animations.map((animation) => animation.currentTime);
      const playbackRates = animations.map((animation) => animation.playbackRate);
      const computed = runners.map((runner) => {
        const style = getComputedStyle(runner);
        const timing = runner.getAnimations()[0].effect?.getComputedTiming();
        return {
          delay: style.animationDelay,
          direction: style.animationDirection,
          duration: style.animationDuration,
          easing: style.animationTimingFunction,
          iterations: timing?.iterations,
        };
      });
      const runnerBounds = runners.map((runner) => {
        const bounds = runner.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      });
      const markerBounds = [
        ...root.querySelectorAll<HTMLElement>(".probe-runner__marker"),
      ].map((marker) => {
        const bounds = marker.getBoundingClientRect();
        return { height: bounds.height, width: bounds.width };
      });

      animations.forEach((animation) => animation.pause());
      const matrixAt = (time: number) => {
        animations.forEach((animation) => {
          animation.currentTime = time;
        });
        return runners.map((runner) => {
          const matrix = new DOMMatrixReadOnly(getComputedStyle(runner).transform);
          return { x: matrix.m41, y: matrix.m42 };
        });
      };
      const samples = [
        0,
        snapshot.durationMs * 0.25,
        snapshot.durationMs * 0.5,
        snapshot.durationMs * 0.75,
        snapshot.durationMs,
      ].map((time) => ({ positions: matrixAt(time), time }));
      const turn = [
        snapshot.durationMs - 1,
        snapshot.durationMs,
        snapshot.durationMs + 1,
      ].map((time) => matrixAt(time));
      const returnPoint = [
        snapshot.durationMs * 2 - 1,
        snapshot.durationMs * 2,
        snapshot.durationMs * 2 + 1,
      ].map((time) => matrixAt(time));

      return {
        computed,
        currentTimes,
        markerBounds,
        playbackRates,
        returnPoint,
        runnerBounds,
        samples,
        snapshot,
        startTimes,
        turn,
      };
    });

    expect(result.snapshot.pixelsPerSecond).toBe(600);
    expect(result.snapshot.fontSize).toBe(160);
    expect(result.snapshot.fontWeight).toBe(700);
    expect(result.snapshot.durationMs).toBeCloseTo(
      (result.snapshot.travelDistance / 600) * 1000,
      5,
    );
    expect(result.startTimes[0]).not.toBeNull();
    expect(result.startTimes[1]).not.toBeNull();
    expect(
      Math.abs(
        (result.startTimes[0] as number) - (result.startTimes[1] as number),
      ),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(
        (result.currentTimes[0] as number) -
          (result.currentTimes[1] as number),
      ),
    ).toBeLessThanOrEqual(2);
    expect(result.playbackRates).toEqual([1, 1]);
    expect(result.markerBounds[0]).toEqual(result.markerBounds[1]);
    expect(result.runnerBounds[0].width).toBeGreaterThan(
      result.runnerBounds[1].width,
    );

    for (const timing of result.computed) {
      expect(timing.delay).toBe("0s");
      expect(timing.direction).toBe("alternate");
      expect(timing.easing).toBe("linear");
      expect(timing.iterations).toBe(Infinity);
      expect(Number.parseFloat(timing.duration) * 1000).toBeCloseTo(
        result.snapshot.durationMs,
        1,
      );
    }

    for (const sample of result.samples) {
      expect(sample.positions[0].x).toBeCloseTo(sample.positions[1].x, 3);
      expect(sample.positions[0].y).toBeCloseTo(0, 3);
      expect(sample.positions[1].y).toBeCloseTo(0, 3);
    }
    expect(result.samples[0].positions[0].x).toBeCloseTo(
      result.snapshot.startX,
      3,
    );
    expect(result.samples.at(-1)?.positions[0].x).toBeCloseTo(
      result.snapshot.endX,
      3,
    );

    const endpointTolerance = result.snapshot.pixelsPerSecond * 0.001 + 0.25;
    expect(Math.abs(result.turn[0][0].x - result.turn[2][0].x)).toBeLessThan(
      0.25,
    );
    expect(Math.abs(result.turn[1][0].x - result.turn[0][0].x)).toBeLessThan(
      endpointTolerance,
    );
    expect(
      Math.abs(result.returnPoint[0][0].x - result.returnPoint[2][0].x),
    ).toBeLessThan(0.25);
    expect(
      Math.abs(result.returnPoint[1][0].x - result.returnPoint[0][0].x),
    ).toBeLessThan(endpointTolerance);
  });

  test("supports a one-shot run without an iteration reset", async ({ page }) => {
    await page.goto(
      `${PROBE_PATH}?mode=once&pps=120&labels=0&theme=light`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-probe-state",
      "ready",
    );

    const state = await page.locator("#motion-probe").evaluate((root) => {
      const runners = [
        ...root.querySelectorAll<HTMLElement>("[data-probe-runner]"),
      ];
      const snapshot = (
        window as typeof window & {
          __motionProbeSnapshot?: MotionProbeSnapshot;
        }
      ).__motionProbeSnapshot;
      return {
        computed: runners.map((runner) => {
          const animation = runner.getAnimations()[0];
          const style = getComputedStyle(runner);
          return {
            direction: style.animationDirection,
            fillMode: style.animationFillMode,
            iterations: animation.effect?.getComputedTiming().iterations,
          };
        }),
        snapshot,
      };
    });

    expect(state.snapshot).toMatchObject({
      labelsVisible: false,
      mode: "once",
      pixelsPerSecond: 120,
      theme: "light",
    });
    await expect(page.locator(".motion-probe__header")).toBeHidden();
    await expect(page.locator(".motion-probe__footer")).toBeHidden();
    for (const timing of state.computed) {
      expect(timing.direction).toBe("normal");
      expect(timing.fillMode).toBe("both");
      expect(timing.iterations).toBe(1);
    }
  });

  test("falls back or clamps invalid query parameters", async ({ page }) => {
    await page.goto(
      `${PROBE_PATH}?pps=&fontSize=wat&weight=500&mode=loop&theme=sepia`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-probe-state",
      "ready",
    );
    const fallback = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __motionProbeSnapshot?: MotionProbeSnapshot;
          }
        ).__motionProbeSnapshot,
    );
    expect(fallback).toMatchObject({
      fontSize: 112,
      fontWeight: 900,
      mode: "alternate",
      pixelsPerSecond: 240,
      theme: "dark",
    });

    const emoji = "🧪".repeat(351);
    await page.goto(
      `${PROBE_PATH}?pps=9999&fontSize=999&text=${encodeURIComponent(emoji)}`,
    );
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion-probe-state",
      "ready",
    );
    const clamped = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __motionProbeSnapshot?: MotionProbeSnapshot;
          }
        ).__motionProbeSnapshot,
    );
    expect(clamped?.pixelsPerSecond).toBe(1200);
    expect(clamped?.fontSize).toBe(200);
    expect(Array.from(clamped?.text ?? "")).toHaveLength(350);
  });
});
