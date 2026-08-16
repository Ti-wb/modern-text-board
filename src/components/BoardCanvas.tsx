import type { RefObject } from "preact";
import { memo } from "preact/compat";
import { useEffect, useMemo, useRef } from "preact/hooks";
import type { BoardPageV2 } from "../domain/types";
import { useAutoFit } from "../hooks/useAutoFit";
import { useCssMarqueeMotion } from "../hooks/useCssMarqueeMotion";
import {
  useMarqueeMotion,
  type MarqueeMotionController,
} from "../hooks/useMarqueeMotion";
import type { MarqueeEngineKind } from "../marquee/engine";
import { QrDisplay } from "./QrDisplay";

interface BoardCanvasProps {
  page: BoardPageV2;
  placeholder: string;
  editHint: string;
  qrError: string;
  paused: boolean;
  presentation: boolean;
  marqueeEngine: MarqueeEngineKind;
  marqueeControllerRef: RefObject<MarqueeMotionController>;
  onEdit: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onFitChange: (
    size: number,
    overflow: boolean,
    maxFittingSize: number,
    fillReferenceSize: number,
  ) => void;
}

const fontClasses: Record<BoardPageV2["fontFamily"], string> = {
  "system-sans": "font-system-sans",
  "system-rounded": "font-system-rounded",
  "system-serif": "font-system-serif",
  "system-mono": "font-system-mono"
};

