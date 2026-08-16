import type { RefObject } from "preact";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "preact/hooks";

import type { MarqueeDirection } from "../domain/types";
import {
  calculateMarqueeGeometry,
  remapMarqueeProgress,
  snapMarqueeCrossAxis,
  speedToPixelsPerSecond,
  type MarqueeGeometry,
  type MarqueeMotionController,
} from "./useMarqueeMotion";

interface UseCssMarqueeMotionOptions {
  animationKey: string;
  controllerRef?: RefObject<MarqueeMotionController>;
  direction: MarqueeDirection;
  enabled: boolean;
  fontSize: number;
  movingRef: RefObject<HTMLElement>;
  paused: boolean;
  primaryCopyRef: RefObject<HTMLElement>;
  secondaryCopyRef: RefObject<HTMLElement>;
  speed: number;
  viewportRef: RefObject<HTMLElement>;
}

export interface PhaseClock {
  at: number;
  distance: number;
  phase: number;
  pixelsPerSecond: number;
  running: boolean;
}

function wrapProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

export function resolveCssMarqueePhase(clock: PhaseClock, now: number): number {
  if (!clock.running || clock.distance <= 0) return wrapProgress(clock.phase);
  const elapsedSeconds = Math.max(0, now - clock.at) / 1000;
  return wrapProgress(
    clock.phase + (elapsedSeconds * clock.pixelsPerSecond) / clock.distance,
  );
}

export function calculateCssMarqueeTiming(
  distance: number,
  pixelsPerSecond: number,
  phase: number,
  timelineCurrentTime: number | null,
): { durationMs: number; primaryDelayMs: number; secondaryDelayMs: number } {
  const durationMs = Math.max(
    1,
    (Math.max(1, distance) / Math.max(1, pixelsPerSecond)) * 1000,
  );
  const normalizedPhase = wrapProgress(phase);
  const primaryDelayMs = timelineCurrentTime === null
    ? -normalizedPhase * durationMs
    : timelineCurrentTime - normalizedPhase * durationMs;
  return {
    durationMs,
    primaryDelayMs,
    secondaryDelayMs: primaryDelayMs - durationMs / 2,
  };
}

function sameGeometry(left: MarqueeGeometry, right: MarqueeGeometry): boolean {
  return (
    left.direction === right.direction &&
    Math.abs(left.startX - right.startX) < 0.25 &&
    Math.abs(left.startY - right.startY) < 0.25 &&
    Math.abs(left.endX - right.endX) < 0.25 &&
    Math.abs(left.endY - right.endY) < 0.25 &&
    Math.abs(left.distance - right.distance) < 0.25
  );
}

function removeCssMarqueeProperties(element: HTMLElement): void {
  [
    "--marquee-end-x",
    "--marquee-end-y",
    "--marquee-fallback-duration",
    "--marquee-primary-delay",
    "--marquee-secondary-delay",
    "--marquee-start-x",
    "--marquee-start-y",
  ].forEach((property) => element.style.removeProperty(property));
}

