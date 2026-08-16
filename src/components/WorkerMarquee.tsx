import type { RefObject } from "preact";
import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "preact/hooks";

import type {
  FontFamily,
  FontWeight,
  MarqueeDirection,
  TextAlign,
} from "../domain/types";
import {
  CANVAS_FONT_STACKS,
  CANVAS_MAX_BACKING_PIXELS,
  CANVAS_MAX_BITMAP_DIMENSION,
  CANVAS_MAX_VISIBLE_DIMENSION,
  resolveCanvasBackingScale,
} from "../hooks/useCanvasMarquee";
import {
  calculateMarqueeGeometry,
  resolveAdaptiveMarqueeSpeed,
  speedToPixelsPerSecond,
  type MarqueeMotionController,
} from "../hooks/useMarqueeMotion";
import { CanvasMarquee } from "./CanvasMarquee";

interface WorkerMarqueeProps {
  animationKey: string;
  className?: string;
  color: string;
  controllerRef?: RefObject<MarqueeMotionController>;
  devicePixelRatio: number;
  direction: MarqueeDirection;
  flashEnabled: boolean;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  mirrored: boolean;
  paused: boolean;
  refreshRateHz: number;
  speed: number;
  text: string;
  textAlign: TextAlign;
}

interface TextRaster {
  bitmap: ImageBitmap;
  contentHeight: number;
  contentWidth: number;
}

interface WorkerRuntime {
  rebuildFrame: number | null;
  rebuildRevision: number;
  settleTimer: number | null;
  worker: Worker | null;
}

const RESIZE_SETTLE_MS = 80;

function supportsWorkerCanvas(): boolean {
  return (
    typeof Worker === "function" &&
    typeof HTMLCanvasElement !== "undefined" &&
    "transferControlToOffscreen" in HTMLCanvasElement.prototype &&
    typeof createImageBitmap === "function"
  );
}

function fontDeclaration(
  fontSize: number,
  fontWeight: FontWeight,
  fontFamily: FontFamily,
): string {
  return `${fontWeight} ${fontSize}px ${CANVAS_FONT_STACKS[fontFamily]}`;
}

function wrapLines(
  context: CanvasRenderingContext2D,
  text: string,
  maximumWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maximumWidth) {
        lines.push(line);
        line = character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length > 0 ? lines : [""];
}

async function rasterizeText({
  color,
  direction,
  fontFamily,
  fontSize,
  fontWeight,
  mirrored,
  requestedScale,
  text,
  textAlign,
  viewportWidth,
}: Pick<
  WorkerMarqueeProps,
  | "color"
  | "direction"
  | "fontFamily"
  | "fontSize"
  | "fontWeight"
  | "mirrored"
  | "text"
  | "textAlign"
> & {
  requestedScale: number;
  viewportWidth: number;
}): Promise<TextRaster> {
  const measurement = document.createElement("canvas");
  const measurementContext = measurement.getContext("2d");
  if (!measurementContext) throw new Error("Canvas text measurement unavailable");

  const font = fontDeclaration(fontSize, fontWeight, fontFamily);
  measurementContext.font = font;
  const horizontal = direction === "left" || direction === "right";
  const lineHeight = Math.max(1, fontSize * 1.06);
  const padding = Math.max(2, fontSize * 0.08);
  const maximumLineWidth = Math.max(1, viewportWidth - padding * 2);
  const lines = horizontal
    ? text.split("\n")
    : wrapLines(measurementContext, text, maximumLineWidth);
  const visibleLines = lines.length > 0 ? lines : [""];
  const measuredWidth = Math.max(
    1,
    ...visibleLines.map((line) => measurementContext.measureText(line).width),
  );
  const contentWidth = horizontal
    ? Math.max(1, measuredWidth + padding * 2)
    : Math.max(1, viewportWidth);
  const contentHeight = Math.max(
    1,
    visibleLines.length * lineHeight + padding * 2,
  );
  const scale = resolveCanvasBackingScale(
    contentWidth,
    contentHeight,
    requestedScale,
    CANVAS_MAX_BACKING_PIXELS,
    CANVAS_MAX_BITMAP_DIMENSION,
  );
  const raster = document.createElement("canvas");
  raster.width = Math.max(1, Math.floor(contentWidth * scale));
  raster.height = Math.max(1, Math.floor(contentHeight * scale));
  const context = raster.getContext("2d");
  if (!context) throw new Error("Canvas text rasterization unavailable");

  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, contentWidth, contentHeight);
  context.fillStyle = color;
  context.font = font;
  context.textAlign = textAlign;
  context.textBaseline = "top";
  if (mirrored) {
    context.translate(contentWidth, 0);
    context.scale(-1, 1);
  }
  const x = textAlign === "center"
    ? contentWidth / 2
    : textAlign === "right"
      ? contentWidth - padding
      : padding;
  const lineOffset = Math.max(0, (lineHeight - fontSize) / 2);
  visibleLines.forEach((line, index) => {
    context.fillText(line, x, padding + index * lineHeight + lineOffset);
  });

  return {
    bitmap: await createImageBitmap(raster),
    contentHeight,
    contentWidth,
  };
}

