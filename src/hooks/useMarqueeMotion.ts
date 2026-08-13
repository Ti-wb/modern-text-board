import type { RefObject } from "preact";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";

import { LIMITS, clamp } from "../domain/defaults";
import type { MarqueeDirection } from "../domain/types";

export const MARQUEE_BASE_PIXELS_PER_SECOND = 100;
export const MARQUEE_RATE_FOLLOW_TIME_CONSTANT_MS = 52;
export const MARQUEE_RESIZE_SETTLE_MS = 80;
/** Blank space between repeated copies, relative to the active text viewport. */
export const MARQUEE_COPY_GAP_RATIO = 0.5;

export interface AdaptiveMarqueeSpeed {
  requestedPixelsPerSecond: number;
  effectivePixelsPerSecond: number;
  cssPixelsPerFrame: number;
  devicePixelsPerFrame: number;
}

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

export interface MarqueeMotionController {
  /** Preview a speed without rerendering the board or committing workspace state. */
  previewSpeed: (speed: number) => void;
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
  controllerRef?: RefObject<MarqueeMotionController>;
  devicePixelRatio?: number;
  refreshRateHz?: number;
}

interface MarqueeMotionState {
  runtimeBudgetExceeded: boolean;
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
 * Keeps motion below eight CSS pixels per displayed frame, then opportunistically
 * snaps the step to a quarter physical pixel. A snap is rejected when it would
 * make the requested speed more than three percent slower.
 */
export function resolveAdaptiveMarqueeSpeed(
  requestedPxPerSecond: number,
  refreshRateHz: number,
  devicePixelRatio: number,
): AdaptiveMarqueeSpeed {
  const requestedPixelsPerSecond = Math.max(
    0,
    Number.isFinite(requestedPxPerSecond) ? requestedPxPerSecond : 0,
  );
  const refreshRate = clamp(
    Number.isFinite(refreshRateHz) ? refreshRateHz : 60,
    24,
    360,
  );
  const ratio = clamp(
    Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1,
    1,
    8,
  );
  const cappedPixelsPerSecond = Math.min(
    requestedPixelsPerSecond,
    refreshRate * 8,
  );
  const unsnappedCssPixelsPerFrame = cappedPixelsPerSecond / refreshRate;
  const unsnappedDevicePixelsPerFrame =
    unsnappedCssPixelsPerFrame * ratio;
  const alignedDevicePixelsPerFrame =
    Math.floor(unsnappedDevicePixelsPerFrame * 4 + 1e-7) / 4;
  const alignedPixelsPerSecond =
    (alignedDevicePixelsPerFrame / ratio) * refreshRate;
  const alignmentDeviation = cappedPixelsPerSecond > 0
    ? (cappedPixelsPerSecond - alignedPixelsPerSecond) /
      cappedPixelsPerSecond
    : 0;
  const useAlignment =
    alignedDevicePixelsPerFrame > 0 &&
    alignmentDeviation >= 0 &&
    alignmentDeviation <= 0.03;
  const effectivePixelsPerSecond = Math.min(
    requestedPixelsPerSecond,
    useAlignment ? alignedPixelsPerSecond : cappedPixelsPerSecond,
  );
  const cssPixelsPerFrame = effectivePixelsPerSecond / refreshRate;

  return {
    requestedPixelsPerSecond,
    effectivePixelsPerSecond,
    cssPixelsPerFrame,
    devicePixelsPerFrame: cssPixelsPerFrame * ratio,
  };
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

export function followPlaybackRate(
  currentRate: number,
  targetRate: number,
  elapsedMs: number,
): number {
  const deltaMs = clamp(
    Number.isFinite(elapsedMs) ? elapsedMs : 0,
    0,
    100,
  );
  const followAmount = 1 - Math.exp(
    -deltaMs / MARQUEE_RATE_FOLLOW_TIME_CONSTANT_MS,
  );
  return currentRate + (targetRate - currentRate) * followAmount;
}

function sameGeometry(
  left: MarqueeGeometry,
  right: MarqueeGeometry,
  devicePixelRatio: number,
): boolean {
  const threshold = 1 / Math.max(1, devicePixelRatio);
  return (
    left.direction === right.direction &&
    Math.abs(left.startX - right.startX) < threshold &&
    Math.abs(left.startY - right.startY) < threshold &&
    Math.abs(left.endX - right.endX) < threshold &&
    Math.abs(left.endY - right.endY) < threshold &&
    Math.abs(left.copyGap - right.copyGap) < threshold
  );
}

export function measureUntransformedLayoutBox(element: HTMLElement): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, element.clientWidth, element.offsetWidth, element.scrollWidth),
    height: Math.max(1, element.clientHeight, element.offsetHeight, element.scrollHeight),
  };
}

