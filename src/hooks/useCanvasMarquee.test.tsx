import { render } from "@testing-library/preact";
import type { RefObject } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasMarquee } from "../components/CanvasMarquee";
import {
  CANVAS_MAX_BACKING_PIXELS,
  resolveCanvasBackingScale,
  resolveCanvasMarqueeProgress,
  type CanvasMarqueeController,
} from "./useCanvasMarquee";

interface FakeCanvasContext {
  clearRect: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  fillStyle: string;
  fillText: ReturnType<typeof vi.fn>;
  font: string;
  measureText: ReturnType<typeof vi.fn>;
  scale: ReturnType<typeof vi.fn>;
  setTransform: ReturnType<typeof vi.fn>;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  translate: ReturnType<typeof vi.fn>;
}

function createFakeContext(): FakeCanvasContext {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    fillStyle: "#000000",
    fillText: vi.fn(),
    font: "10px sans-serif",
    measureText: vi.fn((text: string) => ({
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: text.length * 10,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2,
      width: text.length * 10,
    }) as TextMetrics),
    scale: vi.fn(),
    setTransform: vi.fn(),
    textAlign: "left",
    textBaseline: "alphabetic",
    translate: vi.fn(),
  };
}

function installCanvasMock() {
  const measurement = createFakeContext();
  const bitmap = createFakeContext();
  const visible = createFakeContext();
  let detachedContextCount = 0;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    function (this: HTMLCanvasElement, contextId: string) {
      if (contextId !== "2d") return null;
      if (this.classList.contains("canvas-marquee-surface")) {
        return visible as unknown as CanvasRenderingContext2D;
      }
      detachedContextCount += 1;
      return (detachedContextCount === 1 ? measurement : bitmap) as unknown as
        CanvasRenderingContext2D;
    } as typeof HTMLCanvasElement.prototype.getContext,
  );
  return { bitmap, measurement, visible };
}

function installAnimationFrames() {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation(
    (callback) => {
      const id = nextId;
      nextId += 1;
      frames.set(id, callback);
      return id;
    },
  );
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  return {
    flush(timestamp: number) {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(timestamp);
    },
    pending: () => frames.size,
  };
}

