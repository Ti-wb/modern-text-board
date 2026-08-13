import { useEffect, useRef, useState } from "preact/hooks";

export interface DisplayCadenceSnapshot {
  refreshRateHz: number;
  frameIntervalMs: number;
  status: "measuring" | "stable" | "fallback";
}

export interface UseDisplayCadenceOptions {
  /** Enables the lightweight 60-second recalibration while motion is active. */
  active?: boolean;
}

export const DISPLAY_CADENCE_FALLBACK_HZ = 60;
export const DISPLAY_CADENCE_SAMPLE_COUNT = 48;

const DISPLAY_CADENCE_RECALIBRATION_MS = 60_000;
const DISPLAY_CADENCE_MAX_ATTEMPTS = 180;
const DISPLAY_CADENCE_MIN_HZ = 30;
const DISPLAY_CADENCE_MAX_HZ = 360;
const DISPLAY_CADENCE_MAX_RAW_INTERVAL_MS = 250;
const DISPLAY_CADENCE_MAX_MAD_RATIO = 0.06;
const DISPLAY_CADENCE_MAX_SPREAD_RATIO = 0.18;
const DISPLAY_CADENCE_UPDATE_HYSTERESIS_RATIO = 0.03;
const STANDARD_REFRESH_RATES = [
  30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 200, 240, 360,
] as const;

const FALLBACK_SNAPSHOT: DisplayCadenceSnapshot = {
  refreshRateHz: DISPLAY_CADENCE_FALLBACK_HZ,
  frameIntervalMs: 1000 / DISPLAY_CADENCE_FALLBACK_HZ,
  status: "fallback",
};