function WorkerSurface({
  animationKey,
  className,
  color,
  controllerRef,
  devicePixelRatio,
  direction,
  flashEnabled,
  fontFamily,
  fontSize,
  fontWeight,
  mirrored,
  onUnsupported,
  paused,
  refreshRateHz,
  speed,
  text,
  textAlign,
}: WorkerMarqueeProps & { onUnsupported: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackControllerRef = useRef<MarqueeMotionController>(null);
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  const runtimeRef = useRef<WorkerRuntime>({
    rebuildFrame: null,
    rebuildRevision: 0,
    settleTimer: null,
    worker: null,
  });
  const rebuildRef = useRef<() => Promise<void>>(async () => undefined);
  const [renderer, setRenderer] = useState("starting");

  useLayoutEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useLayoutEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const effectivePixelsPerSecond = useCallback(
    (nextSpeed: number) =>
      resolveAdaptiveMarqueeSpeed(
        speedToPixelsPerSecond(nextSpeed),
        refreshRateHz,
        devicePixelRatio,
      ).effectivePixelsPerSecond,
    [devicePixelRatio, refreshRateHz],
  );

  const previewSpeed = useCallback(
    (nextSpeed: number) => {
      runtimeRef.current.worker?.postMessage({
        type: "speed",
        pixelsPerSecond: effectivePixelsPerSecond(nextSpeed),
      });
    },
    [effectivePixelsPerSecond],
  );

  useImperativeHandle(
    controllerRef ?? fallbackControllerRef,
    () => ({ previewSpeed }),
    [previewSpeed],
  );

  const rebuild = useCallback(async () => {
    const runtime = runtimeRef.current;
    const worker = runtime.worker;
    const host = hostRef.current;
    if (!worker || !host) return;
    const revision = ++runtime.rebuildRevision;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    try {
      const raster = await rasterizeText({
        color,
        direction,
        fontFamily,
        fontSize,
        fontWeight,
        mirrored,
        requestedScale: devicePixelRatio,
        text,
        textAlign,
        viewportWidth: width,
      });
      if (
        revision !== runtime.rebuildRevision ||
        worker !== runtime.worker
      ) {
        raster.bitmap.close();
        return;
      }
      const canvasScale = resolveCanvasBackingScale(
        width,
        height,
        devicePixelRatio,
        CANVAS_MAX_BACKING_PIXELS,
        CANVAS_MAX_VISIBLE_DIMENSION,
      );
      const geometry = calculateMarqueeGeometry(
        direction,
        width,
        height,
        raster.contentWidth,
        raster.contentHeight,
      );
      const motionBlurEnabled =
        new URLSearchParams(window.location.search).get("marquee-blur") !== "0";
      worker.postMessage(
        {
          type: "configure",
          animationKey,
          backingHeight: Math.max(1, Math.floor(height * canvasScale)),
          backingWidth: Math.max(1, Math.floor(width * canvasScale)),
          canvasScale,
          contentHeight: raster.contentHeight,
          contentWidth: raster.contentWidth,
          direction,
          geometry,
          motionBlurEnabled,
          paused: pausedRef.current,
          pixelsPerSecond: effectivePixelsPerSecond(speedRef.current),
          texture: raster.bitmap,
          viewportHeight: height,
          viewportWidth: width,
        },
        [raster.bitmap],
      );
    } catch {
      onUnsupported();
    }
  }, [
    animationKey,
    color,
    devicePixelRatio,
    direction,
    effectivePixelsPerSecond,
    fontFamily,
    fontSize,
    fontWeight,
    mirrored,
    onUnsupported,
    text,
    textAlign,
  ]);

  useLayoutEffect(() => {
    rebuildRef.current = rebuild;
  }, [rebuild]);

  const scheduleRebuild = useCallback(() => {
    const runtime = runtimeRef.current;
    if (runtime.rebuildFrame !== null) return;
    runtime.rebuildFrame = requestAnimationFrame(() => {
      runtime.rebuildFrame = null;
      void rebuildRef.current();
    });
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const runtime = runtimeRef.current;
    let worker: Worker;
    try {
      worker = new Worker(
        new URL("../workers/marqueeRenderer.worker.ts", import.meta.url),
        { type: "module" },
      );
      const offscreen = canvas.transferControlToOffscreen();
      runtime.worker = worker;
      worker.addEventListener("message", (event: MessageEvent) => {
        const message = event.data as { renderer?: string; type?: string };
        if (message.type === "ready" && message.renderer) {
          setRenderer(message.renderer);
        } else if (message.type === "unsupported") {
          onUnsupported();
        }
      });
      worker.addEventListener("error", onUnsupported);
      worker.postMessage({ type: "init", canvas: offscreen }, [offscreen]);
    } catch {
      onUnsupported();
      return;
    }

    scheduleRebuild();
    return () => {
      runtime.rebuildRevision += 1;
      if (runtime.rebuildFrame !== null) {
        cancelAnimationFrame(runtime.rebuildFrame);
        runtime.rebuildFrame = null;
      }
      if (runtime.settleTimer !== null) {
        window.clearTimeout(runtime.settleTimer);
        runtime.settleTimer = null;
      }
      worker.terminate();
      if (runtime.worker === worker) runtime.worker = null;
    };
  }, [onUnsupported, scheduleRebuild]);

  useLayoutEffect(() => {
    scheduleRebuild();
  }, [rebuild, scheduleRebuild]);

  useLayoutEffect(() => {
    scheduleRebuild();
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      const runtime = runtimeRef.current;
      scheduleRebuild();
      if (runtime.settleTimer !== null) {
        window.clearTimeout(runtime.settleTimer);
      }
      runtime.settleTimer = window.setTimeout(() => {
        runtime.settleTimer = null;
        scheduleRebuild();
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(host);
    void document.fonts?.ready.then(scheduleRebuild, scheduleRebuild);
    return () => observer.disconnect();
  }, [scheduleRebuild]);

  useLayoutEffect(() => {
    previewSpeed(speed);
  }, [previewSpeed, speed]);

  useLayoutEffect(() => {
    runtimeRef.current.worker?.postMessage({ type: "pause", paused });
  }, [paused]);

  const classes = [
    "worker-marquee-host",
    flashEnabled ? "is-flashing" : "",
    paused ? "is-paused" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      aria-hidden="true"
      class={classes}
      data-marquee-engine="worker"
      data-worker-renderer={renderer}
      ref={hostRef}
    >
      <canvas
        aria-hidden="true"
        class="worker-marquee-surface"
        data-testid="worker-marquee"
        ref={canvasRef}
      />
    </div>
  );
}

/**
 * Experimental renderer: rasterize text once on the main thread, then transfer
 * a static ImageBitmap to an OffscreenCanvas worker. WebGL (or worker 2D as a
 * compatibility fallback) owns all steady-state frame production.
 */
export function WorkerMarquee(props: WorkerMarqueeProps) {
  const [fallback, setFallback] = useState(!supportsWorkerCanvas());
  const useFallback = useCallback(() => setFallback(true), []);

  if (fallback) {
    return (
      <CanvasMarquee
        animationKey={props.animationKey}
        className={props.className}
        color={props.color}
        controllerRef={props.controllerRef}
        direction={props.direction}
        flashEnabled={props.flashEnabled}
        fontFamily={props.fontFamily}
        fontSize={props.fontSize}
        fontWeight={props.fontWeight}
        mirrored={props.mirrored}
        paused={props.paused}
        speed={props.speed}
        text={props.text}
        textAlign={props.textAlign}
      />
    );
  }

  return <WorkerSurface {...props} onUnsupported={useFallback} />;
}
