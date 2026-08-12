import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BoardPageV1 } from "../domain/types";
import { useAutoFit } from "../hooks/useAutoFit";
import { QrDisplay } from "./QrDisplay";

interface BoardCanvasProps {
  page: BoardPageV1;
  placeholder: string;
  editHint: string;
  qrError: string;
  paused: boolean;
  presentation: boolean;
  onEdit: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onInteraction: () => void;
  onFitChange: (size: number, overflow: boolean) => void;
}

const fontClasses: Record<BoardPageV1["fontFamily"], string> = {
  "system-sans": "font-system-sans",
  "system-rounded": "font-system-rounded",
  "system-serif": "font-system-serif",
  "system-mono": "font-system-mono"
};

export function BoardCanvas({
  page,
  placeholder,
  editHint,
  qrError,
  paused,
  presentation,
  onEdit,
  onNext,
  onPrevious,
  onInteraction,
  onFitChange
}: BoardCanvasProps) {
  const textViewportRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const movingRef = useRef<HTMLDivElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const [motion, setMotion] = useState({
    startX: "0px",
    startY: "0px",
    endX: "0px",
    endY: "0px",
    duration: 8
  });

  const displayText = page.text || placeholder;
  const mode = !page.marquee.enabled
    ? "static"
    : page.marquee.direction === "left" || page.marquee.direction === "right"
      ? "horizontal"
      : "vertical";
  const { fontSize, overflow, recalculate } = useAutoFit({
    containerRef: textViewportRef,
    measureRef,
    content: displayText,
    maxSize: page.maxFontSizePx,
    mode,
    layoutKey: `${page.fontFamily}:${page.fontWeight}:${page.qr.enabled}`
  });

  useEffect(() => onFitChange(fontSize, overflow), [fontSize, overflow, onFitChange]);

  useEffect(() => {
    const viewport = textViewportRef.current;
    const moving = movingRef.current;
    if (!viewport || !moving || !page.marquee.enabled) return;

    const update = () => {
      recalculate();
      const viewportRect = viewport.getBoundingClientRect();
      const contentRect = moving.getBoundingClientRect();
      const pixelsPerSecond = 24 + ((page.marquee.speed - 1) / 9) * 136;
      let startX = 0;
      let startY = 0;
      let endX = 0;
      let endY = 0;
      let distance: number;
      if (page.marquee.direction === "left") {
        startX = viewportRect.width;
        endX = -contentRect.width;
        distance = viewportRect.width + contentRect.width;
      } else if (page.marquee.direction === "right") {
        startX = -contentRect.width;
        endX = viewportRect.width;
        distance = viewportRect.width + contentRect.width;
      } else if (page.marquee.direction === "up") {
        startY = viewportRect.height;
        endY = -contentRect.height;
        distance = viewportRect.height + contentRect.height;
      } else {
        startY = -contentRect.height;
        endY = viewportRect.height;
        distance = viewportRect.height + contentRect.height;
      }
      setMotion({
        startX: `${startX}px`,
        startY: `${startY}px`,
        endX: `${endX}px`,
        endY: `${endY}px`,
        duration: Math.max(1.5, distance / pixelsPerSecond)
      });
    };

    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(moving);
    const frame = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fontSize, page.marquee.direction, page.marquee.enabled, page.marquee.speed, recalculate]);

  const textColor = page.textColor === "auto" ? (page.theme === "dark" ? "#ffffff" : "#1a1a1e") : page.textColor;
  const textStyle = useMemo(
    () => ({
      color: textColor,
      fontSize: `${fontSize}px`,
      fontWeight: String(page.fontWeight),
      textAlign: page.textAlign,
      "--marquee-start-x": motion.startX,
      "--marquee-start-y": motion.startY,
      "--marquee-end-x": motion.endX,
      "--marquee-end-y": motion.endY,
      "--marquee-duration": `${motion.duration}s`
    }),
    [fontSize, motion, page.fontWeight, page.textAlign, textColor]
  );

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("button,input,textarea,select,a,[role=dialog],[data-no-canvas-gesture]"));

  const handlePointerDown = (event: PointerEvent) => {
    if (isInteractiveTarget(event.target)) return;
    const bounds = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null;
    if (!bounds || event.clientX - bounds.left < 24 || bounds.right - event.clientX < 24) return;
    pointerStartRef.current = { x: event.clientX, y: event.clientY, at: performance.now() };
    onInteraction();
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
      {!presentation ? <p class="edit-hint">{editHint}</p> : null}
      <section class={`board-layout ${page.qr.enabled && page.qr.payload ? "has-qr" : ""}`}>
        <div class="text-viewport" ref={textViewportRef}>
          <span
            aria-hidden="true"
            class={`text-measure ${fontClasses[page.fontFamily]}`}
            ref={measureRef}
            style={{ fontWeight: page.fontWeight }}
          >
            {displayText}
          </span>
          <div
            class={`moving-text ${page.marquee.enabled ? "is-marquee" : ""} ${paused ? "is-paused" : ""}`}
            ref={movingRef}
            style={textStyle}
          >
            <div class={`${page.flashEnabled ? "is-flashing" : ""} ${paused ? "is-paused" : ""}`}>
              <div class={page.mirrored ? "is-mirrored" : ""}>
                <p class={`display-text ${fontClasses[page.fontFamily]} ${page.marquee.enabled ? "no-wrap" : ""}`}>
                  {displayText}
                </p>
              </div>
            </div>
          </div>
        </div>
        {page.qr.enabled && page.qr.payload ? <QrDisplay errorLabel={qrError} payload={page.qr.payload} /> : null}
      </section>
    </main>
  );
}
