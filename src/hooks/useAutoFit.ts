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
  devicePixelRatio?: number;
}

interface FitSearchResult {
  maxFittingSize: number;
  overflow: boolean;
}

interface FitState extends FitSearchResult {
  minimumSize: number;
  marqueeLayerMetrics: MarqueeLayerMetrics | null;
  marqueeBudgetExceeded: boolean;
}

export interface MarqueeLayerMetrics {
  cssWidthPx: number;
  cssHeightPx: number;
  deviceWidthPx: number;
  deviceHeightPx: number;
  deviceAreaPx: number;
}

export interface MarqueeLayerBudgetAssessment {
  metrics: MarqueeLayerMetrics;
  widthExceeded: boolean;
  areaExceeded: boolean;
  budgetExceeded: boolean;
}

function normalizeDevicePixelRatio(devicePixelRatio: number): number {
  return Number.isFinite(devicePixelRatio) && devicePixelRatio > 0
    ? devicePixelRatio
    : 1;
}

function normalizeLayerDimension(value: number): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.max(0, value);
}

export function resolveMarqueeLayerWidthBudget(
  devicePixelRatio: number,
): number {
  return Math.floor(
    LIMITS.maxMarqueeLayerDeviceWidthPx /
      normalizeDevicePixelRatio(devicePixelRatio),
  );
}

