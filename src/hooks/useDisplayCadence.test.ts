import { act, renderHook } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DISPLAY_CADENCE_SAMPLE_COUNT,
  estimateDisplayCadence,
  filterCadenceIntervals,
  useDisplayCadence,
} from "./useDisplayCadence";

function stableIntervals(refreshRateHz: number): number[] {
  const interval = 1000 / refreshRateHz;
  return Array.from({ length: DISPLAY_CADENCE_SAMPLE_COUNT }, (_, index) =>
    interval * (1 + ((index % 5) - 2) * 0.0005),
  );
}

interface FakeAnimationFrames {
  flushStableCadence: (refreshRateHz?: number) => void;
  pendingCount: () => number;
  requestCount: () => number;
}

function installFakeAnimationFrames(): FakeAnimationFrames {
  let nextId = 1;
  let timestamp = 0;
  let requests = 0;
  const callbacks = new Map<number, FrameRequestCallback>();

  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback) => {
      const id = nextId++;
      requests += 1;
      callbacks.set(id, callback);
      return id;
    },
  );
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    callbacks.delete(id);
  });

  return {
    flushStableCadence(refreshRateHz = 60) {
      const interval = 1000 / refreshRateHz;
      act(() => {
        // The first callback establishes the timestamp; the next 48 callbacks
        // provide the 48 valid intervals required by the estimator.
        for (let frame = 0; frame <= DISPLAY_CADENCE_SAMPLE_COUNT; frame += 1) {
          const pending = [...callbacks.values()];
          callbacks.clear();
          expect(pending).toHaveLength(1);
          pending[0](timestamp);
          timestamp += interval;
        }
      });
    },
    pendingCount: () => callbacks.size,
    requestCount: () => requests,
  };
}

describe("display cadence estimation", () => {
  it.each([
    [59.94, 60],
    [60, 60],
    [90, 90],
    [120, 120],
    [144, 144],
  ])("recognizes a stable %s Hz display as %s Hz", (observed, expected) => {
    const estimate = estimateDisplayCadence(stableIntervals(observed));

    expect(estimate.status).toBe("stable");
    expect(estimate.refreshRateHz).toBe(expected);
    expect(estimate.frameIntervalMs).toBeCloseTo(1000 / expected, 5);
  });

  it("waits for 48 valid frame intervals", () => {
    const estimate = estimateDisplayCadence(
      stableIntervals(60).slice(0, DISPLAY_CADENCE_SAMPLE_COUNT - 1),
    );

    expect(estimate).toMatchObject({
      refreshRateHz: 60,
      status: "measuring",
    });
  });

  it("excludes invalid samples and long frame outliers above twice the median", () => {
    const normal = stableIntervals(120);
    const filtered = filterCadenceIntervals([
      Number.NaN,
      0,
      ...normal,
      normal[0] * 3,
      Number.POSITIVE_INFINITY,
    ]);
    const estimate = estimateDisplayCadence([
      ...normal,
      normal[0] * 3,
    ]);

    expect(filtered).toHaveLength(DISPLAY_CADENCE_SAMPLE_COUNT);
    expect(estimate).toMatchObject({
      refreshRateHz: 120,
      status: "stable",
    });
  });

  it("falls back when VRR samples do not form a stable cadence", () => {
    const unstable = Array.from(
      { length: DISPLAY_CADENCE_SAMPLE_COUNT },
      (_, index) => 1000 / (index % 2 === 0 ? 60 : 120),
    );

    expect(estimateDisplayCadence(unstable)).toMatchObject({
      refreshRateHz: 60,
      status: "fallback",
    });
  });

  it("does not mistake sustained long-task cadence for a low-refresh display", () => {
    const blocked = Array.from(
      { length: DISPLAY_CADENCE_SAMPLE_COUNT },
      () => 50,
    );

    expect(estimateDisplayCadence(blocked)).toMatchObject({
      refreshRateHz: 60,
      status: "fallback",
    });
  });
});

describe("useDisplayCadence lifecycle", () => {
  let visibilityState: DocumentVisibilityState;

  beforeEach(() => {
    visibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(
      () => visibilityState,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops requesting frames after the initial 48-interval sample is stable", async () => {
    const frames = installFakeAnimationFrames();
    const { result } = renderHook(() => useDisplayCadence());

    expect(result.current.status).toBe("measuring");
    expect(frames.pendingCount()).toBe(1);

    frames.flushStableCadence(60);

    expect(result.current).toMatchObject({
      refreshRateHz: 60,
      status: "stable",
    });
    expect(frames.requestCount()).toBe(DISPLAY_CADENCE_SAMPLE_COUNT + 1);
    expect(frames.pendingCount()).toBe(0);
    await Promise.resolve();
    expect(frames.pendingCount()).toBe(0);
  });

  it("does not sample while hidden and restarts when the page becomes visible", () => {
    visibilityState = "hidden";
    const frames = installFakeAnimationFrames();
    const { result } = renderHook(() => useDisplayCadence());

    expect(frames.pendingCount()).toBe(0);
    expect(result.current.status).toBe("measuring");

    visibilityState = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(frames.pendingCount()).toBe(1);

    frames.flushStableCadence(90);
    expect(result.current).toMatchObject({
      refreshRateHz: 90,
      status: "stable",
    });
    expect(frames.pendingCount()).toBe(0);
  });

  it.each([
    ["fullscreenchange", document],
    ["orientationchange", window],
    ["resize", window],
  ] as const)(
    "%s triggers one finite recalibration window",
    (eventName, eventTarget) => {
      const frames = installFakeAnimationFrames();
      const { result } = renderHook(() => useDisplayCadence());
      frames.flushStableCadence(120);
      const requestsBeforeEvent = frames.requestCount();

      act(() => {
        eventTarget.dispatchEvent(new Event(eventName));
      });
      expect(frames.pendingCount()).toBe(1);
      frames.flushStableCadence(120);

      expect(result.current).toMatchObject({
        refreshRateHz: 120,
        status: "stable",
      });
      expect(frames.requestCount() - requestsBeforeEvent).toBe(
        DISPLAY_CADENCE_SAMPLE_COUNT + 1,
      );
      expect(frames.pendingCount()).toBe(0);
    },
  );

  it("installs the 60-second recalibration only while active", () => {
    vi.useFakeTimers();
    const frames = installFakeAnimationFrames();
    const intervalSpy = vi.spyOn(window, "setInterval");
    const inactive = renderHook(() => useDisplayCadence({ active: false }));

    expect(intervalSpy).not.toHaveBeenCalled();
    frames.flushStableCadence();
    inactive.unmount();

    intervalSpy.mockClear();
    const active = renderHook(() => useDisplayCadence({ active: true }));
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    frames.flushStableCadence();
    expect(frames.pendingCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(frames.pendingCount()).toBe(1);
    frames.flushStableCadence();
    expect(frames.pendingCount()).toBe(0);
    active.unmount();
  });
});
