import type { RefObject } from "preact";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import { LIMITS, clamp } from "../domain/defaults";
import type { MarqueeDirection } from "../domain/types";

export const MARQUEE_BASE_PIXELS_PER_SECOND = 100;
export const MARQUEE_RATE_TRANSITION_MS = 140;
/** Blank space between repeated copies, relative to the active text viewport. */
export const MARQUEE_COPY_GAP_RATIO = 0.5;

export interface MarqueeGeometry {
  direction: MarqueeDirection;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  distance: number;
  copyGap: number;
  baseDurationMs: number;
}

interface UseMarqueeMotionOptions {
  animationKey: string;
  direction: MarqueeDirection;
  enabled: boolean;
  fontSize: number;
  copyRef: RefObject<HTMLElement>;
  movingRef: RefObject<HTMLElement>;
  paused: boolean;
  speed: number;
  viewportRef: RefObject<HTMLElement>;
}

/**
 * Keeps the original v1 1–10 speed curve intact while allowing a much wider,
 * fractional control range for current boards.
 */
export function speedToPixelsPerSecond(speed: number): number {
  const normalizedSpeed = clamp(
    Number.isFinite(speed) ? speed : LIMITS.minMarqueeSpeed,
    LIMITS.minMarqueeSpeed,
    LIMITS.maxMarqueeSpeed,
  );
  return 24 + ((normalizedSpeed - 1) / 9) * 136;
}

export function calculateMarqueeGeometry(
  direction: MarqueeDirection,
  viewportWidth: number,
  viewportHeight: number,
  contentWidth: number,
  contentHeight: number,
): MarqueeGeometry {
  const width = Math.max(1, viewportWidth);
  const height = Math.max(1, viewportHeight);
  const movingWidth = Math.max(1, contentWidth);
  const movingHeight = Math.max(1, contentHeight);
  const horizontalGap = width * MARQUEE_COPY_GAP_RATIO;
  const verticalGap = height * MARQUEE_COPY_GAP_RATIO;
  const horizontalEntry = (width + movingWidth) / 2;
  const verticalEntry = (height + movingHeight) / 2;
  let startX = 0;
  let startY = 0;
  let endX = 0;
  let endY = 0;
  let distance: number;

  if (direction === "left") {
    startX = horizontalEntry;
    distance = movingWidth + horizontalGap;
    endX = startX - distance;
  } else if (direction === "right") {
    startX = -horizontalEntry;
    distance = movingWidth + horizontalGap;
    endX = startX + distance;
  } else if (direction === "up") {
    startY = verticalEntry;
    distance = movingHeight + verticalGap;
    endY = startY - distance;
  } else {
    startY = -verticalEntry;
    distance = movingHeight + verticalGap;
    endY = startY + distance;
  }

  return {
    direction,
    startX,
    startY,
    endX,
    endY,
    distance,
    copyGap: direction === "left" || direction === "right" ? horizontalGap : verticalGap,
    baseDurationMs: Math.max(1, (distance / MARQUEE_BASE_PIXELS_PER_SECOND) * 1000),
  };
}

export function interpolatePlaybackRate(
  startRate: number,
  targetRate: number,
  progress: number,
): number {
  const clampedProgress = clamp(progress, 0, 1);
  const eased = 1 - (1 - clampedProgress) ** 3;
  return startRate + (targetRate - startRate) * eased;
}

function sameGeometry(left: MarqueeGeometry, right: MarqueeGeometry): boolean {
  return (
    left.direction === right.direction &&
    Math.abs(left.startX - right.startX) < 0.25 &&
    Math.abs(left.startY - right.startY) < 0.25 &&
    Math.abs(left.endX - right.endX) < 0.25 &&
    Math.abs(left.endY - right.endY) < 0.25 &&
    Math.abs(left.copyGap - right.copyGap) < 0.25
  );
}

function animationProgress(animation: Animation, durationMs: number): number | null {
  const currentTime = animation.currentTime;
  if (typeof currentTime !== "number" || !Number.isFinite(currentTime) || durationMs <= 0) {
    return null;
  }
  return (((currentTime % durationMs) + durationMs) % durationMs) / durationMs;
}

function setGeometryProperties(element: HTMLElement, geometry: MarqueeGeometry): void {
  element.style.setProperty("--marquee-start-x", `${geometry.startX}px`);
  element.style.setProperty("--marquee-start-y", `${geometry.startY}px`);
  element.style.setProperty("--marquee-end-x", `${geometry.endX}px`);
  element.style.setProperty("--marquee-end-y", `${geometry.endY}px`);
  element.style.setProperty("--marquee-copy-gap", `${geometry.copyGap}px`);
  element.style.setProperty("--marquee-base-duration", `${geometry.baseDurationMs}ms`);
}

function removeGeometryProperties(element: HTMLElement): void {
  element.style.removeProperty("--marquee-start-x");
  element.style.removeProperty("--marquee-start-y");
  element.style.removeProperty("--marquee-end-x");
  element.style.removeProperty("--marquee-end-y");
  element.style.removeProperty("--marquee-copy-gap");
  element.style.removeProperty("--marquee-base-duration");
  element.style.removeProperty("--marquee-fallback-duration");
}

