import type { RefObject } from "preact";
import { useCallback, useLayoutEffect, useState } from "preact/hooks";

export type FitMode = "static" | "horizontal" | "vertical";

interface AutoFitOptions {
  containerRef: RefObject<HTMLElement>;
  measureRef: RefObject<HTMLElement>;
  content: string;
  maxSize: number;
  mode: FitMode;
  layoutKey?: string;
}

export function useAutoFit({
  containerRef,
  measureRef,
  content,
  maxSize,
  mode,
  layoutKey = ""
}: AutoFitOptions) {
  const [fontSize, setFontSize] = useState(maxSize);
  const [overflow, setOverflow] = useState(false);

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    const fits = (candidate: number) => {
      measure.style.fontSize = `${candidate}px`;
      measure.style.width = mode === "static" ? `${width}px` : "max-content";
      measure.style.maxWidth = mode === "static" ? `${width}px` : "none";
      measure.style.whiteSpace = mode === "static" ? "pre-wrap" : "pre";
      const rect = measure.getBoundingClientRect();
      const fitsWidth = rect.width <= width + 1 && measure.scrollWidth <= width + 1;
      const fitsHeight = rect.height <= height + 1 && measure.scrollHeight <= height + 1;
      if (mode === "horizontal") return fitsHeight;
      if (mode === "vertical") return fitsWidth;
      return fitsWidth && fitsHeight;
    };

    let low = 24;
    let high = Math.max(24, Math.min(200, maxSize));
    let best = 24;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (fits(middle)) {
        best = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    setFontSize(best);
    setOverflow(!fits(24));
    void content;
    void layoutKey;
  }, [containerRef, measureRef, maxSize, mode, content, layoutKey]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(recalculate);
    const resizeObserver = new ResizeObserver(recalculate);
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    window.visualViewport?.addEventListener("resize", recalculate);
    window.addEventListener("orientationchange", recalculate);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.visualViewport?.removeEventListener("resize", recalculate);
      window.removeEventListener("orientationchange", recalculate);
    };
  }, [containerRef, recalculate]);

  return { fontSize, overflow, recalculate };
}