function measureViewportLayoutBox(element: HTMLElement): {
  width: number;
  height: number;
} {
  return {
    width: Math.max(1, element.clientWidth, element.offsetWidth),
    height: Math.max(1, element.clientHeight, element.offsetHeight),
  };
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

/**
 * Preserve the moving-axis screen coordinate when viewport geometry changes.
 * A normalized timeline percentage alone is not stable because the start and
 * travel distance both depend on the viewport size.
 */
export function remapMarqueeProgress(
  progress: number,
  previous: MarqueeGeometry,
  next: MarqueeGeometry,
): number {
  const horizontal = previous.direction === "left" || previous.direction === "right";
  const previousStart = horizontal ? previous.startX : previous.startY;
  const previousEnd = horizontal ? previous.endX : previous.endY;
  const nextStart = horizontal ? next.startX : next.startY;
  const nextEnd = horizontal ? next.endX : next.endY;
  const viewportExtent = previous.copyGap / MARQUEE_COPY_GAP_RATIO;
  const contentExtent = previous.cycleDistance - previous.copyGap;
  const phases = [progress, (progress + 0.5) % 1];
  const visiblePixels = phases.map((phase) => {
    const position = previousStart + (previousEnd - previousStart) * phase;
    return Math.max(
      0,
      Math.min(viewportExtent, position + contentExtent) - Math.max(0, position),
    );
  });
  // During half of the cycle the secondary copy is the visible one. Preserve
  // whichever copy contributes the most pixels, then convert its remapped
  // phase back to the primary timeline so resize cannot swap visible copies.
  const copyIndex = visiblePixels[1] > visiblePixels[0] ? 1 : 0;
  const visibleProgress = phases[copyIndex];
  const previousPosition =
    previousStart + (previousEnd - previousStart) * visibleProgress;
  const nextDistance = nextEnd - nextStart;
  if (Math.abs(nextDistance) < 0.0001) return 0;

  const mappedVisibleProgress = (previousPosition - nextStart) / nextDistance;
  const mappedPrimaryProgress = mappedVisibleProgress - copyIndex * 0.5;
  return ((mappedPrimaryProgress % 1) + 1) % 1;
}

export function snapMarqueeCrossAxis(
  value: number,
  devicePixelRatio: number,
): number {
  const ratio = Math.max(1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1);
  return Math.round(value * ratio) / ratio;
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
  controllerRef,
  devicePixelRatio = window.devicePixelRatio || 1,
  refreshRateHz = 60,
}: UseMarqueeMotionOptions): MarqueeMotionState {
  const [runtimeBudgetExceeded, setRuntimeBudgetExceeded] = useState(false);
  const animationsRef = useRef<Animation[]>([]);
  const geometryRef = useRef<MarqueeGeometry | null>(null);
  const geometryKeyRef = useRef("");
  const rebuildFrameRef = useRef<number | null>(null);
  const rateFrameRef = useRef<number | null>(null);
  const currentRateRef = useRef(1);
  const targetRateRef = useRef(1);
  const previousRateFrameTimeRef = useRef<number | null>(null);
  const rebuildSettleTimerRef = useRef<number | null>(null);
  const observedLayoutSizesRef = useRef<{
    primary: { width: number; height: number } | null;
    viewport: { width: number; height: number } | null;
  }>({ primary: null, viewport: null });
  const speedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const fallbackControllerRef = useRef<MarqueeMotionController>(null);

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
    if (rebuildSettleTimerRef.current !== null) {
      window.clearTimeout(rebuildSettleTimerRef.current);
      rebuildSettleTimerRef.current = null;
    }
  }, []);

  const cancelRateTransition = useCallback(() => {
    if (rateFrameRef.current !== null) {
      cancelAnimationFrame(rateFrameRef.current);
      rateFrameRef.current = null;
    }
    previousRateFrameTimeRef.current = null;
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
    const effectiveSpeed = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(speedRef.current),
      refreshRateHz,
      devicePixelRatio,
    ).effectivePixelsPerSecond;
    const durationSeconds = geometry.distance / Math.max(1, effectiveSpeed);
    moving.style.setProperty(
      "--marquee-fallback-duration",
      `${durationSeconds}s`,
    );
    moving.style.setProperty(
      "--marquee-fallback-half-delay",
      `${-durationSeconds / 2}s`,
    );
  }, [devicePixelRatio, movingRef, refreshRateHz]);

  const transitionToSpeed = useCallback((nextSpeed: number) => {
    speedRef.current = nextSpeed;
    const animations = animationsRef.current;
    targetRateRef.current = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(nextSpeed),
      refreshRateHz,
      devicePixelRatio,
    ).effectivePixelsPerSecond / MARQUEE_BASE_PIXELS_PER_SECOND;
    if (!enabled || animations.length === 0) {
      applyFallbackSpeed();
      return;
    }

    // Input events only move the target. One persistent follower keeps its
    // current velocity, so rapid slider updates cannot restart the easing.
    if (rateFrameRef.current !== null) return;
    const update = (now: number) => {
      if (
        animationsRef.current.length !== animations.length ||
        animationsRef.current.some(
          (animation, index) => animation !== animations[index],
        )
      ) {
        rateFrameRef.current = null;
        previousRateFrameTimeRef.current = null;
        return;
      }
      const elapsedMs = previousRateFrameTimeRef.current === null
        ? 1000 / Math.max(1, refreshRateHz)
        : now - previousRateFrameTimeRef.current;
      previousRateFrameTimeRef.current = now;
      const nextRate = followPlaybackRate(
        currentRateRef.current,
        targetRateRef.current,
        elapsedMs,
      );
      animations.forEach((animation) =>
        animation.updatePlaybackRate(nextRate),
      );
      currentRateRef.current = nextRate;
      if (Math.abs(targetRateRef.current - nextRate) > 0.001) {
        rateFrameRef.current = requestAnimationFrame(update);
      } else {
        animations.forEach((animation) =>
          animation.updatePlaybackRate(targetRateRef.current),
        );
        currentRateRef.current = targetRateRef.current;
        rateFrameRef.current = null;
        previousRateFrameTimeRef.current = null;
      }
    };
    rateFrameRef.current = requestAnimationFrame(update);
  }, [applyFallbackSpeed, devicePixelRatio, enabled, refreshRateHz]);

  useImperativeHandle(
    controllerRef ?? fallbackControllerRef,
    () => ({ previewSpeed: transitionToSpeed }),
    [transitionToSpeed],
  );

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

    const viewportBox = measureViewportLayoutBox(viewport);
    const contentBox = measureUntransformedLayoutBox(primaryCopy);
    const physicalContentWidth = Math.ceil(
      contentBox.width * devicePixelRatio,
    );
    const physicalContentHeight = Math.ceil(
      contentBox.height * devicePixelRatio,
    );
    if (
      physicalContentWidth > LIMITS.maxMarqueeLayerDeviceWidthPx ||
      physicalContentWidth * physicalContentHeight >
        LIMITS.maxMarqueeLayerDeviceAreaPx
    ) {
      setRuntimeBudgetExceeded(true);
      cancelRateTransition();
      cancelAnimations();
      geometryRef.current = null;
      geometryKeyRef.current = "";
      moving.classList.remove("uses-css-marquee");
      moving.classList.add("is-marquee-suppressed");
      removeGeometryProperties(moving);
      return;
    }
    setRuntimeBudgetExceeded(false);
    moving.classList.remove("is-marquee-suppressed");
    const nextGeometry = calculateMarqueeGeometry(
      direction,
      viewportBox.width,
      viewportBox.height,
      contentBox.width,
      contentBox.height,
    );
    if (direction === "left" || direction === "right") {
      nextGeometry.startY = snapMarqueeCrossAxis(
        nextGeometry.startY,
        devicePixelRatio,
      );
      nextGeometry.endY = nextGeometry.startY;
    } else {
      nextGeometry.startX = snapMarqueeCrossAxis(
        nextGeometry.startX,
        devicePixelRatio,
      );
      nextGeometry.endX = nextGeometry.startX;
    }
    const nextGeometryKey = `${animationKey}:${direction}`;
    if (
      geometryRef.current &&
      geometryKeyRef.current === nextGeometryKey &&
      sameGeometry(geometryRef.current, nextGeometry, devicePixelRatio)
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
    const initialProgress =
      previousProgress !== null && geometryRef.current
        ? remapMarqueeProgress(
            previousProgress,
            geometryRef.current,
            nextGeometry,
          )
        : 0;
    cancelAnimations();
    geometryRef.current = nextGeometry;
    geometryKeyRef.current = nextGeometryKey;
    setGeometryProperties(moving, nextGeometry);

    const targetRate = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(speedRef.current),
      refreshRateHz,
      devicePixelRatio,
    ).effectivePixelsPerSecond / MARQUEE_BASE_PIXELS_PER_SECOND;
    currentRateRef.current = targetRate;
    targetRateRef.current = targetRate;

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

      const primaryProgress = initialProgress;
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
    devicePixelRatio,
    enabled,
    movingRef,
    primaryCopyRef,
    secondaryCopyRef,
    refreshRateHz,
    viewportRef,
  ]);

  const scheduleRebuild = useCallback(() => {
    // Rebuild immediately at the beginning of a resize burst, then exactly
    // once more after layout settles. Intermediate observer noise is ignored.
    const startsNewBurst = rebuildSettleTimerRef.current === null;
    if (startsNewBurst && rebuildFrameRef.current === null) {
      rebuildFrameRef.current = requestAnimationFrame(() => {
        rebuildFrameRef.current = null;
        rebuild();
      });
    }
    if (rebuildSettleTimerRef.current !== null) {
      window.clearTimeout(rebuildSettleTimerRef.current);
    }
    rebuildSettleTimerRef.current = window.setTimeout(() => {
      rebuildSettleTimerRef.current = null;
      if (rebuildFrameRef.current !== null) return;
      rebuildFrameRef.current = requestAnimationFrame(() => {
        rebuildFrameRef.current = null;
        rebuild();
      });
    }, MARQUEE_RESIZE_SETTLE_MS);
  }, [rebuild]);

  useLayoutEffect(() => {
    const moving = movingRef.current;
    if (!enabled) {
      setRuntimeBudgetExceeded(false);
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
    const viewportElement = viewportRef.current;
    const primaryElement = primaryCopyRef.current;
    const observer = new ResizeObserver((entries) => {
      let materialChange = false;
      for (const entry of entries) {
        const boxSize = entry.contentBoxSize;
        const firstBox = Array.isArray(boxSize) ? boxSize[0] : boxSize;
        const next = {
          width: firstBox?.inlineSize ?? entry.contentRect.width,
          height: firstBox?.blockSize ?? entry.contentRect.height,
        };
        const key = entry.target === viewportElement ? "viewport" : "primary";
        const previous = observedLayoutSizesRef.current[key];
        observedLayoutSizesRef.current[key] = next;
        if (
          !previous ||
          Math.abs(next.width - previous.width) * devicePixelRatio >= 1 ||
          Math.abs(next.height - previous.height) * devicePixelRatio >= 1
        ) {
          materialChange = true;
        }
      }
      if (materialChange) scheduleRebuild();
    });
    observedLayoutSizesRef.current = { primary: null, viewport: null };
    if (viewportElement) observer.observe(viewportElement);
    if (primaryElement) observer.observe(primaryElement);
    return () => {
      cancelRebuild();
      observer.disconnect();
    };
  }, [
    animationKey,
    cancelAnimations,
    cancelRateTransition,
    cancelRebuild,
    devicePixelRatio,
    direction,
    enabled,
    fontSize,
    movingRef,
    primaryCopyRef,
    scheduleRebuild,
    viewportRef,
  ]);

  useLayoutEffect(() => {
    transitionToSpeed(speed);
    return cancelRateTransition;
  }, [cancelRateTransition, speed, transitionToSpeed]);

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

  return { runtimeBudgetExceeded };
}
