import { describe, expect, it } from "vitest";

import {
  calculateCssMarqueeTiming,
  resolveCssMarqueePhase,
} from "./useCssMarqueeMotion";

describe("CSS marquee phase clock", () => {
  it("advances from elapsed time without accumulating frame deltas", () => {
    expect(resolveCssMarqueePhase({
      at: 1_000,
      distance: 1_000,
      phase: 0.25,
      pixelsPerSecond: 100,
      running: true,
    }, 3_500)).toBeCloseTo(0.5, 6);
  });

  it("freezes while paused and wraps an infinite timeline", () => {
    expect(resolveCssMarqueePhase({
      at: 1_000,
      distance: 100,
      phase: 1.25,
      pixelsPerSecond: 600,
      running: false,
    }, 9_000)).toBeCloseTo(0.25, 6);
    expect(resolveCssMarqueePhase({
      at: 0,
      distance: 100,
      phase: 0.9,
      pixelsPerSecond: 100,
      running: true,
    }, 200)).toBeCloseTo(0.1, 6);
  });

  it("keeps the primary phase and a half-cycle secondary offset when speed changes", () => {
    const timing = calculateCssMarqueeTiming(1_200, 300, 0.25, 5_000);
    expect(timing.durationMs).toBe(4_000);
    expect(timing.primaryDelayMs).toBe(4_000);
    expect(timing.secondaryDelayMs).toBe(2_000);
    expect((5_000 - timing.primaryDelayMs) / timing.durationMs).toBe(0.25);
    expect((5_000 - timing.secondaryDelayMs) / timing.durationMs).toBe(0.75);
  });
});
