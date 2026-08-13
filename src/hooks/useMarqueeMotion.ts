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
  /** Distance travelled by one copy before its invisible reset. */
  distance: number;
  /** Distance between equivalent points on the two repeated copies. */
  cycleDistance: number;
  copyGap: number;
  baseDurationMs: number;
}

interface UseMarqueeMotionOptions {
  animationKey: string;
  direction: MarqueeDirection;
  enabled: boolean;
  fontSize: number;
  movingRef: RefObject<HTMLElement>;
  primaryCopyRef: RefObject<HTMLElement>;
  secondaryCopyRef: RefObject<HTMLElement>;
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

/**
 * Each copy travels two repeat intervals and is phase-shifted by one interval.
 * Its reset therefore happens fully outside the viewport while the other copy
 * occupies the exact same visible position. Keeping copies on separate layers
 * avoids promoting one extremely wide multi-copy track to the GPU.
 */
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
  const horizontalCycle = movingWidth + horizontalGap;
  const verticalCycle = movingHeight + verticalGap;
  let startX: number;
  let startY: number;
  let endX: number;
  let endY: number;
  let cycleDistance: number;

  if (direction === "left") {
    startX = width;
    startY = (height - movingHeight) / 2;
    cycleDistance = horizontalCycle;
    endX = startX - cycleDistance * 2;
    endY = startY;
  } else if (direction === "right") {
    startX = -movingWidth;
    startY = (height - movingHeight) / 2;
    cycleDistance = horizontalCycle;
    endX = startX + cycleDistance * 2;
    endY = startY;
  } else if (direction === "up") {
    startX = (width - movingWidth) / 2;
    startY = height;
    cycleDistance = verticalCycle;
    endX = startX;
    endY = startY - cycleDistance * 2;
  } else {
    startX = (width - movingWidth) / 2;
    startY = -movingHeight;
    cycleDistance = verticalCycle;
    endX = startX;
    endY = startY + cycleDistance * 2;
  }