export function useMarqueeMotion({
  animationKey,
  direction,
  enabled,
  fontSize,
  copyRef,
  movingRef,
  paused,
  speed,
  viewportRef,
}: UseMarqueeMotionOptions): void {
  const animationRef = useRef<Animation | null>(null);
  const geometryRef = useRef<MarqueeGeometry | null>(null);
  const geometryKeyRef = useRef("");
  const rateFrameRef = useRef<number | null>(null);
  const currentRateRef = useRef(1);
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);

  useLayoutEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useLayoutEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const cancelRateTransition = useCallback(() => {
    if (rateFrameRef.current !== null) {
      cancelAnimationFrame(rateFrameRef.current);
      rateFrameRef.current = null;
    }
  }, []);

  const applyFallbackSpeed = useCallback(() => {
    const moving = movingRef.current;
    const geometry = geometryRef.current;
    if (!moving || !geometry || !moving.classList.contains("uses-css-marquee")) return;
    const durationSeconds = geometry.distance / speedToPixelsPerSecond(speedRef.current);
    moving.style.setProperty("--marquee-fallback-duration", `${durationSeconds}s`);
  }, [movingRef]);

  const rebuild = useCallback(() => {
    const viewport = viewportRef.current;
    const moving = movingRef.current;
    const copy = copyRef.current;
    if (!viewport || !moving || !copy || !enabled) return;

    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = copy.getBoundingClientRect();
    const nextGeometry = calculateMarqueeGeometry(
      direction,
      viewportRect.width,
      viewportRect.height,
      contentRect.width,
      contentRect.height,
    );
    const nextGeometryKey = `${animationKey}:${direction}`;
    if (
      geometryRef.current &&
      geometryKeyRef.current === nextGeometryKey &&
      sameGeometry(geometryRef.current, nextGeometry)
    ) {
      return;
    }

    cancelRateTransition();
    const previousAnimation = animationRef.current;
    const shouldPreserveProgress =
      previousAnimation !== null && geometryKeyRef.current === nextGeometryKey;
    const previousProgress =
      shouldPreserveProgress && geometryRef.current
        ? animationProgress(previousAnimation, geometryRef.current.baseDurationMs)
        : null;
    previousAnimation?.cancel();
    animationRef.current = null;
    geometryRef.current = nextGeometry;
    geometryKeyRef.current = nextGeometryKey;
    setGeometryProperties(moving, nextGeometry);

    const targetRate =
      speedToPixelsPerSecond(speedRef.current) / MARQUEE_BASE_PIXELS_PER_SECOND;
    currentRateRef.current = targetRate;

    if (typeof moving.animate !== "function") {
      moving.classList.add("uses-css-marquee");
      applyFallbackSpeed();
      return;
    }

    moving.classList.remove("uses-css-marquee");
    try {
      const animation = moving.animate(
        [
          {
            transform: `translate3d(${nextGeometry.startX}px, ${nextGeometry.startY}px, 0)`,
          },
          {
            transform: `translate3d(${nextGeometry.endX}px, ${nextGeometry.endY}px, 0)`,
          },
        ],
        {
          duration: nextGeometry.baseDurationMs,
          easing: "linear",
          iterations: Infinity,
        },
      );
      animationRef.current = animation;
      if (previousProgress !== null) {
        animation.currentTime = previousProgress * nextGeometry.baseDurationMs;
      }
      animation.updatePlaybackRate(targetRate);
      if (pausedRef.current) animation.pause();
    } catch {
      moving.classList.add("uses-css-marquee");
      applyFallbackSpeed();
    }
  }, [animationKey, applyFallbackSpeed, cancelRateTransition, copyRef, direction, enabled, movingRef, viewportRef]);

  useLayoutEffect(() => {
    const moving = movingRef.current;
    if (!enabled) {
      cancelRateTransition();
      animationRef.current?.cancel();
      animationRef.current = null;
      geometryRef.current = null;
      geometryKeyRef.current = "";
      if (moving) {
        moving.classList.remove("uses-css-marquee");
        removeGeometryProperties(moving);
      }
      return;
    }

    const frame = requestAnimationFrame(rebuild);
    const observer = new ResizeObserver(rebuild);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (moving) observer.observe(moving);
    if (copyRef.current) observer.observe(copyRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [animationKey, cancelRateTransition, copyRef, direction, enabled, fontSize, movingRef, rebuild, viewportRef]);

  useLayoutEffect(() => {
    const animation = animationRef.current;
    if (!enabled || !animation) {
      applyFallbackSpeed();
      return;
    }

    cancelRateTransition();
    const startRate = currentRateRef.current;
    const targetRate =
      speedToPixelsPerSecond(speed) / MARQUEE_BASE_PIXELS_PER_SECOND;
    if (Math.abs(targetRate - startRate) < 0.0001) return;

    const startedAt = performance.now();
    const update = (now: number) => {
      if (animationRef.current !== animation) return;
      const progress = Math.min(1, (now - startedAt) / MARQUEE_RATE_TRANSITION_MS);
      const nextRate = interpolatePlaybackRate(startRate, targetRate, progress);
      animation.updatePlaybackRate(nextRate);
      currentRateRef.current = nextRate;
      if (progress < 1) {
        rateFrameRef.current = requestAnimationFrame(update);
      } else {
        rateFrameRef.current = null;
      }
    };
    rateFrameRef.current = requestAnimationFrame(update);
    return cancelRateTransition;
  }, [applyFallbackSpeed, cancelRateTransition, enabled, speed]);

  useLayoutEffect(() => {
    const animation = animationRef.current;
    if (!enabled || !animation) return;
    if (paused) animation.pause();
    else animation.play();
  }, [enabled, paused]);

  useLayoutEffect(
    () => () => {
      cancelRateTransition();
      animationRef.current?.cancel();
    },
    [cancelRateTransition],
  );
}