export function useCssMarqueeMotion({
  animationKey,
  controllerRef,
  direction,
  enabled,
  fontSize,
  movingRef,
  paused,
  primaryCopyRef,
  secondaryCopyRef,
  speed,
  viewportRef,
}: UseCssMarqueeMotionOptions): void {
  const fallbackControllerRef = useRef<MarqueeMotionController>(null);
  const geometryKeyRef = useRef("");
  const geometryRef = useRef<MarqueeGeometry | null>(null);
  const phaseClockRef = useRef<PhaseClock | null>(null);
  const rebuildFrameRef = useRef<number | null>(null);
  const speedFrameRef = useRef<number | null>(null);
  const pendingSpeedRef = useRef(speed);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);

  useLayoutEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const cancelRebuild = useCallback(() => {
    if (rebuildFrameRef.current === null) return;
    cancelAnimationFrame(rebuildFrameRef.current);
    rebuildFrameRef.current = null;
  }, []);

  const cancelSpeedPreview = useCallback(() => {
    if (speedFrameRef.current === null) return;
    cancelAnimationFrame(speedFrameRef.current);
    speedFrameRef.current = null;
  }, []);

  const readAnimationSnapshot = useCallback((now: number) => {
    const fallbackClock = phaseClockRef.current;
    const fallbackPhase = fallbackClock
      ? resolveCssMarqueePhase(fallbackClock, now)
      : 0;
    const animation = primaryCopyRef.current
      ?.getAnimations()
      .find(
        (candidate) =>
          "animationName" in candidate &&
          (candidate as CSSAnimation).animationName === "marquee-motion",
      );
    const currentTime = animation?.currentTime;
    const progress = animation?.effect?.getComputedTiming().progress;
    return {
      currentTime:
        typeof currentTime === "number" && Number.isFinite(currentTime)
          ? currentTime
          : null,
      phase:
        typeof progress === "number" && Number.isFinite(progress)
          ? wrapProgress(progress)
          : fallbackPhase,
    };
  }, [primaryCopyRef]);

  const applyAnimation = useCallback((
    phase: number,
    now: number,
    timelineCurrentTime: number | null = null,
  ) => {
    const moving = movingRef.current;
    const geometry = geometryRef.current;
    if (!moving || !geometry || !enabled) return;

    const pixelsPerSecond = speedToPixelsPerSecond(speedRef.current);
    const primaryPhase = wrapProgress(phase);
    const timing = calculateCssMarqueeTiming(
      geometry.distance,
      pixelsPerSecond,
      primaryPhase,
      timelineCurrentTime,
    );

    moving.style.setProperty("--marquee-start-x", `${geometry.startX}px`);
    moving.style.setProperty("--marquee-start-y", `${geometry.startY}px`);
    moving.style.setProperty("--marquee-end-x", `${geometry.endX}px`);
    moving.style.setProperty("--marquee-end-y", `${geometry.endY}px`);
    moving.style.setProperty(
      "--marquee-fallback-duration",
      `${timing.durationMs}ms`,
    );
    moving.style.setProperty(
      "--marquee-primary-delay",
      `${timing.primaryDelayMs}ms`,
    );
    moving.style.setProperty(
      "--marquee-secondary-delay",
      `${timing.secondaryDelayMs}ms`,
    );
    moving.classList.add("uses-css-marquee");
    phaseClockRef.current = {
      at: now,
      distance: geometry.distance,
      phase: primaryPhase,
      pixelsPerSecond,
      running: !pausedRef.current,
    };
  }, [enabled, movingRef]);

  const applySpeed = useCallback((nextSpeed: number, now = performance.now()) => {
    const snapshot = readAnimationSnapshot(now);
    speedRef.current = nextSpeed;
    pendingSpeedRef.current = nextSpeed;
    applyAnimation(snapshot.phase, now, snapshot.currentTime);
  }, [applyAnimation, readAnimationSnapshot]);

  const previewSpeed = useCallback((nextSpeed: number) => {
    pendingSpeedRef.current = nextSpeed;
    if (speedFrameRef.current !== null) return;
    speedFrameRef.current = requestAnimationFrame((now) => {
      speedFrameRef.current = null;
      applySpeed(pendingSpeedRef.current, now);
    });
  }, [applySpeed]);

  useImperativeHandle(
    controllerRef ?? fallbackControllerRef,
    () => ({ previewSpeed }),
    [previewSpeed],
  );

  const rebuild = useCallback(() => {
    const viewport = viewportRef.current;
    const moving = movingRef.current;
    const primaryCopy = primaryCopyRef.current;
    const secondaryCopy = secondaryCopyRef.current;
    if (!viewport || !moving || !primaryCopy || !secondaryCopy || !enabled) return;

    const viewportWidth = Math.max(1, viewport.clientWidth);
    const viewportHeight = Math.max(1, viewport.clientHeight);
    const contentWidth = Math.max(1, primaryCopy.offsetWidth);
    const contentHeight = Math.max(1, primaryCopy.offsetHeight);
    const nextGeometry = calculateMarqueeGeometry(
      direction,
      viewportWidth,
      viewportHeight,
      contentWidth,
      contentHeight,
    );
    const ratio = window.devicePixelRatio || 1;
    if (direction === "left" || direction === "right") {
      nextGeometry.startY = snapMarqueeCrossAxis(nextGeometry.startY, ratio);
      nextGeometry.endY = nextGeometry.startY;
    } else {
      nextGeometry.startX = snapMarqueeCrossAxis(nextGeometry.startX, ratio);
      nextGeometry.endX = nextGeometry.startX;
    }

    const now = performance.now();
    const previousGeometry = geometryRef.current;
    const snapshot = readAnimationSnapshot(now);
    const nextKey = `${animationKey}:${direction}`;
    if (
      previousGeometry &&
      geometryKeyRef.current === nextKey &&
      sameGeometry(previousGeometry, nextGeometry)
    ) {
      return;
    }

    let nextPhase = snapshot.phase;
    if (previousGeometry && geometryKeyRef.current === nextKey) {
      nextPhase = remapMarqueeProgress(nextPhase, previousGeometry, nextGeometry);
    }
    geometryRef.current = nextGeometry;
    geometryKeyRef.current = nextKey;
    applyAnimation(nextPhase, now, snapshot.currentTime);
  }, [
    animationKey,
    applyAnimation,
    direction,
    enabled,
    movingRef,
    primaryCopyRef,
    readAnimationSnapshot,
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
      cancelSpeedPreview();
      geometryKeyRef.current = "";
      geometryRef.current = null;
      phaseClockRef.current = null;
      if (moving) {
        moving.classList.remove("uses-css-marquee");
        removeCssMarqueeProperties(moving);
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
    cancelRebuild,
    cancelSpeedPreview,
    direction,
    enabled,
    fontSize,
    movingRef,
    primaryCopyRef,
    scheduleRebuild,
    viewportRef,
  ]);

  useLayoutEffect(() => {
    if (!enabled || Math.abs(speed - speedRef.current) < 0.0001) return;
    applySpeed(speed);
  }, [applySpeed, enabled, speed]);

  useLayoutEffect(() => {
    if (!enabled || !phaseClockRef.current) return;
    const now = performance.now();
    const snapshot = readAnimationSnapshot(now);
    applyAnimation(snapshot.phase, now, snapshot.currentTime);
  }, [applyAnimation, enabled, paused, readAnimationSnapshot]);

  useLayoutEffect(
    () => () => {
      cancelRebuild();
      cancelSpeedPreview();
      const moving = movingRef.current;
      if (moving) {
        moving.classList.remove("uses-css-marquee");
        removeCssMarqueeProperties(moving);
      }
    },
    [cancelRebuild, cancelSpeedPreview, movingRef],
  );
}