function renderCanvasMarquee(
  overrides: Partial<Parameters<typeof CanvasMarquee>[0]> = {},
) {
  const controllerRef = {
    current: null,
  } as unknown as RefObject<CanvasMarqueeController>;
  const props: Parameters<typeof CanvasMarquee>[0] = {
    animationKey: "page-1",
    color: "#1a1a1e",
    controllerRef,
    direction: "left",
    flashEnabled: false,
    fontFamily: "system-sans",
    fontSize: 80,
    fontWeight: 900,
    mirrored: false,
    paused: false,
    speed: 5,
    text: "Message",
    textAlign: "center",
    ...overrides,
  };
  const view = render(<CanvasMarquee {...props} />);
  const host = view.container.querySelector<HTMLElement>(
    ".canvas-marquee-host",
  );
  if (!host) throw new Error("Canvas marquee host was not rendered");
  Object.defineProperty(host, "clientWidth", {
    configurable: true,
    value: 800,
  });
  Object.defineProperty(host, "clientHeight", {
    configurable: true,
    value: 600,
  });
  return { controllerRef, props, view };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("canvas marquee math", () => {
  it("uses wall-clock timestamps instead of accumulating frame deltas", () => {
    expect(resolveCanvasMarqueeProgress(0, 1_000, 3_500, 100, 1_000))
      .toBeCloseTo(0.25, 8);
    expect(resolveCanvasMarqueeProgress(0.9, 1_000, 3_000, 100, 1_000))
      .toBeCloseTo(0.1, 8);
  });

  it("caps visible and cached bitmap backing stores by physical area", () => {
    const width = 16_384;
    const height = 500;
    const scale = resolveCanvasBackingScale(
      width,
      height,
      3,
      CANVAS_MAX_BACKING_PIXELS,
      16_384,
    );
    const backingWidth = Math.floor(width * scale);
    const backingHeight = Math.floor(height * scale);

    expect(scale).toBeLessThan(1);
    expect(backingWidth).toBeLessThanOrEqual(16_384);
    expect(backingWidth * backingHeight).toBeLessThanOrEqual(
      CANVAS_MAX_BACKING_PIXELS,
    );
  });
});

describe("CanvasMarquee", () => {
  it.each([
    ["left", "x", -1],
    ["right", "x", 1],
    ["up", "y", -1],
    ["down", "y", 1],
  ] as const)(
    "draws two %s copies separated by the content and half-screen gap",
    (direction, axis, sign) => {
      const contexts = installCanvasMock();
      const frames = installAnimationFrames();
      vi.spyOn(performance, "now").mockReturnValue(1_000);
      renderCanvasMarquee({ direction });

      frames.flush(1_000);

      const [primary, secondary] = contexts.visible.drawImage.mock.calls;
      const coordinateIndex = axis === "x" ? 5 : 6;
      const extentIndex = axis === "x" ? 7 : 8;
      const viewportExtent = axis === "x" ? 800 : 600;
      const primaryCoordinate = primary[coordinateIndex] as number;
      const secondaryCoordinate = secondary[coordinateIndex] as number;
      const contentExtent = primary[extentIndex] as number;
      expect((secondaryCoordinate - primaryCoordinate) * sign).toBeCloseTo(
        contentExtent + viewportExtent * 0.5,
        5,
      );
    },
  );

  it("keeps the steady frame to one clear and two cached bitmap draws", () => {
    const contexts = installCanvasMock();
    const frames = installAnimationFrames();
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    renderCanvasMarquee();

    frames.flush(1_000);
    contexts.visible.clearRect.mockClear();
    contexts.visible.drawImage.mockClear();
    const measurementsAfterBuild = contexts.measurement.measureText.mock.calls.length;
    const createElement = vi.spyOn(document, "createElement");

    frames.flush(1_016);

    expect(contexts.visible.clearRect).toHaveBeenCalledTimes(1);
    expect(contexts.visible.drawImage).toHaveBeenCalledTimes(2);
    expect(contexts.measurement.measureText).toHaveBeenCalledTimes(
      measurementsAfterBuild,
    );
    expect(createElement).not.toHaveBeenCalled();
    expect(frames.pending()).toBe(1);
  });

  it("coalesces live speed changes into the next animation frame without a jump", () => {
    const contexts = installCanvasMock();
    const frames = installAnimationFrames();
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    const { controllerRef } = renderCanvasMarquee();
    frames.flush(1_000);

    contexts.visible.drawImage.mockClear();
    frames.flush(1_016);
    const before = contexts.visible.drawImage.mock.calls[0][5] as number;
    contexts.visible.drawImage.mockClear();
    controllerRef.current?.previewSpeed(40);
    frames.flush(1_032);
    const afterSwitch = contexts.visible.drawImage.mock.calls[0][5] as number;
    contexts.visible.drawImage.mockClear();
    frames.flush(1_048);
    const afterFastFrame = contexts.visible.drawImage.mock.calls[0][5] as number;

    expect(Math.abs(afterSwitch - before)).toBeLessThan(2);
    expect(Math.abs(afterFastFrame - afterSwitch)).toBeGreaterThan(
      Math.abs(afterSwitch - before) * 4,
    );
  });

  it("stops requesting frames while paused and pauses the flash class", () => {
    const contexts = installCanvasMock();
    const frames = installAnimationFrames();
    let now = 1_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const { controllerRef, props, view } = renderCanvasMarquee({ flashEnabled: true });
    frames.flush(1_000);
    expect(frames.pending()).toBe(1);

    now = 1_016;
    contexts.visible.drawImage.mockClear();
    view.rerender(<CanvasMarquee {...props} paused />);
    const pausedX = contexts.visible.drawImage.mock.calls[0][5] as number;

    expect(frames.pending()).toBe(0);
    const host = view.container.querySelector(".canvas-marquee-host");
    expect(host?.classList.contains("is-flashing")).toBe(true);
    expect(host?.classList.contains("is-paused")).toBe(true);
    expect(contexts.visible.drawImage).toHaveBeenCalled();

    now = 3_016;
    contexts.visible.drawImage.mockClear();
    controllerRef.current?.previewSpeed(40);
    const speedChangedWhilePausedX = contexts.visible.drawImage.mock.calls[0][5] as number;
    expect(speedChangedWhilePausedX).toBeCloseTo(pausedX, 5);

    now = 5_016;
    view.rerender(<CanvasMarquee {...props} paused={false} />);
    contexts.visible.drawImage.mockClear();
    frames.flush(5_016);
    const resumedX = contexts.visible.drawImage.mock.calls[0][5] as number;
    expect(resumedX).toBeCloseTo(pausedX, 5);
  });

  it("rasterizes mirror once and keeps the canvas out of the accessibility tree", () => {
    const contexts = installCanvasMock();
    const frames = installAnimationFrames();
    vi.spyOn(performance, "now").mockReturnValue(1_000);
    const { view } = renderCanvasMarquee({ mirrored: true });
    frames.flush(1_000);

    expect(contexts.bitmap.scale).toHaveBeenCalledWith(-1, 1);
    expect(view.getByTestId("canvas-marquee").getAttribute("aria-hidden"))
      .toBe("true");
    expect(view.container.textContent).not.toContain("Message");
  });
});
