import { act, render } from "@testing-library/preact";
import { useRef } from "preact/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LIMITS } from "../domain/defaults";
import {
  calculateMarqueeGeometry,
  interpolatePlaybackRate,
  MARQUEE_COPY_GAP_RATIO,
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
  const copyRef = useRef<HTMLDivElement>(null);
  useMarqueeMotion({
    animationKey: "page-1",
    direction,
    enabled: true,
    fontSize: 80,
    copyRef,
    movingRef,
    paused,
    speed,
    viewportRef,
  });
  return (
    <div data-testid="viewport" ref={viewportRef}>
      <div data-testid="moving" ref={movingRef}>
        <div>Message</div>
        <div ref={copyRef}>Message</div>
        <div>Message</div>
      </div>
    </div>
  );
}

describe("marquee motion math", () => {
  it("preserves legacy speeds while extending the range beyond 600 px/s", () => {
    expect(speedToPixelsPerSecond(1)).toBe(24);
    expect(speedToPixelsPerSecond(10)).toBe(160);
    expect(speedToPixelsPerSecond(5)).toBeCloseTo(84.44, 2);
    expect(speedToPixelsPerSecond(12.5)).toBeGreaterThan(speedToPixelsPerSecond(12.4));
    expect(speedToPixelsPerSecond(LIMITS.maxMarqueeSpeed)).toBeGreaterThan(600);
  });

  it.each([
    ["left", 500, 0, -100, 0, 600, 400],
    ["right", -500, 0, 100, 0, 600, 400],
    ["up", 0, 350, 0, -50, 400, 300],
    ["down", 0, -350, 0, 50, 400, 300],
  ] as const)(
    "calculates a seamless repeated %s track with a half-screen gap",
    (direction, startX, startY, endX, endY, distance, copyGap) => {
      expect(calculateMarqueeGeometry(direction, 800, 600, 200, 100)).toMatchObject({
        startX,
        startY,
        endX,
        endY,
        distance,
        copyGap,
      });
    },
  );

  it.each(["left", "right", "up", "down"] as const)(
    "keeps the visible %s copy in the same position across an iteration reset",
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
      const cycle = contentAxis + gap;
      const trackAxis = contentAxis * 3 + gap * 2;
      const base = (viewportAxis - trackAxis) / 2;
      const startTransform = horizontal ? geometry.startX : geometry.startY;
      const endTransform = horizontal ? geometry.endX : geometry.endY;
      const positionsAt = (transform: number) =>
        [0, 1, 2].map((index) => base + transform + index * cycle);
      const visibleAt = (transform: number) =>
        positionsAt(transform).filter(
          (position) => position < viewportAxis && position + contentAxis > 0,
        );

      expect(geometry.copyGap).toBe(gap);
      expect(geometry.distance).toBe(cycle);
      expect(
        positionsAt(startTransform)[1] -
          (positionsAt(startTransform)[0] + contentAxis),
      ).toBe(gap);
      expect(visibleAt(endTransform)).toEqual(visibleAt(startTransform));
    },
  );

  it("eases playback-rate changes without overshooting", () => {
    expect(interpolatePlaybackRate(1, 5, 0)).toBe(1);
    expect(interpolatePlaybackRate(1, 5, 0.5)).toBeGreaterThan(3);
    expect(interpolatePlaybackRate(1, 5, 1)).toBe(5);
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

  it("changes speed on the same animation timeline and preserves its current time", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => undefined);

    const animation = {
      cancel: vi.fn(),
      currentTime: 240,
      pause: vi.fn(),
      play: vi.fn(),
      playbackRate: 1,
      updatePlaybackRate: vi.fn(),
    } as unknown as Animation;
    const animate = vi.fn(() => animation);
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: animate,
      writable: true,
    });

    const view = render(<MotionHarness speed={5} />);
    act(() => {
      frames.splice(0).forEach((callback) => callback(performance.now()));
    });
    expect(animate).toHaveBeenCalledOnce();
    expect(animation.updatePlaybackRate).toHaveBeenCalledWith(
      speedToPixelsPerSecond(5) / 100,
    );

    const currentTime = animation.currentTime;
    view.rerender(<MotionHarness speed={37.5} />);
    expect(animate).toHaveBeenCalledOnce();
    expect(animation.cancel).not.toHaveBeenCalled();

    act(() => {
      frames.splice(0).forEach((callback) => callback(performance.now() + 200));
    });
    expect(animation.updatePlaybackRate).toHaveBeenLastCalledWith(
      speedToPixelsPerSecond(37.5) / 100,
    );
    expect(animation.currentTime).toBe(currentTime);

    view.rerender(<MotionHarness paused speed={37.5} />);
    expect(animation.pause).toHaveBeenCalledOnce();
    view.rerender(<MotionHarness speed={37.5} />);
    expect(animation.play).toHaveBeenCalledOnce();
  });
});
