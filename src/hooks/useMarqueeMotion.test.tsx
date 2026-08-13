import { act, render } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "../domain/defaults";
import {
  calculateMarqueeGeometry,
  interpolatePlaybackRate,
  MARQUEE_COPY_GAP_RATIO,
  remapMarqueeProgress,
  snapMarqueeCrossAxis,
  speedToPixelsPerSecond,
  useMarqueeMotion,
} from "./useMarqueeMotion";

function MotionHarness({
  direction = "left",
  paused = false,
  speed,
}: {
  direction?: "left" | "right" | "up" | "down";
  paused?: boolean;
  speed: number;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const movingRef = useRef<HTMLDivElement>(null);
  const primaryCopyRef = useRef<HTMLDivElement>(null);
  const secondaryCopyRef = useRef<HTMLDivElement>(null);
  useMarqueeMotion({
    animationKey: "page-1",
    direction,
    enabled: true,
    fontSize: 80,
    movingRef,
    primaryCopyRef,
    secondaryCopyRef,
    paused,
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

  it("eases playback-rate changes without overshooting", () => {
    expect(interpolatePlaybackRate(1, 5, 0)).toBe(1);
    expect(interpolatePlaybackRate(1, 5, 0.5)).toBeGreaterThan(3);
    expect(interpolatePlaybackRate(1, 5, 1)).toBe(5);
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
    animations.forEach((animation) => {
      expect(animation.updatePlaybackRate).toHaveBeenCalledWith(
        speedToPixelsPerSecond(5) / 100,
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

    act(() => flushFrames(performance.now() + 200));
    animations.forEach((animation, index) => {
      expect(animation.updatePlaybackRate).toHaveBeenLastCalledWith(
        speedToPixelsPerSecond(40) / 100,
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
});
