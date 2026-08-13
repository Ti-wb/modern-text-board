import type { RefObject } from "preact";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { LIMITS, clamp } from "../domain/defaults";

export type FitMode = "static" | "horizontal" | "vertical";

interface AutoFitOptions {
  containerRef: RefObject<HTMLElement>;
  measureRef: RefObject<HTMLElement>;
  content: string;
  maxSize: number;
  scalePercent: number | null;
  mode: FitMode;
  resizeKey?: string;
  layoutKey?: string;
}

interface FitSearchResult {
  maxFittingSize: number;
  overflow: boolean;
}

interface FitState extends FitSearchResult {
  minimumSize: number;
}

export function resolveMarqueeLayerWidthBudget(
  devicePixelRatio: number,
): number {
  const ratio = clamp(
    Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1,
    1,
    3,
  );
  return Math.min(
    LIMITS.maxMarqueeLayerWidthPx,
    Math.floor(LIMITS.maxMarqueeLayerDeviceWidthPx / ratio),
  );
}

export function findLargestFittingFontSize(
  fits: (candidate: number) => boolean,
  minimum: number = LIMITS.minFontSizePx,
  maximum: number = LIMITS.maxAutoFitFontSizePx,
): FitSearchResult {
  if (!fits(minimum)) {
    return { maxFittingSize: minimum, overflow: true };
  }

  let best: number = minimum;
  let firstFailure: number = maximum + 1;
  let probe: number = minimum;

  while (probe < maximum) {
    const candidate = Math.min(maximum, probe * 2);
    if (fits(candidate)) {
      best = candidate;
      probe = candidate;
      continue;
    }
    firstFailure = candidate;
    break;
  }

  let low = best + 1;
  let high = Math.min(maximum, firstFailure - 1);
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(middle)) {
      best = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return { maxFittingSize: best, overflow: false };
}

export function resolveEffectiveFontSize(
  maxFittingSize: number,
  legacyMaxSize: number,
  scalePercent: number | null,
  fillReferenceSize: number,
  minimumSize: number = LIMITS.minFontSizePx,
): number {
  const fittingSize = Math.max(minimumSize, Math.floor(maxFittingSize));
  if (scalePercent === null) {
    return clamp(
      Math.round(legacyMaxSize),
      minimumSize,
      fittingSize,
    );
  }

  const percent = clamp(
    Math.round(scalePercent),
    LIMITS.minFontScalePercent,
    LIMITS.maxFontScalePercent,
  );
  const responsiveTarget = Math.max(
    minimumSize,
    Math.floor((Math.max(1, fillReferenceSize) * percent) / 100),
  );
  return clamp(
    responsiveTarget,
    minimumSize,
    fittingSize,
  );
}

export function useAutoFit({
  containerRef,
  measureRef,
  content,
  maxSize,
  scalePercent,
  mode,
  resizeKey = "",
  layoutKey = ""
}: AutoFitOptions) {
  const [fit, setFit] = useState<FitState>({
    maxFittingSize: Math.max(LIMITS.minFontSizePx, maxSize),
    overflow: false,
    minimumSize: LIMITS.minFontSizePx,
  });
  const [fillReferenceSize, setFillReferenceSize] = useState(
    Math.max(LIMITS.minFontSizePx, maxSize),
  );
  const recalculateFrameRef = useRef<number | null>(null);

  const recalculate = useCallback(() => {
    // These keys intentionally invalidate the measurement callback when text or
    // other font-affecting layout state changes.
    void content;
    void layoutKey;
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const marqueeLayerWidthBudget = resolveMarqueeLayerWidthBudget(
      window.devicePixelRatio || 1,
    );
    const fits = (candidate: number) => {
      const constrainWidth = mode !== "horizontal";
      measure.style.fontSize = `${candidate}px`;
      measure.style.width = constrainWidth ? `${width}px` : "max-content";
      measure.style.maxWidth = constrainWidth ? `${width}px` : "none";
      measure.style.whiteSpace = mode === "horizontal" ? "pre" : "pre-wrap";
      const rect = measure.getBoundingClientRect();
      const fitsWidth = rect.width <= width + 1 && measure.scrollWidth <= width + 1;
      const fitsHeight = rect.height <= height + 1 && measure.scrollHeight <= height + 1;
      if (mode === "horizontal") {
        const layerWidth = Math.max(rect.width, measure.scrollWidth);
        return fitsHeight && layerWidth <= marqueeLayerWidthBudget;
      }
      if (mode === "vertical") return fitsWidth;
      return fitsWidth && fitsHeight;
    };

    let minimumSize: number = LIMITS.minFontSizePx;
    let next = findLargestFittingFontSize(
      fits,
      minimumSize,
      LIMITS.maxAutoFitFontSizePx,
    );
    // Normal content never drops below the readable 24px floor. Only an
    // exceptional no-wrap string that would exceed the compositor layer
    // budget at 24px gets a second pass down to 12px.
    const exceedsLayerBudgetAtReadableMinimum =
      mode === "horizontal" &&
      Math.max(measure.getBoundingClientRect().width, measure.scrollWidth) >
        marqueeLayerWidthBudget;
    if (next.overflow && exceedsLayerBudgetAtReadableMinimum) {
      minimumSize = 12;
      next = findLargestFittingFontSize(
        fits,
        minimumSize,
        LIMITS.maxAutoFitFontSizePx,
      );
    }
    const nextFit: FitState = { ...next, minimumSize };
    setFillReferenceSize((current) => (current === height ? current : height));
    setFit((current) =>
      current.maxFittingSize === nextFit.maxFittingSize &&
      current.overflow === nextFit.overflow &&
      current.minimumSize === nextFit.minimumSize
        ? current
        : nextFit,
    );
  }, [containerRef, measureRef, mode, content, layoutKey]);

  const scheduleRecalculate = useCallback(() => {
    if (recalculateFrameRef.current !== null) return;
    recalculateFrameRef.current = requestAnimationFrame(() => {
      recalculateFrameRef.current = null;
      recalculate();
    });
  }, [recalculate]);

  useLayoutEffect(() => {
    scheduleRecalculate();
    const resizeObserver = new ResizeObserver(scheduleRecalculate);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", scheduleRecalculate);
    window.addEventListener("orientationchange", scheduleRecalculate);
    return () => {
      if (recalculateFrameRef.current !== null) {
        cancelAnimationFrame(recalculateFrameRef.current);
        recalculateFrameRef.current = null;
      }
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", scheduleRecalculate);
      window.removeEventListener("orientationchange", scheduleRecalculate);
    };
  }, [containerRef, resizeKey, scheduleRecalculate]);

  const fontSize = useMemo(
    () =>
      resolveEffectiveFontSize(
        fit.maxFittingSize,
        maxSize,
        scalePercent,
        fillReferenceSize,
        fit.minimumSize,
      ),
    [fillReferenceSize, fit.maxFittingSize, fit.minimumSize, maxSize, scalePercent],
  );

  return {
    fontSize,
    fillReferenceSize,
    maxFittingSize: fit.maxFittingSize,
    overflow: fit.overflow,
    recalculate,
  };
}