  const distance = cycleDistance * 2;
  return {
    direction,
    startX,
    startY,
    endX,
    endY,
    distance,
    cycleDistance,
    copyGap:
      direction === "left" || direction === "right"
        ? horizontalGap
        : verticalGap,
    baseDurationMs: Math.max(
      1,
      (distance / MARQUEE_BASE_PIXELS_PER_SECOND) * 1000,
    ),
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
  if (
    typeof currentTime !== "number" ||
    !Number.isFinite(currentTime) ||
    durationMs <= 0
  ) {
    return null;
  }
  return (((currentTime % durationMs) + durationMs) % durationMs) / durationMs;
}

function setGeometryProperties(
  element: HTMLElement,
  geometry: MarqueeGeometry,
): void {
  element.style.setProperty("--marquee-start-x", `${geometry.startX}px`);
  element.style.setProperty("--marquee-start-y", `${geometry.startY}px`);
  element.style.setProperty("--marquee-end-x", `${geometry.endX}px`);
  element.style.setProperty("--marquee-end-y", `${geometry.endY}px`);
  element.style.setProperty("--marquee-copy-gap", `${geometry.copyGap}px`);
  element.style.setProperty(
    "--marquee-base-duration",
    `${geometry.baseDurationMs}ms`,
  );
}

function removeGeometryProperties(element: HTMLElement): void {
  element.style.removeProperty("--marquee-start-x");
  element.style.removeProperty("--marquee-start-y");
  element.style.removeProperty("--marquee-end-x");
  element.style.removeProperty("--marquee-end-y");
  element.style.removeProperty("--marquee-copy-gap");
  element.style.removeProperty("--marquee-base-duration");
  element.style.removeProperty("--marquee-fallback-duration");
  element.style.removeProperty("--marquee-fallback-half-delay");
}

export function useMarqueeMotion({
  animationKey,
  direction,
  enabled,
  fontSize,
  movingRef,
  primaryCopyRef,
  secondaryCopyRef,
  paused,
  speed,
  viewportRef,
}: UseMarqueeMotionOptions): void {
  const animationsRef = useRef<Animation[]>([]);
  const geometryRef = useRef<MarqueeGeometry | null>(null);
  const geometryKeyRef = useRef("");
  const rebuildFrameRef = useRef<number | null>(null);
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

  const cancelRebuild = useCallback(() => {
    if (rebuildFrameRef.current !== null) {
      cancelAnimationFrame(rebuildFrameRef.current);
      rebuildFrameRef.current = null;
    }
  }, []);

  const cancelRateTransition = useCallback(() => {
    if (rateFrameRef.current !== null) {
      cancelAnimationFrame(rateFrameRef.current);
      rateFrameRef.current = null;
    }
  }, []);

  const cancelAnimations = useCallback(() => {
    animationsRef.current.forEach((animation) => animation.cancel());
    animationsRef.current = [];
  }, []);

  const applyFallbackSpeed = useCallback(() => {
    const moving = movingRef.current;
    const geometry = geometryRef.current;
    if (
      !moving ||
      !geometry ||
      !moving.classList.contains("uses-css-marquee")
    ) {
      return;
    }
    const durationSeconds =
      geometry.distance / speedToPixelsPerSecond(speedRef.current);
    moving.style.setProperty(
      "--marquee-fallback-duration",
      `${durationSeconds}s`,
    );
    moving.style.setProperty(
      "--marquee-fallback-half-delay",
      `${-durationSeconds / 2}s`,
    );
  }, [movingRef]);

  const rebuild = useCallback(() => {
    const viewport = viewportRef.current;
    const moving = movingRef.current;
    const primaryCopy = primaryCopyRef.current;
    const secondaryCopy = secondaryCopyRef.current;
    if (
      !viewport ||
      !moving ||
      !primaryCopy ||
      !secondaryCopy ||
      !enabled
    ) {
      return;
    }

    const viewportRect = viewport.getBoundingClientRect();
    const contentRect = primaryCopy.getBoundingClientRect();
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
    const previousAnimation = animationsRef.current[0] ?? null;
    const shouldPreserveProgress =
      previousAnimation !== null && geometryKeyRef.current === nextGeometryKey;
    const previousProgress =
      shouldPreserveProgress && geometryRef.current
        ? animationProgress(
            previousAnimation,
            geometryRef.current.baseDurationMs,
          )
        : null;
    cancelAnimations();
    geometryRef.current = nextGeometry;
    geometryKeyRef.current = nextGeometryKey;
    setGeometryProperties(moving, nextGeometry);

    const targetRate =
      speedToPixelsPerSecond(speedRef.current) /
      MARQUEE_BASE_PIXELS_PER_SECOND;
    currentRateRef.current = targetRate;

    if (
      typeof primaryCopy.animate !== "function" ||
      typeof secondaryCopy.animate !== "function"
    ) {
      moving.classList.add("uses-css-marquee");
      applyFallbackSpeed();
      return;
    }

    moving.classList.remove("uses-css-marquee");
    const created: Animation[] = [];
    try {
      const keyframes: Keyframe[] = [
        {
          transform: `translate3d(${nextGeometry.startX}px, ${nextGeometry.startY}px, 0)`,
        },
        {
          transform: `translate3d(${nextGeometry.endX}px, ${nextGeometry.endY}px, 0)`,
        },
      ];
      const timing: KeyframeAnimationOptions = {
        duration: nextGeometry.baseDurationMs,
        easing: "linear",
        iterations: Infinity,
      };
      const primaryAnimation = primaryCopy.animate(keyframes, timing);
      created.push(primaryAnimation);
      const secondaryAnimation = secondaryCopy.animate(keyframes, timing);
      created.push(secondaryAnimation);
      animationsRef.current = created;

      const primaryProgress = previousProgress ?? 0;
      const secondaryProgress = (primaryProgress + 0.5) % 1;
      for (const [index, animation] of created.entries()) {
        animation.pause();
        animation.currentTime =
          (index === 0 ? primaryProgress : secondaryProgress) *
          nextGeometry.baseDurationMs;
        animation.updatePlaybackRate(targetRate);
      }
      if (!pausedRef.current) {
        created.forEach((animation) => animation.play());
      }
    } catch {
      created.forEach((animation) => animation.cancel());
      animationsRef.current = [];
      moving.classList.add("uses-css-marquee");
      applyFallbackSpeed();
    }
  }, [
    animationKey,
    applyFallbackSpeed,
    cancelAnimations,
    cancelRateTransition,
    direction,
    enabled,
    movingRef,
    primaryCopyRef,
    secondaryCopyRef,
    viewportRef,
  ]);

  const scheduleRebuild = useCallback(() => {
    if (rebuildFrameRef.current !== null) return;
    rebuildFrameRef.current = requestAnimationFrame(() => {
      rebuildFrameRef.current = null;
      rebuild();
    });
  }, [rebuild]);

  useLayoutEffect(() => {
    const moving = movingRef.current;
    if (!enabled) {
      cancelRebuild();
      cancelRateTransition();
      cancelAnimations();
      geometryRef.current = null;
      geometryKeyRef.current = "";
      if (moving) {
        moving.classList.remove("uses-css-marquee");
        removeGeometryProperties(moving);
      }
      return;
    }

    scheduleRebuild();
    const observer = new ResizeObserver(scheduleRebuild);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (primaryCopyRef.current) observer.observe(primaryCopyRef.current);
    return () => {
      cancelRebuild();
      observer.disconnect();
    };
  }, [
    animationKey,
    cancelAnimations,
    cancelRateTransition,
    cancelRebuild,
    direction,
    enabled,
    fontSize,
    movingRef,
    primaryCopyRef,
    scheduleRebuild,
    viewportRef,
  ]);

  useLayoutEffect(() => {
    const animations = animationsRef.current;
    if (!enabled || animations.length === 0) {
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
      if (
        animationsRef.current.length !== animations.length ||
        animationsRef.current.some(
          (animation, index) => animation !== animations[index],
        )
      ) {
        return;
      }
      const progress = Math.min(
        1,
        (now - startedAt) / MARQUEE_RATE_TRANSITION_MS,
      );
      const nextRate = interpolatePlaybackRate(
        startRate,
        targetRate,
        progress,
      );
      animations.forEach((animation) =>
        animation.updatePlaybackRate(nextRate),
      );
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
    const animations = animationsRef.current;
    if (!enabled || animations.length === 0) return;
    animations.forEach((animation) => {
      if (paused) animation.pause();
      else animation.play();
    });
  }, [enabled, paused]);

  useLayoutEffect(
    () => () => {
      cancelRebuild();
      cancelRateTransition();
      cancelAnimations();
    },
    [cancelAnimations, cancelRateTransition, cancelRebuild],
  );
}
