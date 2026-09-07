import type { RefObject } from "preact";
import { useLayoutEffect } from "preact/hooks";

// Two copies together stay inside 32 MB of uncompressed RGBA pixels. Never
// reduce DPR to fit: native text remains available when a cache is too large.
const MAX_TOTAL_PIXELS = 8_000_000;
const MAX_DIMENSION = 16_384;

interface InkLine {
  text: string;
  left: number;
  top: number;
  center: number;
  firstLength: number;
}

/** Use browser wrapping and baselines, including fallback fonts and graphemes. */
export function createMarqueeInk(source: HTMLElement, dpr: number): HTMLCanvasElement | null {
  const text = source.textContent ?? "";
  const style = getComputedStyle(source);
  // Canvas does not implement CSS tab stops or arbitrary bidi overrides.
  if (!text || text.includes("\t") || style.direction !== "ltr" ||
      style.writingMode !== "horizontal-tb" || !Number.isFinite(dpr) || dpr <= 0 ||
      typeof Intl.Segmenter !== "function") return null;
  const box = source.getBoundingClientRect();
  const fontSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(fontSize) || !Number.isFinite(lineHeight)) return null;
  const padding = Math.ceil(fontSize);
  const width = Math.ceil((box.width + padding * 2) * dpr);
  const height = Math.ceil((box.height + padding * 2) * dpr);
  if (width <= 0 || height <= 0 || width > MAX_DIMENSION || height > MAX_DIMENSION ||
      width * height * 2 > MAX_TOTAL_PIXELS) return null;

  const bitmap = document.createElement("canvas");
  bitmap.width = width;
  bitmap.height = height;
  const context = bitmap.getContext("2d");
  if (!context) return null;

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;contain:layout style;";
  const paragraph = document.createElement("p");
  for (const property of ["font-family", "font-size", "font-weight", "font-style", "font-stretch",
    "font-kerning", "line-height", "letter-spacing", "word-spacing", "white-space",
    "word-break", "overflow-wrap", "text-align", "direction", "tab-size"]) {
    paragraph.style.setProperty(property, style.getPropertyValue(property));
  }
  paragraph.style.margin = "0";
  paragraph.style.width = `${box.width}px`;
  const node = document.createTextNode(text);
  paragraph.append(node);
  // Canvas resolves font synthesis from its connected style source. A detached
  // canvas would synthesize bold fallback CJK even when the board forbids it.
  bitmap.style.fontSynthesis = style.fontSynthesis;
  host.append(paragraph, bitmap);
  document.body.append(host);
  try {
    const origin = paragraph.getBoundingClientRect();
    const range = document.createRange();
    const lines: InkLine[] = [];
    const segments = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);
    for (const { segment, index } of segments) {
      if (segment.includes("\n") || segment.includes("\r")) continue;
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const rect = range.getBoundingClientRect();
      const center = rect.top + rect.height / 2;
      let line = lines.at(-1);
      if (!line || Math.abs(center - line.center) > lineHeight / 2) {
        line = { text: "", left: rect.left, top: rect.top, center, firstLength: segment.length };
        lines.push(line);
      }
      line.text += segment;
      line.left = Math.min(line.left, rect.left);
    }

    const probe = paragraph.cloneNode(false) as HTMLParagraphElement;
    probe.style.whiteSpace = "pre";
    probe.style.width = "max-content";
    probe.style.textAlign = "left";
    const probeText = document.createTextNode("");
    const baseline = document.createElement("span");
    baseline.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;";
    probe.append(probeText, baseline);
    host.append(probe);
    context.scale(dpr, dpr);
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    context.fontKerning = style.fontKerning as CanvasFontKerning;
    context.textRendering = style.textRendering as CanvasTextRendering;
    context.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
    context.wordSpacing = style.wordSpacing === "normal" ? "0px" : style.wordSpacing;
    context.fillStyle = style.color;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";
    for (const line of lines) {
      probeText.data = line.text;
      range.setStart(probeText, 0);
      range.setEnd(probeText, line.firstLength);
      const baselineOffset = baseline.getBoundingClientRect().top - range.getBoundingClientRect().top;
      const x = padding + line.left - origin.left;
      const y = padding + line.top - origin.top + baselineOffset;
      const ink = context.measureText(line.text);
      // Preserve overhanging glyphs; unsupported/extreme ink keeps native DOM.
      if (x - ink.actualBoundingBoxLeft < 0 || x + ink.actualBoundingBoxRight > width / dpr ||
          y - ink.actualBoundingBoxAscent < 0 || y + ink.actualBoundingBoxDescent > height / dpr) return null;
      context.fillText(line.text, x, y);
    }
    bitmap.className = "marquee-ink-cache";
    bitmap.setAttribute("aria-hidden", "true");
    bitmap.style.cssText = `position:absolute;pointer-events:none;left:${-padding}px;top:${-padding}px;width:${width / dpr}px;height:${height / dpr}px;`;
    return bitmap;
  } finally {
    host.remove();
  }
}

/** Static textures move with the existing WAAPI copies; no steady-state rAF. */
export function useMarqueeInk({ enabled, movingRef, revision, dpr }: {
  enabled: boolean;
  movingRef: RefObject<HTMLElement>;
  revision: string;
  dpr: number;
}): void {
  useLayoutEffect(() => {
    const moving = movingRef.current;
    if (!enabled || !moving) return;
    let cachedKey = "";
    let rebuildTimer: number | null = null;
    const caches: HTMLCanvasElement[] = [];
    const originals: HTMLElement[] = [];
    const clear = () => {
      originals.forEach((element) => element.style.removeProperty("opacity"));
      caches.forEach((canvas) => { canvas.remove(); canvas.width = 0; canvas.height = 0; });
      caches.length = 0;
      originals.length = 0;
      moving.dataset.marqueeInk = "native";
    };
    const rebuild = () => {
      const texts = [...moving.querySelectorAll<HTMLElement>(".marquee-copy .display-text")];
      if (texts.length !== 2) return;
      const first = texts[0];
      const box = first.getBoundingClientRect();
      const key = `${box.width}:${box.height}:${revision}:${dpr}`;
      if (key === cachedKey) return;
      clear();
      cachedKey = key;
      try {
        const bitmap = createMarqueeInk(first, dpr);
        if (!bitmap) return;
        const second = bitmap.cloneNode(false) as HTMLCanvasElement;
        second.width = bitmap.width;
        second.height = bitmap.height;
        const context = second.getContext("2d");
        if (!context) return;
        context.drawImage(bitmap, 0, 0);
        texts.forEach((element, index) => {
          const canvas = index === 0 ? bitmap : second;
          element.parentElement!.append(canvas);
          element.style.opacity = "0";
          originals.push(element);
          caches.push(canvas);
        });
        moving.dataset.marqueeInk = "cached";
      } catch {
        clear();
      }
    };
    const schedule = () => {
      // Keep native text live during font/viewport drags. Rasterize only after
      // layout settles, instead of allocating two textures on every input.
      clear();
      cachedKey = "";
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(() => {
        rebuildTimer = null;
        rebuild();
      }, 80);
    };
    schedule();
    const observer = new ResizeObserver(schedule);
    const first = moving.querySelector(".display-text");
    if (first) observer.observe(first);
    const languageObserver = new MutationObserver(schedule);
    languageObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["lang", "dir"] });
    return () => {
      observer.disconnect();
      languageObserver.disconnect();
      if (rebuildTimer !== null) window.clearTimeout(rebuildTimer);
      clear();
      delete moving.dataset.marqueeInk;
    };
  }, [dpr, enabled, movingRef, revision]);
}