function BoardCanvasView({
  page,
  placeholder,
  editHint,
  qrError,
  paused,
  presentation,
  marqueeEngine,
  marqueeControllerRef,
  onEdit,
  onNext,
  onPrevious,
  onFitChange
}: BoardCanvasProps) {
  const textViewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const movingRef = useRef<HTMLDivElement>(null);
  const primaryMarqueeCopyRef = useRef<HTMLDivElement>(null);
  const secondaryMarqueeCopyRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const displayText = page.text || placeholder;
  const horizontalMarquee = page.marquee.enabled &&
    (page.marquee.direction === "left" || page.marquee.direction === "right");
  const verticalMarquee = page.marquee.enabled && !horizontalMarquee;
  const mode = !page.marquee.enabled
    ? "static"
    : horizontalMarquee ? "horizontal" : "vertical";
  const { fillReferenceSize, fontSize, maxFittingSize, overflow } = useAutoFit({
    containerRef: textViewportRef,
    measureRef,
    content: displayText,
    maxSize: page.maxFontSizePx,
    scalePercent: page.fontScalePercent,
    mode,
    resizeKey: String(page.qr.enabled && Boolean(page.qr.payload)),
    layoutKey: `${page.fontFamily}:${page.fontWeight}:${page.qr.enabled}`
  });

  useEffect(
    () => onFitChange(fontSize, overflow, maxFittingSize, fillReferenceSize),
    [fillReferenceSize, fontSize, maxFittingSize, overflow, onFitChange],
  );

  useMarqueeMotion({
    animationKey: page.id,
    direction: page.marquee.direction,
    enabled: page.marquee.enabled && marqueeEngine === "waapi",
    fontSize,
    movingRef,
    primaryCopyRef: primaryMarqueeCopyRef,
    secondaryCopyRef: secondaryMarqueeCopyRef,
    paused,
    speed: page.marquee.speed,
    viewportRef: textViewportRef,
    controllerRef: marqueeEngine === "waapi" ? marqueeControllerRef : undefined,
  });

  useCssMarqueeMotion({
    animationKey: page.id,
    direction: page.marquee.direction,
    enabled: page.marquee.enabled && marqueeEngine === "css",
    fontSize,
    movingRef,
    primaryCopyRef: primaryMarqueeCopyRef,
    secondaryCopyRef: secondaryMarqueeCopyRef,
    paused,
    speed: page.marquee.speed,
    viewportRef: textViewportRef,
    controllerRef: marqueeEngine === "css" ? marqueeControllerRef : undefined,
  });

  const textColor = page.textColor === "auto" ? (page.theme === "dark" ? "#ffffff" : "#1a1a1e") : page.textColor;
  const textStyle = useMemo(
    () => ({
      color: textColor,
      fontSize: `${fontSize}px`,
      fontWeight: String(page.fontWeight),
      textAlign: page.textAlign,
      width: verticalMarquee ? "100%" : undefined,
      maxWidth: verticalMarquee ? "100%" : undefined,
    }),
    [fontSize, page.fontWeight, page.textAlign, textColor, verticalMarquee]
  );

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("button,input,textarea,select,a,[role=dialog],[data-no-canvas-gesture]"));

  const handlePointerDown = (event: PointerEvent) => {
    if (isInteractiveTarget(event.target)) return;
    const bounds = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (!bounds || event.clientX - bounds.left < 24 || bounds.right - event.clientX < 24) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, at: performance.now() };
  };

  const handlePointerUp = (event: PointerEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || isInteractiveTarget(event.target)) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (Math.abs(dx) >= 64 && Math.abs(dx) >= Math.abs(dy) * 1.5) {
      if (dx < 0) onNext();
      else onPrevious();
      lastTapRef.current = null;
      return;
    }
    if (Math.hypot(dx, dy) > 12 || performance.now() - start.at > 500) return;
    if (event.pointerType === "touch" || event.pointerType === "pen") {
      const previous = lastTapRef.current;
      const now = performance.now();
      if (previous && now - previous.at < 360 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) < 28) {
        lastTapRef.current = null;
        onEdit();
      } else {
        lastTapRef.current = { x: event.clientX, y: event.clientY, at: now };
      }
    }
  };

  return (
    <main
      class={`board board-${page.theme} ${presentation ? "is-presenting" : ""}`}
      onDblClick={(event) => !isInteractiveTarget(event.target) && onEdit()}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      {!presentation ? (
        <button class="canvas-edit-access" type="button" onClick={onEdit}>
          {editHint}
        </button>
      ) : null}
      {!presentation ? <p aria-hidden="true" class="edit-hint">{editHint}</p> : null}
      <section class={`board-layout ${page.qr.enabled && page.qr.payload ? "has-qr" : ""}`}>
        <div
          class="text-viewport"
          data-marquee-engine={page.marquee.enabled ? marqueeEngine : undefined}
          ref={textViewportRef}
        >
          <span
            aria-hidden="true"
            class={`text-measure ${fontClasses[page.fontFamily]}`}
            ref={measureRef}
            style={{ fontWeight: page.fontWeight }}
          >
            {displayText}
          </span>
          <div
            class={`moving-text ${page.marquee.enabled ? `is-marquee marquee-${horizontalMarquee ? "horizontal" : "vertical"}` : ""} ${page.flashEnabled ? "is-flashing" : ""} ${paused ? "is-paused" : ""}`}
            data-marquee-engine={page.marquee.enabled ? marqueeEngine : undefined}
            ref={movingRef}
            style={textStyle}
          >
            {(page.marquee.enabled ? [0, 1] : [0]).map((copyIndex) => (
              <div
                aria-hidden={page.marquee.enabled && copyIndex !== 0}
                class={page.marquee.enabled ? "marquee-copy" : undefined}
                key={copyIndex}
                ref={
                  page.marquee.enabled
                    ? copyIndex === 0
                      ? primaryMarqueeCopyRef
                      : secondaryMarqueeCopyRef
                    : undefined
                }
              >
                <div class={page.mirrored ? "is-mirrored" : ""}>
                  <p class={`display-text ${fontClasses[page.fontFamily]} ${horizontalMarquee ? "no-wrap" : ""}`}>
                    {displayText}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
        {page.qr.enabled && page.qr.payload ? <QrDisplay errorLabel={qrError} payload={page.qr.payload} /> : null}
      </section>
    </main>
  );
}

/**
 * UI chrome, PWA notices, and idle timers update independently from the sign.
 * Keeping the canvas memoized prevents those updates from touching live WAAPI
 * animations or forcing text measurement on the critical rendering path.
 */
export const BoardCanvas = memo(BoardCanvasView);
