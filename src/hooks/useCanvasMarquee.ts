import type { RefObject } from "preact";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "preact/hooks";

import type {
  FontFamily,
  FontWeight,
  MarqueeDirection,
  TextAlign,
} from "../domain/types";
import {
  calculateMarqueeGeometry,
  remapMarqueeProgress,
  speedToPixelsPerSecond,
  type MarqueeGeometry,
} from "./useMarqueeMotion";

export const CANVAS_MAX_BACKING_PIXELS = 8_000_000;
export const CANVAS_MAX_VISIBLE_DIMENSION = 8_192;
export const CANVAS_MAX_BITMAP_DIMENSION = 16_384;

export const CANVAS_FONT_STACKS: Readonly<Record<FontFamily, string>> = {
  "system-sans":
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif',
  "system-rounded":
    'ui-rounded, "SF Pro Rounded", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',
  "system-serif":
    'ui-serif, "Songti TC", "PMingLiU", "Noto Serif CJK TC", Georgia, serif',
  "system-mono":
    'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

export interface CanvasMarqueeController {
  /** Update the live preview without committing workspace state. */
  previewSpeed: (speed: number) => void;
}

export interface UseCanvasMarqueeOptions {
  animationKey: string;
  canvasRef: RefObject<HTMLCanvasElement>;
  color: string;
  controllerRef?: RefObject<CanvasMarqueeController>;
  direction: MarqueeDirection;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  hostRef: RefObject<HTMLElement>;
  mirrored: boolean;
  paused: boolean;
  speed: number;
  text: string;
  textAlign: TextAlign;
}

interface CanvasTextLayout {
  contentHeight: number;
  contentWidth: number;
  lines: string[];
  lineHeight: number;
  padding: number;
}

interface CanvasMarqueeRuntime {
  activePixelsPerSecond: number;
  animationFrame: number | null;
  animationKey: string;
  bitmap: HTMLCanvasElement | null;
  bitmapContext: CanvasRenderingContext2D | null;
  canvas: HTMLCanvasElement | null;
  canvasContext: CanvasRenderingContext2D | null;
  canvasScale: number;
  contentHeight: number;
  contentWidth: number;
  direction: MarqueeDirection;
  epochProgress: number;
  epochTime: number;
  geometry: MarqueeGeometry | null;
  measurementCanvas: HTMLCanvasElement | null;
  measurementContext: CanvasRenderingContext2D | null;
  paused: boolean;
  rebuildFrame: number | null;
  targetPixelsPerSecond: number;
}

function createRuntime(speed: number, paused: boolean): CanvasMarqueeRuntime {
  const pixelsPerSecond = speedToPixelsPerSecond(speed);
  return {
    activePixelsPerSecond: pixelsPerSecond,
    animationFrame: null,
    animationKey: "",
    bitmap: null,
    bitmapContext: null,
    canvas: null,
    canvasContext: null,
    canvasScale: 1,
    contentHeight: 1,
    contentWidth: 1,
    direction: "left",
    epochProgress: 0,
    epochTime: 0,
    geometry: null,
    measurementCanvas: null,
    measurementContext: null,
    paused,
    rebuildFrame: null,
    targetPixelsPerSecond: pixelsPerSecond,
  };
}

function normalizeProgress(progress: number): number {
  return ((progress % 1) + 1) % 1;
}

/**
 * Resolve motion from the rAF timestamp instead of accumulating frame deltas.
 * A delayed frame therefore lands at the correct wall-clock position without
 * running a catch-up loop.
 */
export function resolveCanvasMarqueeProgress(
  epochProgress: number,
  epochTime: number,
  timestamp: number,
  pixelsPerSecond: number,
  distance: number,
): number {
  if (!Number.isFinite(distance) || distance <= 0) {
    return normalizeProgress(epochProgress);
  }
  const elapsed = Math.max(0, timestamp - epochTime);
  return normalizeProgress(
    epochProgress + (elapsed * pixelsPerSecond) / (distance * 1_000),
  );
}

/**
 * Fit a canvas backing store inside both area and dimension budgets. This may
 * intentionally use less than one backing pixel per CSS pixel on extreme
 * displays so the GPU allocation can never exceed the declared limits.
 */
export function resolveCanvasBackingScale(
  cssWidth: number,
  cssHeight: number,
  requestedScale: number,
  maximumPixels: number = CANVAS_MAX_BACKING_PIXELS,
  maximumDimension: number = CANVAS_MAX_VISIBLE_DIMENSION,
): number {
  const width = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
  const height = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
  const scale = Math.max(
    0.0001,
    Number.isFinite(requestedScale) ? requestedScale : 1,
  );
  const byArea = Math.sqrt(Math.max(1, maximumPixels) / (width * height));
  const byDimension = Math.max(1, maximumDimension) / Math.max(width, height);
  return Math.max(0.0001, Math.min(scale, byArea, byDimension));
}

function fontDeclaration(
  fontSize: number,
  fontWeight: FontWeight,
  fontFamily: FontFamily,
): string {
  return `${fontWeight} ${fontSize}px ${CANVAS_FONT_STACKS[fontFamily]}`;
}

function wrapCanvasLines(
  context: CanvasRenderingContext2D,
  text: string,
  maximumWidth: number,
): string[] {
  const paragraphs = text.split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (
        current.length > 0 &&
        context.measureText(candidate).width > maximumWidth
      ) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function createTextLayout(
  context: CanvasRenderingContext2D,
  text: string,
  direction: MarqueeDirection,
  viewportWidth: number,
  fontSize: number,
): CanvasTextLayout {
  const lineHeight = Math.max(1, fontSize * 1.06);
  const padding = Math.max(2, fontSize * 0.08);
  const horizontal = direction === "left" || direction === "right";
  const maximumLineWidth = Math.max(1, viewportWidth - padding * 2);
  const lines = horizontal
    ? text.split("\n")
    : wrapCanvasLines(context, text, maximumLineWidth);
  const nonEmptyLines = lines.length > 0 ? lines : [""];
  let measuredWidth = 1;
  for (const line of nonEmptyLines) {
    measuredWidth = Math.max(measuredWidth, context.measureText(line).width);
  }

  return {
    contentHeight: Math.max(1, nonEmptyLines.length * lineHeight + padding * 2),
    contentWidth: horizontal
      ? Math.max(1, measuredWidth + padding * 2)
      : Math.max(1, viewportWidth),
    lines: nonEmptyLines,
    lineHeight,
    padding,
  };
}

function ensureCanvasContexts(runtime: CanvasMarqueeRuntime): boolean {
  if (!runtime.measurementCanvas) {
    runtime.measurementCanvas = document.createElement("canvas");
    runtime.measurementContext = runtime.measurementCanvas.getContext("2d");
  }
  if (!runtime.bitmap) {
    runtime.bitmap = document.createElement("canvas");
    runtime.bitmapContext = runtime.bitmap.getContext("2d");
  }
  if (runtime.canvas && !runtime.canvasContext) {
    runtime.canvasContext = runtime.canvas.getContext("2d");
  }
  return Boolean(
    runtime.measurementContext &&
      runtime.bitmap &&
      runtime.bitmapContext &&
      runtime.canvasContext,
  );
}

function alignX(
  alignment: TextAlign,
  contentWidth: number,
  padding: number,
): number {
  if (alignment === "center") return contentWidth / 2;
  if (alignment === "right") return contentWidth - padding;
  return padding;
}

function rasterizeTextBitmap(
  runtime: CanvasMarqueeRuntime,
  layout: CanvasTextLayout,
  color: string,
  font: string,
  mirrored: boolean,
  textAlign: TextAlign,
  requestedScale: number,
): boolean {
  const bitmap = runtime.bitmap;
  const context = runtime.bitmapContext;
  if (!bitmap || !context) return false;

  const scale = resolveCanvasBackingScale(
    layout.contentWidth,
    layout.contentHeight,
    requestedScale,
    CANVAS_MAX_BACKING_PIXELS,
    CANVAS_MAX_BITMAP_DIMENSION,
  );
  bitmap.width = Math.max(1, Math.floor(layout.contentWidth * scale));
  bitmap.height = Math.max(1, Math.floor(layout.contentHeight * scale));
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, layout.contentWidth, layout.contentHeight);
  context.fillStyle = color;
  context.font = font;
  context.textAlign = textAlign;
  context.textBaseline = "top";
  if (mirrored) {
    context.translate(layout.contentWidth, 0);
    context.scale(-1, 1);
  }

  const x = alignX(textAlign, layout.contentWidth, layout.padding);
  const lineOffset = Math.max(
    0,
    (layout.lineHeight - layout.lineHeight / 1.06) / 2,
  );
  for (let index = 0; index < layout.lines.length; index += 1) {
    context.fillText(
      layout.lines[index],
      x,
      layout.padding + index * layout.lineHeight + lineOffset,
    );
  }
  return true;
}

function progressAt(runtime: CanvasMarqueeRuntime, timestamp: number): number {
  const geometry = runtime.geometry;
  if (!geometry || runtime.paused) return runtime.epochProgress;
  return resolveCanvasMarqueeProgress(
    runtime.epochProgress,
    runtime.epochTime,
    timestamp,
    runtime.activePixelsPerSecond,
    geometry.distance,
  );
}

function synchronizeSpeed(
  runtime: CanvasMarqueeRuntime,
  timestamp: number,
): void {
  if (
    Math.abs(
      runtime.activePixelsPerSecond - runtime.targetPixelsPerSecond,
    ) < 0.0001
  ) {
    return;
  }
  runtime.epochProgress = progressAt(runtime, timestamp);
  runtime.epochTime = timestamp;
  runtime.activePixelsPerSecond = runtime.targetPixelsPerSecond;
}

/** The steady-state render path: no DOM reads and no application allocations. */
function paintCanvasFrame(
  runtime: CanvasMarqueeRuntime,
  timestamp: number,
): void {
  const canvas = runtime.canvas;
  const context = runtime.canvasContext;
  const bitmap = runtime.bitmap;
  const geometry = runtime.geometry;
  if (!canvas || !context || !bitmap || !geometry) return;

  synchronizeSpeed(runtime, timestamp);
  const primaryProgress = progressAt(runtime, timestamp);
  const secondaryProgress =
    primaryProgress >= 0.5 ? primaryProgress - 0.5 : primaryProgress + 0.5;
  const primaryX =
    geometry.startX + (geometry.endX - geometry.startX) * primaryProgress;
  const primaryY =
    geometry.startY + (geometry.endY - geometry.startY) * primaryProgress;
  const secondaryX =
    geometry.startX + (geometry.endX - geometry.startX) * secondaryProgress;
  const secondaryY =
    geometry.startY + (geometry.endY - geometry.startY) * secondaryProgress;

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(
    runtime.canvasScale,
    0,
    0,
    runtime.canvasScale,
    0,
    0,
  );
  context.drawImage(
    bitmap,
    0,
    0,
    bitmap.width,
    bitmap.height,
    primaryX,
    primaryY,
    runtime.contentWidth,
    runtime.contentHeight,
  );
  context.drawImage(
    bitmap,
    0,
    0,
    bitmap.width,
    bitmap.height,
    secondaryX,
    secondaryY,
    runtime.contentWidth,
    runtime.contentHeight,
  );
}

export function useCanvasMarquee({
  animationKey,
  canvasRef,
  color,
  controllerRef,
  direction,
  fontFamily,
  fontSize,
  fontWeight,
  hostRef,
  mirrored,
  paused,
  speed,
  text,
  textAlign,
}: UseCanvasMarqueeOptions): void {
  const runtimeRef = useRef<CanvasMarqueeRuntime>(
    createRuntime(speed, paused),
  );
  const fallbackControllerRef = useRef<CanvasMarqueeController>(null);
  const animationCallbackRef = useRef<FrameRequestCallback>(() => undefined);

  const cancelAnimation = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.animationFrame !== null) {
      cancelAnimationFrame(runtime.animationFrame);
      runtime.animationFrame = null;
    }
  }, []);

  const drawAnimationFrame = useCallback((timestamp: number) => {
    const runtime = runtimeRef.current;
    runtime.animationFrame = null;
    if (runtime.paused || !runtime.geometry) return;
    paintCanvasFrame(runtime, timestamp);
    runtime.animationFrame = requestAnimationFrame(
      animationCallbackRef.current,
    );
  }, []);

  useLayoutEffect(() => {
    animationCallbackRef.current = drawAnimationFrame;
  }, [drawAnimationFrame]);

  const ensureAnimation = useCallback(() => {
    const runtime = runtimeRef.current;
    if (
      runtime.paused ||
      !runtime.geometry ||
      runtime.animationFrame !== null
    ) {
      return;
    }
    runtime.animationFrame = requestAnimationFrame(drawAnimationFrame);
  }, [drawAnimationFrame]);

  const previewSpeed = useCallback((nextSpeed: number) => {
    const runtime = runtimeRef.current;
    runtime.targetPixelsPerSecond = speedToPixelsPerSecond(nextSpeed);
    if (runtime.paused && runtime.geometry) {
      const timestamp = performance.now();
      synchronizeSpeed(runtime, timestamp);
      paintCanvasFrame(runtime, timestamp);
    }
  }, []);

  useImperativeHandle(
    controllerRef ?? fallbackControllerRef,
    () => ({ previewSpeed }),
    [previewSpeed],
  );

  const rebuild = useCallback(() => {
    const runtime = runtimeRef.current;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    runtime.canvas = canvas;
    if (!ensureCanvasContexts(runtime)) return;

    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const requestedScale = window.devicePixelRatio || 1;
    const canvasScale = resolveCanvasBackingScale(
      width,
      height,
      requestedScale,
    );
    canvas.width = Math.max(1, Math.floor(width * canvasScale));
    canvas.height = Math.max(1, Math.floor(height * canvasScale));
    runtime.canvasScale = canvasScale;

    const font = fontDeclaration(fontSize, fontWeight, fontFamily);
    const measurementContext = runtime.measurementContext;
    if (!measurementContext) return;
    measurementContext.font = font;
    const layout = createTextLayout(
      measurementContext,
      text,
      direction,
      width,
      fontSize,
    );
    if (
      !rasterizeTextBitmap(
        runtime,
        layout,
        color,
        font,
        mirrored,
        textAlign,
        requestedScale,
      )
    ) {
      return;
    }

    const timestamp = performance.now();
    synchronizeSpeed(runtime, timestamp);
    const previousGeometry = runtime.geometry;
    const previousProgress = progressAt(runtime, timestamp);
    const nextGeometry = calculateMarqueeGeometry(
      direction,
      width,
      height,
      layout.contentWidth,
      layout.contentHeight,
    );
    const sameAnimation =
      runtime.animationKey === animationKey &&
      previousGeometry?.direction === nextGeometry.direction;
    runtime.epochProgress =
      sameAnimation && previousGeometry
        ? remapMarqueeProgress(
            previousProgress,
            previousGeometry,
            nextGeometry,
          )
        : 0;
    runtime.epochTime = timestamp;
    runtime.geometry = nextGeometry;
    runtime.direction = direction;
    runtime.animationKey = animationKey;
    runtime.contentWidth = layout.contentWidth;
    runtime.contentHeight = layout.contentHeight;
    paintCanvasFrame(runtime, timestamp);
    ensureAnimation();
  }, [
    animationKey,
    canvasRef,
    color,
    direction,
    ensureAnimation,
    fontFamily,
    fontSize,
    fontWeight,
    hostRef,
    mirrored,
    text,
    textAlign,
  ]);

  const scheduleRebuild = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.rebuildFrame !== null) return;
    runtime.rebuildFrame = requestAnimationFrame(() => {
      runtime.rebuildFrame = null;
      rebuild();
    });
  }, [rebuild]);

  useLayoutEffect(() => {
    scheduleRebuild();
    const observer = new ResizeObserver(scheduleRebuild);
    if (hostRef.current) observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [hostRef, scheduleRebuild]);

  useLayoutEffect(() => {
    previewSpeed(speed);
  }, [previewSpeed, speed]);

  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime.paused === paused) return;
    const timestamp = performance.now();
    synchronizeSpeed(runtime, timestamp);
    runtime.epochProgress = progressAt(runtime, timestamp);
    runtime.epochTime = timestamp;
    runtime.paused = paused;
    if (paused) {
      cancelAnimation();
      paintCanvasFrame(runtime, timestamp);
    } else {
      ensureAnimation();
    }
  }, [cancelAnimation, ensureAnimation, paused]);

  useLayoutEffect(
    () => () => {
      const runtime = runtimeRef.current;
      cancelAnimation();
      if (runtime.rebuildFrame !== null) {
        cancelAnimationFrame(runtime.rebuildFrame);
        runtime.rebuildFrame = null;
      }
      runtime.geometry = null;
      runtime.canvas = null;
      runtime.canvasContext = null;
    },
    [cancelAnimation],
  );
}
