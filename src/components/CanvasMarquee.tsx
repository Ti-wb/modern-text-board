import type { RefObject } from "preact";
import { useRef } from "preact/hooks";

import type {
  FontFamily,
  FontWeight,
  MarqueeDirection,
  TextAlign,
} from "../domain/types";
import {
  useCanvasMarquee,
  type CanvasMarqueeController,
} from "../hooks/useCanvasMarquee";

export interface CanvasMarqueeProps {
  animationKey: string;
  className?: string;
  color: string;
  controllerRef?: RefObject<CanvasMarqueeController>;
  direction: MarqueeDirection;
  flashEnabled: boolean;
  fontFamily: FontFamily;
  fontSize: number;
  fontWeight: FontWeight;
  mirrored: boolean;
  paused: boolean;
  speed: number;
  text: string;
  textAlign: TextAlign;
}

/**
 * Canvas-only visual renderer. The parent must keep one DOM text node for the
 * accessible name because canvas pixels do not expose semantic content.
 */
export function CanvasMarquee({
  animationKey,
  className,
  color,
  controllerRef,
  direction,
  flashEnabled,
  fontFamily,
  fontSize,
  fontWeight,
  mirrored,
  paused,
  speed,
  text,
  textAlign,
}: CanvasMarqueeProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useCanvasMarquee({
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
  });

  const classes = [
    "canvas-marquee-host",
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
      data-marquee-engine="canvas"
      ref={hostRef}
      style={{
        height: "100%",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
        position: "absolute",
        width: "100%",
      }}
    >
      <canvas
        aria-hidden="true"
        class="canvas-marquee-surface"
        data-testid="canvas-marquee"
        ref={canvasRef}
        style={{
          display: "block",
          height: "100%",
          width: "100%",
        }}
      />
    </div>
  );
}