const MEASURING_SNAPSHOT: DisplayCadenceSnapshot = {
  ...FALLBACK_SNAPSHOT,
  status: "measuring",
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function quantile(sortedValues: readonly number[], fraction: number): number {
  const position = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return (
    sortedValues[lowerIndex] * (1 - weight) +
    sortedValues[upperIndex] * weight
  );
}

function normalizeRefreshRate(refreshRateHz: number): number {
  let nearest: number = Math.round(refreshRateHz);
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of STANDARD_REFRESH_RATES) {
    const distance = Math.abs(candidate - refreshRateHz);
    if (distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearestDistance / refreshRateHz <= 0.04
    ? nearest
    : Math.round(refreshRateHz);
}

/**
 * Removes invalid intervals and frames that are more than twice the median.
 * A doubled refresh slot is intentionally retained: it still carries the same
 * cadence signal, while longer stalls must not skew the estimate.
 */
export function filterCadenceIntervals(
  frameIntervalsMs: readonly number[],
): number[] {
  const plausible = frameIntervalsMs.filter(
    (interval) =>
      Number.isFinite(interval) &&
      interval > 0 &&
      interval <= DISPLAY_CADENCE_MAX_RAW_INTERVAL_MS,
  );
  if (plausible.length === 0) return [];
  const midpoint = median(plausible);
  return plausible.filter((interval) => interval <= midpoint * 2);
}

/**
 * Produces a stable cadence only after 48 trustworthy display intervals.
 * Wide median deviation or percentile spread indicates VRR/load noise, in
 * which case callers should keep their previous stable value (or use 60 Hz).
 */
export function estimateDisplayCadence(
  frameIntervalsMs: readonly number[],
): DisplayCadenceSnapshot {
  const filtered = filterCadenceIntervals(frameIntervalsMs);
  if (filtered.length < DISPLAY_CADENCE_SAMPLE_COUNT) {
    return MEASURING_SNAPSHOT;
  }

  const samples = filtered.slice(-DISPLAY_CADENCE_SAMPLE_COUNT);
  const sorted = [...samples].sort((left, right) => left - right);
  const frameIntervalMs = median(sorted);
  const absoluteDeviations = samples.map((sample) =>
    Math.abs(sample - frameIntervalMs),
  );
  const madRatio = median(absoluteDeviations) / frameIntervalMs;
  const spreadRatio =
    (quantile(sorted, 0.9) - quantile(sorted, 0.1)) / frameIntervalMs;
  const observedRefreshRateHz = 1000 / frameIntervalMs;

  if (
    observedRefreshRateHz < DISPLAY_CADENCE_MIN_HZ ||
    observedRefreshRateHz > DISPLAY_CADENCE_MAX_HZ ||
    madRatio > DISPLAY_CADENCE_MAX_MAD_RATIO ||
    spreadRatio > DISPLAY_CADENCE_MAX_SPREAD_RATIO
  ) {
    return FALLBACK_SNAPSHOT;
  }

  const refreshRateHz = normalizeRefreshRate(observedRefreshRateHz);
  return {
    refreshRateHz,
    frameIntervalMs: 1000 / refreshRateHz,
    status: "stable",
  };
}

function snapshotsMatch(
  left: DisplayCadenceSnapshot,
  right: DisplayCadenceSnapshot,
): boolean {
  return (
    left.status === right.status &&
    left.refreshRateHz === right.refreshRateHz &&
    left.frameIntervalMs === right.frameIntervalMs
  );
}

interface LongTaskRange {
  startTime: number;
  endTime: number;
}

/**
 * Samples the display only during short calibration windows. Once stable, the
 * hook has no per-frame application work; the marquee remains compositor-led.
 */
export function useDisplayCadence({
  active = false,
}: UseDisplayCadenceOptions = {}): DisplayCadenceSnapshot {
  const [snapshot, setSnapshot] = useState(MEASURING_SNAPSHOT);
  const lastStableRef = useRef<DisplayCadenceSnapshot | null>(null);

  useEffect(() => {
    let animationFrameId: number | null = null;
    let recalibrationTimerId: number | null = null;
    let resolutionQuery: MediaQueryList | null = null;
    let previousTimestamp: number | null = null;
    let attemptCount = 0;
    let frameIntervals: number[] = [];
    let longTasks: LongTaskRange[] = [];
    let disposed = false;

    const longTaskObserver =
      typeof PerformanceObserver !== "undefined" &&
      PerformanceObserver.supportedEntryTypes?.includes("longtask")
        ? new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              longTasks.push({
                startTime: entry.startTime,
                endTime: entry.startTime + entry.duration,
              });
            }
            if (longTasks.length > 16) longTasks = longTasks.slice(-16);
          })
        : null;
    let observingLongTasks = false;

    const startLongTaskObserver = () => {
      if (!longTaskObserver || observingLongTasks) return;
      try {
        longTaskObserver.observe({ entryTypes: ["longtask"] });
        observingLongTasks = true;
      } catch {
        longTaskObserver.disconnect();
      }
    };

    const stopLongTaskObserver = () => {
      if (!observingLongTasks) return;
      longTaskObserver?.disconnect();
      observingLongTasks = false;
    };

    const stopSampling = () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      previousTimestamp = null;
      stopLongTaskObserver();
    };

    const publishStable = (next: DisplayCadenceSnapshot) => {
      const previous = lastStableRef.current;
      if (
        previous &&
        Math.abs(next.refreshRateHz - previous.refreshRateHz) /
          previous.refreshRateHz <
          DISPLAY_CADENCE_UPDATE_HYSTERESIS_RATIO
      ) {
        return;
      }
      lastStableRef.current = next;
      setSnapshot((current) => (snapshotsMatch(current, next) ? current : next));
    };

    const finishWithoutStableEstimate = () => {
      const next = lastStableRef.current ?? FALLBACK_SNAPSHOT;
      setSnapshot((current) => (snapshotsMatch(current, next) ? current : next));
    };

    const sampleFrame: FrameRequestCallback = (timestamp) => {
      animationFrameId = null;
      if (disposed || document.visibilityState === "hidden") {
        previousTimestamp = null;
        return;
      }

      if (previousTimestamp !== null) {
        attemptCount += 1;
        const startTime = previousTimestamp;
        const interval = timestamp - startTime;
        const overlappedLongTask = longTasks.some(
          (task) => task.startTime < timestamp && task.endTime > startTime,
        );
        if (!overlappedLongTask && Number.isFinite(interval) && interval > 0) {
          frameIntervals.push(interval);
        }

        const estimate = estimateDisplayCadence(frameIntervals);
        if (estimate.status === "stable") {
          publishStable(estimate);
          stopLongTaskObserver();
          previousTimestamp = null;
          return;
        }
        if (attemptCount >= DISPLAY_CADENCE_MAX_ATTEMPTS) {
          finishWithoutStableEstimate();
          stopLongTaskObserver();
          previousTimestamp = null;
          return;
        }
      }

      previousTimestamp = timestamp;
      animationFrameId = requestAnimationFrame(sampleFrame);
    };

    const startMeasurement = () => {
      stopSampling();
      if (disposed || document.visibilityState === "hidden") return;
      previousTimestamp = null;
      attemptCount = 0;
      frameIntervals = [];
      longTasks = [];
      startLongTaskObserver();
      if (!lastStableRef.current) {
        setSnapshot((current) =>
          snapshotsMatch(current, MEASURING_SNAPSHOT)
            ? current
            : MEASURING_SNAPSHOT,
        );
      }
      animationFrameId = requestAnimationFrame(sampleFrame);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") stopSampling();
      else startMeasurement();
    };
    const handleDisplayChange = () => startMeasurement();
    const handleResolutionChange = () => {
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      resolutionQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      resolutionQuery.addEventListener("change", handleResolutionChange);
      startMeasurement();
    };

    resolutionQuery = window.matchMedia(
      `(resolution: ${window.devicePixelRatio || 1}dppx)`,
    );
    resolutionQuery.addEventListener("change", handleResolutionChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("fullscreenchange", handleDisplayChange);
    window.addEventListener("pageshow", handleDisplayChange);
    window.addEventListener("resize", handleDisplayChange);
    window.addEventListener("orientationchange", handleDisplayChange);
    window.visualViewport?.addEventListener("resize", handleDisplayChange);
    window.screen.orientation?.addEventListener("change", handleDisplayChange);
    if (active) {
      recalibrationTimerId = window.setInterval(
        startMeasurement,
        DISPLAY_CADENCE_RECALIBRATION_MS,
      );
    }
    startMeasurement();

    return () => {
      disposed = true;
      stopSampling();
      if (recalibrationTimerId !== null) {
        window.clearInterval(recalibrationTimerId);
      }
      longTaskObserver?.disconnect();
      resolutionQuery?.removeEventListener("change", handleResolutionChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      document.removeEventListener("fullscreenchange", handleDisplayChange);
      window.removeEventListener("pageshow", handleDisplayChange);
      window.removeEventListener("resize", handleDisplayChange);
      window.removeEventListener("orientationchange", handleDisplayChange);
      window.visualViewport?.removeEventListener("resize", handleDisplayChange);
      window.screen.orientation?.removeEventListener(
        "change",
        handleDisplayChange,
      );
    };
  }, [active]);

  return snapshot;
}
