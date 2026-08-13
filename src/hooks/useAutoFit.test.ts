import { describe, expect, it, vi } from "vitest";

import { LIMITS } from "../domain/defaults";
import {
  assessMarqueeLayerBudget,
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
    expect(LIMITS.maxMarqueeLayerDeviceWidthPx).toBe(16_384);
  });

  it("allows the emergency marquee pass to descend to 8px", () => {
    expect(
      findLargestFittingFontSize(
        () => false,
        LIMITS.minMarqueeFontSizePx,
      ),
    ).toEqual({
      maxFittingSize: 8,
      overflow: true,
    });
  });
});

describe("resolveMarqueeLayerWidthBudget", () => {
  it("converts the physical-pixel width cap for DPR 1–3", () => {
    expect(resolveMarqueeLayerWidthBudget(1)).toBe(16_384);
    expect(resolveMarqueeLayerWidthBudget(2)).toBe(8_192);
    expect(resolveMarqueeLayerWidthBudget(3)).toBe(5_461);
  });

  it("falls back to DPR 1 for invalid values", () => {
    expect(resolveMarqueeLayerWidthBudget(Number.NaN)).toBe(16_384);
    expect(resolveMarqueeLayerWidthBudget(0)).toBe(16_384);
  });
});

describe("assessMarqueeLayerBudget", () => {
  it.each([1, 2, 3])(
    "enforces exact physical width and area boundaries at DPR %s",
    (devicePixelRatio) => {
      const cssWidthAtLimit =
        LIMITS.maxMarqueeLayerDeviceWidthPx / devicePixelRatio;
      const physicalHeightWithinArea = Math.floor(
        LIMITS.maxMarqueeLayerDeviceAreaPx /
          LIMITS.maxMarqueeLayerDeviceWidthPx,
      );
      const cssHeightAtAreaLimit =
        physicalHeightWithinArea / devicePixelRatio;
      expect(
        assessMarqueeLayerBudget(
          cssWidthAtLimit,
          cssHeightAtAreaLimit,
          devicePixelRatio,
        ).budgetExceeded,
      ).toBe(false);
      expect(
        assessMarqueeLayerBudget(
          cssWidthAtLimit + 1 / devicePixelRatio,
          cssHeightAtAreaLimit,
          devicePixelRatio,
        ).widthExceeded,
      ).toBe(true);
      expect(
        assessMarqueeLayerBudget(
          cssWidthAtLimit,
          cssHeightAtAreaLimit + 1 / devicePixelRatio,
          devicePixelRatio,
        ).areaExceeded,
      ).toBe(true);
    },
  );

  it("accepts a layer exactly on the physical-pixel area limit", () => {
    expect(assessMarqueeLayerBudget(8_000, 250, 2)).toEqual({
      metrics: {
        cssWidthPx: 8_000,
        cssHeightPx: 250,
        deviceWidthPx: 16_000,
        deviceHeightPx: 500,
        deviceAreaPx: 8_000_000,
      },
      widthExceeded: false,
      areaExceeded: false,
      budgetExceeded: false,
    });
  });

  it("enforces the physical width independently of CSS width", () => {
    const result = assessMarqueeLayerBudget(8_192.1, 20, 2);

    expect(result.metrics.deviceWidthPx).toBe(16_385);
    expect(result.widthExceeded).toBe(true);
    expect(result.budgetExceeded).toBe(true);
  });

  it("enforces the area budget for a tall vertical marquee", () => {
    const result = assessMarqueeLayerBudget(500, 4_001, 2);

    expect(result.metrics).toMatchObject({
      deviceWidthPx: 1_000,
      deviceHeightPx: 8_002,
      deviceAreaPx: 8_002_000,
    });
    expect(result.widthExceeded).toBe(false);
    expect(result.areaExceeded).toBe(true);
    expect(result.budgetExceeded).toBe(true);
  });

  it("keeps a normal horizontal layer within both budgets", () => {
    const result = assessMarqueeLayerBudget(4_000, 100, 2);

    expect(result.metrics.deviceAreaPx).toBe(1_600_000);
    expect(result.widthExceeded).toBe(false);
    expect(result.areaExceeded).toBe(false);
    expect(result.budgetExceeded).toBe(false);
  });

  it("fails closed when layout dimensions are invalid", () => {
    expect(
      assessMarqueeLayerBudget(Number.NaN, 100, 2).budgetExceeded,
    ).toBe(true);
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
