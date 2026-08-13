import type { RefObject } from "preact";
import { useCallback, useLayoutEffect, useMemo, useState } from "preact/hooks";
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

export function findLargestFittingFontSize(
  fits: (candidate: number) => boolean,
  minimum = LIMITS.minFontSizePx,
  maximum = LIMITS.maxAutoFitFontSizePx,
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
): number {
  const fittingSize = Math.max(LIMITS.minFontSizePx, Math.floor(maxFittingSize));
  if (scalePercent === null) {
    return clamp(
      Math.round(legacyMaxSize),
      LIMITS.minFontSizePx,
      fittingSize,
    );
  }

  const percent = clamp(
    Math.round(scalePercent),
    LIMITS.minFontScalePercent,
    LIMITS.maxFontScalePercent,
  );
  const responsiveTarget = Math.max(
    LIMITS.minFontSizePx,
    Math.floor((Math.max(1, fillReferenceSize) * percent) / 100),
  );
  return clamp(
    responsiveTarget,
    LIMITS.minFontSizePx,
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
  const [fit, setFit] = useState<FitSearchResult>({
    maxFittingSize: Math.max(LIMITS.minFontSizePx, maxSize),
    overflow: false,
  });
  const [fillReferenceSize, setFillReferenceSize] = useState(
    Math.max(LIMITS.minFontSizePx, maxSize),
  );
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

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
    setContainerSize((current) =>
      current.width === width && current.height === height
        ? current
        : { width, height },
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
      if (mode === "horizontal") return fitsHeight;
      if (mode === "vertical") return fitsWidth;
      return fitsWidth && fitsHeight;
    };

    const next = findLargestFittingFontSize(fits);
    setFillReferenceSize((current) => (current === height ? current : height));
    setFit((current) =>
      current.maxFittingSize === next.maxFittingSize &&
      current.overflow === next.overflow
        ? current
        : next,
    );
  }, [containerRef, measureRef, mode, content, layoutKey]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(recalculate);
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextWidth = Math.max(1, Math.round(entry?.contentRect.width ?? 0));
      const nextHeight = Math.max(1, Math.round(entry?.contentRect.height ?? 0));
      setContainerSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    });
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", recalculate);
    window.addEventListener("orientationchange", recalculate);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", recalculate);
      window.removeEventListener("orientationchange", recalculate);
    };
  }, [containerRef, recalculate, resizeKey]);

  useLayoutEffect(() => {
    if (containerSize.width <= 0 || containerSize.height <= 0) return;
    const frame = requestAnimationFrame(recalculate);
    return () => cancelAnimationFrame(frame);
  }, [containerSize, recalculate]);

  const fontSize = useMemo(
    () =>
      resolveEffectiveFontSize(
        fit.maxFittingSize,
        maxSize,
        scalePercent,
        fillReferenceSize,
      ),
    [fillReferenceSize, fit.maxFittingSize, maxSize, scalePercent],
  );

  return {
    fontSize,
    fillReferenceSize,
    maxFittingSize: fit.maxFittingSize,
    overflow: fit.overflow,
    recalculate,
  };
}
