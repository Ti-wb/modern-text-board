import { act, render } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "../domain/defaults";
import {
  calculateMarqueeGeometry,
  followPlaybackRate,
  MARQUEE_BASE_PIXELS_PER_SECOND,
  MARQUEE_COPY_GAP_RATIO,
  remapMarqueeProgress,
  resolveAdaptiveMarqueeSpeed,
  snapMarqueeCrossAxis,
  speedToPixelsPerSecond,
  useMarqueeMotion,
} from "./useMarqueeMotion";

function MotionHarness({
  direction = "left",
  devicePixelRatio = 1,
  paused = false,
  refreshRateHz = 60,
  speed,
}: {
  direction?: "left" | "right" | "up" | "down";
  devicePixelRatio?: number;
  paused?: boolean;
  refreshRateHz?: number;
  speed: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const movingRef = useRef<HTMLDivElement>(null);
  const primaryCopyRef = useRef<HTMLDivElement>(null);
  const secondaryCopyRef = useRef<HTMLDivElement>(null);
  useMarqueeMotion({
    animationKey: "page-1",
    direction,
    devicePixelRatio,
    enabled: true,
    fontSize: 80,
    movingRef,
    primaryCopyRef,
    secondaryCopyRef,
    paused,
    refreshRateHz,
    speed,
    viewportRef,
  });
  return (
    <div data-testid="viewport" ref={viewportRef}>
      <div data-testid="moving" ref={movingRef}>
        <div ref={primaryCopyRef}>Message</div>
        <div ref={secondaryCopyRef}>Message</div>
      </div>
    </div>
  );
}

describe("marquee motion math", () => {
  it("preserves legacy speeds while extending the range beyond 600 px/s", () => {
    expect(speedToPixelsPerSecond(1)).toBe(24);
    expect(speedToPixelsPerSecond(10)).toBe(160);
    expect(speedToPixelsPerSecond(5)).toBeCloseTo(84.44, 2);
    expect(speedToPixelsPerSecond(12.5)).toBeGreaterThan(
      speedToPixelsPerSecond(12.4),
    );
    expect(speedToPixelsPerSecond(LIMITS.maxMarqueeSpeed)).toBeGreaterThan(600);
  });

  it.each([
    [59.94, 1, 610.63875],
    [60, 1, 611.25],
    [90, 1, 613.125],
    [120, 1, 607.5],
    [144, 1, 612],
    [60, 2, 613.125],
    [120, 2, 611.25],
    [120, 3, 612.5],
  ])(
    "adapts maximum speed to %sHz at DPR %s",
    (refreshRateHz, devicePixelRatio, expectedSpeed) => {
      const adaptive = resolveAdaptiveMarqueeSpeed(
        speedToPixelsPerSecond(40),
        refreshRateHz,
        devicePixelRatio,
      );
      expect(adaptive.effectivePixelsPerSecond).toBeCloseTo(expectedSpeed, 4);
      expect(adaptive.effectivePixelsPerSecond).toBeLessThanOrEqual(
        speedToPixelsPerSecond(40),
      );
      expect(adaptive.cssPixelsPerFrame).toBeLessThanOrEqual(12);
      expect(adaptive.devicePixelsPerFrame).toBeCloseTo(
        adaptive.cssPixelsPerFrame * devicePixelRatio,
        5,
      );
    },
  );

  it("rejects sixteenth-device-pixel alignment when it loses over three percent", () => {
    const adaptive = resolveAdaptiveMarqueeSpeed(24, 60, 1);
    expect(adaptive.effectivePixelsPerSecond).toBe(24);
    expect(adaptive.devicePixelsPerFrame).toBeCloseTo(0.4, 5);
  });

  it("accepts pixel alignment at the three-percent boundary and rejects it above", () => {
    const accepted = resolveAdaptiveMarqueeSpeed(1.0308 * 60, 60, 1);
    const rejected = resolveAdaptiveMarqueeSpeed(1.031 * 60, 60, 1);
    expect(accepted.devicePixelsPerFrame).toBe(1);
    expect(rejected.devicePixelsPerFrame).toBeCloseTo(1.031, 5);
  });

  it("falls back safely for invalid cadence and DPR inputs", () => {
    const adaptive = resolveAdaptiveMarqueeSpeed(700, Number.NaN, 0);
    expect(adaptive.effectivePixelsPerSecond).toBe(697.5);
    expect(adaptive.cssPixelsPerFrame).toBe(11.625);
    expect(adaptive.devicePixelsPerFrame).toBe(11.625);
  });

  it.each([
    ["left", 800, 250, -400, 250, 1200, 600, 400],
    ["right", -200, 250, 1000, 250, 1200, 600, 400],
    ["up", 300, 600, 300, -200, 800, 400, 300],
    ["down", 300, -100, 300, 700, 800, 400, 300],
  ] as const)(
    "calculates two independently composited %s copies with a half-screen gap",
    (
      direction,
      startX,
      startY,
      endX,
      endY,
      distance,
      cycleDistance,
      copyGap,
    ) => {
      expect(
        calculateMarqueeGeometry(direction, 800, 600, 200, 100),
      ).toMatchObject({
        startX,
        startY,
        endX,
        endY,
        distance,
        cycleDistance,
        copyGap,
      });
    },
  );

  it.each(["left", "right", "up", "down"] as const)(
    "keeps the visible %s pixels unchanged when either copy resets",
    (direction) => {
      const viewportWidth = 800;
      const viewportHeight = 600;
      const contentWidth = 200;
      const contentHeight = 100;
      const geometry = calculateMarqueeGeometry(
        direction,
        viewportWidth,
        viewportHeight,
        contentWidth,
        contentHeight,
      );
      const horizontal = direction === "left" || direction === "right";
      const viewportAxis = horizontal ? viewportWidth : viewportHeight;
      const contentAxis = horizontal ? contentWidth : contentHeight;
      const gap = viewportAxis * MARQUEE_COPY_GAP_RATIO;
      const start = horizontal ? geometry.startX : geometry.startY;
      const end = horizontal ? geometry.endX : geometry.endY;
      const positionAt = (progress: number) =>
        start + (end - start) * progress;
      const positionsAt = (progress: number) =>
        [progress % 1, (progress + 0.5) % 1]
          .map(positionAt)
          .sort((left, right) => left - right);
      const visibleAt = (progress: number) =>
        positionsAt(progress).filter(
          (position) =>
            position < viewportAxis && position + contentAxis > 0,
        );

      expect(geometry.copyGap).toBe(gap);
      expect(geometry.cycleDistance).toBe(contentAxis + gap);
      expect(geometry.distance).toBe(geometry.cycleDistance * 2);
      expect(positionsAt(0.5)).toEqual(positionsAt(0));

      const overlapProgress = gap / 2 / geometry.distance;
      const overlapping = visibleAt(overlapProgress);
      expect(overlapping).toHaveLength(2);
      expect(overlapping[1] - (overlapping[0] + contentAxis)).toBe(gap);
    },
  );

  it("follows a changing playback-rate target without overshooting", () => {
    expect(followPlaybackRate(1, 5, 0)).toBe(1);
    expect(followPlaybackRate(1, 5, 16.67)).toBeGreaterThan(1);
    expect(followPlaybackRate(1, 5, 16.67)).toBeLessThan(5);
    expect(followPlaybackRate(5, 1, 16.67)).toBeGreaterThan(1);
    expect(followPlaybackRate(5, 1, 16.67)).toBeLessThan(5);
  });

  it("preserves the moving-axis screen coordinate across viewport resize", () => {
    const previous = calculateMarqueeGeometry("left", 952, 600, 220, 80);
    const next = calculateMarqueeGeometry("left", 568, 600, 220, 80);
    const previousProgress = 0.4;
    const remapped = remapMarqueeProgress(previousProgress, previous, next);
    const oldX = previous.startX +
      (previous.endX - previous.startX) * previousProgress;
    const newX = next.startX + (next.endX - next.startX) * remapped;

    expect(newX).toBeCloseTo(oldX, 5);
  });

  it("preserves the secondary copy when it is the visible copy during resize", () => {
    const previous = calculateMarqueeGeometry("left", 952, 600, 220, 80);
    const next = calculateMarqueeGeometry("left", 568, 600, 220, 80);
    const primaryProgress = 0.9;
    const previousSecondaryProgress = (primaryProgress + 0.5) % 1;
    const remappedPrimary = remapMarqueeProgress(
      primaryProgress,
      previous,
      next,
    );
    const remappedSecondary = (remappedPrimary + 0.5) % 1;
    const oldX = previous.startX +
      (previous.endX - previous.startX) * previousSecondaryProgress;
    const newX = next.startX +
      (next.endX - next.startX) * remappedSecondary;

    expect(oldX).toBeGreaterThan(0);
    expect(newX).toBeCloseTo(oldX, 5);
  });

  it("snaps only the static cross axis to physical pixels", () => {
    expect(snapMarqueeCrossAxis(123.4, 2)).toBe(123.5);
    expect(snapMarqueeCrossAxis(123.4, 3)).toBeCloseTo(123.333, 3);
  });
});

describe("useMarqueeMotion", () => {
  const originalAnimate = HTMLElement.prototype.animate;

  afterEach(() => {
    if (originalAnimate) {
      Object.defineProperty(HTMLElement.prototype, "animate", {
        configurable: true,
        value: originalAnimate,
        writable: true,
      });
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, "animate");
    }
    vi.restoreAllMocks();
  });

  it("keeps two animation identities and only one rate controller during rapid input", () => {
    let nextFrameId = 1;
    let maxPendingFrames = 0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        maxPendingFrames = Math.max(maxPendingFrames, frames.size);
        return id;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushFrames = (now: number) => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    };

    const animations = [0, 1].map(
      () =>
        ({
          cancel: vi.fn(),
          currentTime: 0,
          pause: vi.fn(),
          play: vi.fn(),
          playbackRate: 1,
          updatePlaybackRate: vi.fn(),
        }) as unknown as Animation,
    );
    let animationIndex = 0;
    const animate = vi.fn(() => animations[animationIndex++]);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
      writable: true,
    });

    const view = render(<MotionHarness speed={5} />);
    act(() => flushFrames(performance.now()));
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animations[0].currentTime).toBe(0);
    expect(animations[1].currentTime).toBeGreaterThan(0);
    const initialAdaptiveRate = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(5),
      60,
      window.devicePixelRatio || 1,
    ).effectivePixelsPerSecond / MARQUEE_BASE_PIXELS_PER_SECOND;
    animations.forEach((animation) => {
      expect(animation.updatePlaybackRate).toHaveBeenCalledWith(
        initialAdaptiveRate,
      );
    });

    const initialTimes = animations.map((animation) => animation.currentTime);
    act(() => {
      for (let speedStep = 51; speedStep <= 400; speedStep += 1) {
        view.rerender(<MotionHarness speed={speedStep / 10} />);
      }
    });
    expect(animate).toHaveBeenCalledTimes(2);
    animations.forEach((animation) =>
      expect(animation.cancel).not.toHaveBeenCalled(),
    );
    expect(maxPendingFrames).toBeLessThanOrEqual(1);

    act(() => {
      let timestamp = performance.now();
      for (let frame = 0; frame < 60 && frames.size > 0; frame += 1) {
        timestamp += 1000 / 60;
        flushFrames(timestamp);
      }
    });
    const effectiveMaximumRate = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(40),
      60,
      window.devicePixelRatio || 1,
    ).effectivePixelsPerSecond / 100;
    animations.forEach((animation, index) => {
      expect(animation.updatePlaybackRate).toHaveBeenLastCalledWith(
        effectiveMaximumRate,
      );
      expect(animation.currentTime).toBe(initialTimes[index]);
    });
    expect(frames.size).toBe(0);

    view.rerender(<MotionHarness paused speed={40} />);
    animations.forEach((animation) =>
      expect(animation.pause).toHaveBeenCalled(),
    );
    view.rerender(<MotionHarness speed={40} />);
    animations.forEach((animation) =>
      expect(animation.play).toHaveBeenCalled(),
    );

    view.unmount();
    expect(frames.size).toBe(0);
  });

  it("changes display cadence through playback rate without rebuilding or moving time", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
      (callback) => {
        const id = nextFrameId++;
        frames.set(id, callback);
        return id;
      },
    );
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
    const flushOneDisplayFrame = (now: number) => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    };

    const animations = [0, 1].map(
      () =>
        ({
          cancel: vi.fn(),
          currentTime: 1_234,
          pause: vi.fn(),
          play: vi.fn(),
          playbackRate: 1,
          updatePlaybackRate: vi.fn(),
        }) as unknown as Animation,
    );
    let animationIndex = 0;
    const animate = vi.fn(() => animations[animationIndex++]);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
      writable: true,
    });

    const view = render(
      <MotionHarness devicePixelRatio={2} refreshRateHz={60} speed={40} />,
    );
    let now = performance.now();
    act(() => flushOneDisplayFrame(now));
    expect(animate).toHaveBeenCalledTimes(2);
    animations[0].currentTime = 1_234;
    animations[1].currentTime = 5_678;
    const timesBeforeCadenceChange = animations.map(
      (animation) => animation.currentTime,
    );

    view.rerender(
      <MotionHarness devicePixelRatio={2} refreshRateHz={120} speed={40} />,
    );
    expect(animate).toHaveBeenCalledTimes(2);
    expect(animations.map((animation) => animation.currentTime)).toEqual(
      timesBeforeCadenceChange,
    );

    act(() => {
      for (let frame = 0; frame < 60 && frames.size > 0; frame += 1) {
        now += 1000 / 120;
        flushOneDisplayFrame(now);
      }
    });
    const expectedRate = resolveAdaptiveMarqueeSpeed(
      speedToPixelsPerSecond(40),
      120,
      2,
    ).effectivePixelsPerSecond / MARQUEE_BASE_PIXELS_PER_SECOND;
    animations.forEach((animation) => {
      expect(animation.cancel).not.toHaveBeenCalled();
      expect(animation.updatePlaybackRate).toHaveBeenLastCalledWith(
        expectedRate,
      );
    });
    view.unmount();
  });
});
