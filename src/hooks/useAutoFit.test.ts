import { describe, expect, it, vi } from "vitest";

import { LIMITS } from "../domain/defaults";
import {
  findLargestFittingFontSize,
  resolveMarqueeLayerWidthBudget,
  resolveEffectiveFontSize,
} from "./useAutoFit";

describe("findLargestFittingFontSize", () => {
  it("finds the exact largest fitting size beyond the legacy 200px limit", () => {
    const largestFittingSize = 1_537;

    expect(
      findLargestFittingFontSize((candidate) => candidate <= largestFittingSize),
    ).toEqual({ maxFittingSize: largestFittingSize, overflow: false });
  });

  it("reports overflow when even the minimum font size does not fit", () => {
    const fits = vi.fn(() => false);

    expect(findLargestFittingFontSize(fits)).toEqual({
      maxFittingSize: LIMITS.minFontSizePx,
      overflow: true,
    });
    expect(fits).toHaveBeenCalledTimes(1);
    expect(fits).toHaveBeenCalledWith(LIMITS.minFontSizePx);
  });

  it("caps an unconstrained fit search at 4096px", () => {
    const testedCandidates: number[] = [];

    expect(
      findLargestFittingFontSize((candidate) => {
        testedCandidates.push(candidate);
        return true;
      }),
    ).toEqual({
      maxFittingSize: LIMITS.maxAutoFitFontSizePx,
      overflow: false,
    });
    expect(LIMITS.maxAutoFitFontSizePx).toBe(4_096);
    expect(Math.max(...testedCandidates)).toBe(LIMITS.maxAutoFitFontSizePx);
  });

  it("supports the horizontal marquee layer-width budget boundary", () => {
    const maximumWithinBudget = 84;

    expect(
      findLargestFittingFontSize(
        (candidate) => candidate <= maximumWithinBudget,
        LIMITS.minFontSizePx,
      ),
    ).toEqual({ maxFittingSize: maximumWithinBudget, overflow: false });
    expect(LIMITS.maxMarqueeLayerWidthPx).toBe(16_384);
  });
});

describe("resolveMarqueeLayerWidthBudget", () => {
  it("reduces high-DPR compositor layers without penalizing DPR 1 and 2", () => {
    expect(resolveMarqueeLayerWidthBudget(1)).toBe(16_384);
    expect(resolveMarqueeLayerWidthBudget(2)).toBe(16_384);
    expect(resolveMarqueeLayerWidthBudget(3)).toBe(10_922);
  });
});

describe("resolveEffectiveFontSize", () => {
  it("preserves a legacy pixel size while it still fits", () => {
    expect(resolveEffectiveFontSize(1_537, 200, null, 700)).toBe(200);
  });

  it("shrinks a legacy pixel size when it reaches the fitting boundary", () => {
    expect(resolveEffectiveFontSize(144, 200, null, 700)).toBe(144);
  });

  it("clamps percentage scaling to the 5–100% range", () => {
    expect(resolveEffectiveFontSize(1_000, 200, -20, 1_000)).toBe(50);
    expect(resolveEffectiveFontSize(1_000, 200, 5, 1_000)).toBe(50);
    expect(resolveEffectiveFontSize(1_000, 200, 100, 1_000)).toBe(1_000);
    expect(resolveEffectiveFontSize(1_000, 200, 140, 1_000)).toBe(1_000);
  });

  it("uses the full maximum fitting size at 100%", () => {
    expect(resolveEffectiveFontSize(1_537, 80, 100, 2_000)).toBe(1_537);
  });

  it("keeps a viewport-relative target until the content reaches a boundary", () => {
    expect(resolveEffectiveFontSize(900, 80, 50, 600)).toBe(300);
    expect(resolveEffectiveFontSize(240, 80, 50, 600)).toBe(240);
  });
});