export function assessMarqueeLayerBudget(
  cssWidthPx: number,
  cssHeightPx: number,
  devicePixelRatio: number,
): MarqueeLayerBudgetAssessment {
  const ratio = normalizeDevicePixelRatio(devicePixelRatio);
  const normalizedWidth = normalizeLayerDimension(cssWidthPx);
  const normalizedHeight = normalizeLayerDimension(cssHeightPx);
  // Round outwards: a fractional edge still occupies the next physical pixel.
  const deviceWidthPx = Math.ceil(normalizedWidth * ratio);
  const deviceHeightPx = Math.ceil(normalizedHeight * ratio);
  const deviceAreaPx =
    Number.isFinite(deviceWidthPx) && Number.isFinite(deviceHeightPx)
      ? deviceWidthPx * deviceHeightPx
      : Number.POSITIVE_INFINITY;
  const metrics: MarqueeLayerMetrics = {
    cssWidthPx: normalizedWidth,
    cssHeightPx: normalizedHeight,
    deviceWidthPx,
    deviceHeightPx,
    deviceAreaPx,
  };
  const widthExceeded =
    metrics.deviceWidthPx > LIMITS.maxMarqueeLayerDeviceWidthPx;
  const areaExceeded =
    metrics.deviceAreaPx > LIMITS.maxMarqueeLayerDeviceAreaPx;

  return {
    metrics,
    widthExceeded,
    areaExceeded,
    budgetExceeded: widthExceeded || areaExceeded,
  };
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
  layoutKey = "",
  devicePixelRatio: requestedDevicePixelRatio = window.devicePixelRatio || 1,
}: AutoFitOptions) {
  const [fit, setFit] = useState<FitState>({
    maxFittingSize: Math.max(LIMITS.minFontSizePx, maxSize),
    overflow: false,
    minimumSize: LIMITS.minFontSizePx,
    marqueeLayerMetrics: null,
    marqueeBudgetExceeded: false,
  });
  const [fillReferenceSize, setFillReferenceSize] = useState(
    Math.max(LIMITS.minFontSizePx, maxSize),
  );
  const recalculateFrameRef = useRef<number | null>(null);
  const resizeSettleTimerRef = useRef<number | null>(null);
  const lastObservedSizeRef = useRef<{
    width: number;
    height: number;
    devicePixelRatio: number;
  } | null>(null);

  const recalculate = useCallback(() => {
    // These keys intentionally invalidate the measurement callback when text or
    // other font-affecting layout state changes.
    void content;
    void layoutKey;
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const containerRect = container.getBoundingClientRect();
    const width = Math.max(1, containerRect.width);
    const height = Math.max(1, containerRect.height);
    const devicePixelRatio = normalizeDevicePixelRatio(
      requestedDevicePixelRatio,
    );
    const measureCandidate = (candidate: number) => {
      const constrainWidth = mode !== "horizontal";
      measure.style.fontSize = `${candidate}px`;
      measure.style.width = constrainWidth ? `${width}px` : "max-content";
      measure.style.maxWidth = constrainWidth ? `${width}px` : "none";
      measure.style.whiteSpace = mode === "horizontal" ? "pre" : "pre-wrap";
      // offset/scroll sizes are layout dimensions and are unaffected by any
      // transform applied to the visible marquee copies.
      const measureRect = measure.getBoundingClientRect();
      const measuredWidth = Math.max(
        measureRect.width,
        measure.offsetWidth,
        measure.scrollWidth,
      );
      const measuredHeight = Math.max(
        measureRect.height,
        measure.offsetHeight,
        measure.scrollHeight,
      );
      const fitsWidth = measuredWidth <= width + 1;
      const fitsHeight = measuredHeight <= height + 1;
      const layerAssessment =
        mode === "static"
          ? null
          : assessMarqueeLayerBudget(
              measuredWidth,
              measuredHeight,
              devicePixelRatio,
            );

      return {
        fitsWidth,
        fitsHeight,
        layerAssessment,
      };
    };
    const fits = (candidate: number) => {
      const measurement = measureCandidate(candidate);
      if (mode === "horizontal") {
        return (
          measurement.fitsHeight &&
          !measurement.layerAssessment?.budgetExceeded
        );
      }
      if (mode === "vertical") {
        return (
          measurement.fitsWidth &&
          !measurement.layerAssessment?.budgetExceeded
        );
      }
      return measurement.fitsWidth && measurement.fitsHeight;
    };

    let minimumSize: number = LIMITS.minFontSizePx;
    let next = findLargestFittingFontSize(
      fits,
      minimumSize,
      LIMITS.maxAutoFitFontSizePx,
    );
    // Static text keeps the readable 24px floor. Marquee content gets one
    // emergency pass down to 8px so both its directional fit and compositor
    // layer budget have the widest possible safe range.
    if (next.overflow && mode !== "static") {
      minimumSize = LIMITS.minMarqueeFontSizePx;
      next = findLargestFittingFontSize(
        fits,
        minimumSize,
        LIMITS.maxAutoFitFontSizePx,
      );
    }
    const finalMeasurement = measureCandidate(next.maxFittingSize);
    const finalLayerAssessment = finalMeasurement.layerAssessment;
    const nextFit: FitState = {
      ...next,
      minimumSize,
      marqueeLayerMetrics: finalLayerAssessment?.metrics ?? null,
      marqueeBudgetExceeded:
        finalLayerAssessment?.budgetExceeded ?? false,
    };
    setFillReferenceSize((current) => (current === height ? current : height));
    setFit((current) =>
      current.maxFittingSize === nextFit.maxFittingSize &&
      current.overflow === nextFit.overflow &&
      current.minimumSize === nextFit.minimumSize &&
      current.marqueeBudgetExceeded === nextFit.marqueeBudgetExceeded &&
      current.marqueeLayerMetrics?.cssWidthPx ===
        nextFit.marqueeLayerMetrics?.cssWidthPx &&
      current.marqueeLayerMetrics?.cssHeightPx ===
        nextFit.marqueeLayerMetrics?.cssHeightPx &&
      current.marqueeLayerMetrics?.deviceWidthPx ===
        nextFit.marqueeLayerMetrics?.deviceWidthPx &&
      current.marqueeLayerMetrics?.deviceHeightPx ===
        nextFit.marqueeLayerMetrics?.deviceHeightPx
        ? current
        : nextFit,
    );
  }, [
    containerRef,
    measureRef,
    mode,
    content,
    layoutKey,
    requestedDevicePixelRatio,
  ]);

  const scheduleRecalculate = useCallback(() => {
    if (recalculateFrameRef.current !== null) return;
    recalculateFrameRef.current = requestAnimationFrame(() => {
      recalculateFrameRef.current = null;
      recalculate();
    });
  }, [recalculate]);

  const scheduleResizeRecalculate = useCallback((entry?: ResizeObserverEntry) => {
    const container = containerRef.current;
    if (!container) return;
    const ratio = normalizeDevicePixelRatio(requestedDevicePixelRatio);
    const contentBox = entry?.contentBoxSize;
    const firstContentBox = Array.isArray(contentBox)
      ? contentBox[0]
      : contentBox;
    const fallbackRect = entry?.contentRect ?? container.getBoundingClientRect();
    const nextSize = {
      width: firstContentBox?.inlineSize ?? fallbackRect.width,
      height: firstContentBox?.blockSize ?? fallbackRect.height,
      devicePixelRatio: ratio,
    };
    const previousSize = lastObservedSizeRef.current;
    if (
      previousSize &&
      previousSize.devicePixelRatio === nextSize.devicePixelRatio &&
      Math.abs(nextSize.width - previousSize.width) * ratio < 1 &&
      Math.abs(nextSize.height - previousSize.height) * ratio < 1
    ) {
      return;
    }
    lastObservedSizeRef.current = nextSize;
    const startsNewBurst = resizeSettleTimerRef.current === null;
    if (startsNewBurst) scheduleRecalculate();
    if (resizeSettleTimerRef.current !== null) {
      window.clearTimeout(resizeSettleTimerRef.current);
    }
    resizeSettleTimerRef.current = window.setTimeout(() => {
      resizeSettleTimerRef.current = null;
      scheduleRecalculate();
    }, 80);
  }, [containerRef, requestedDevicePixelRatio, scheduleRecalculate]);

  useLayoutEffect(() => {
    scheduleRecalculate();
    const resizeObserver = new ResizeObserver((entries) => {
      scheduleResizeRecalculate(entries[0]);
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    const scheduleViewportRecalculate = () => scheduleResizeRecalculate();
    window.visualViewport?.addEventListener("resize", scheduleViewportRecalculate);
    window.addEventListener("orientationchange", scheduleViewportRecalculate);
    return () => {
      if (recalculateFrameRef.current !== null) {
        cancelAnimationFrame(recalculateFrameRef.current);
        recalculateFrameRef.current = null;
      }
      if (resizeSettleTimerRef.current !== null) {
        window.clearTimeout(resizeSettleTimerRef.current);
        resizeSettleTimerRef.current = null;
      }
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener(
        "resize",
        scheduleViewportRecalculate,
      );
      window.removeEventListener("orientationchange", scheduleViewportRecalculate);
    };
  }, [containerRef, resizeKey, scheduleRecalculate, scheduleResizeRecalculate]);

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
    marqueeLayerMetrics: fit.marqueeLayerMetrics,
    marqueeBudgetExceeded: fit.marqueeBudgetExceeded,
    recalculate,
  };
}
