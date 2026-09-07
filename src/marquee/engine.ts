export type MarqueeEngineKind = "waapi" | "css" | "canvas" | "worker";
export type MarqueeLoopMode = "linear" | "continuous";

/** Cache only the ink; keep the existing DOM layout and motion controller. */
export function resolveMarqueeInk(
  search = typeof window === "undefined" ? "" : window.location.search,
): "native" | "cached" {
  return new URLSearchParams(search).get("marquee-raster") === "0" ? "native" : "cached";
}

/** Explicit experiment; workspace settings and the production default stay intact. */
export function resolveMarqueeLoop(
  search = typeof window === "undefined" ? "" : window.location.search,
): MarqueeLoopMode {
  return new URLSearchParams(search).get("marquee-loop") === "continuous"
    ? "continuous" : "linear";
}

const ENGINE_PARAM = "marquee-engine";
const LAB_PARAM = "marquee-lab";

export function resolveMarqueeEngine(
  search = typeof window === "undefined" ? "" : window.location.search,
): MarqueeEngineKind {
  const value = new URLSearchParams(search).get(ENGINE_PARAM);
  return value === "css" || value === "canvas" || value === "worker"
    ? value
    : "waapi";
}

export function isMarqueeLabVisible(
  search = typeof window === "undefined" ? "" : window.location.search,
): boolean {
  return new URLSearchParams(search).get(LAB_PARAM) === "1";
}

export function replaceMarqueeEngineInUrl(engine: MarqueeEngineKind): void {
  const url = new URL(window.location.href);
  url.searchParams.set(ENGINE_PARAM, engine);
  window.history.replaceState(window.history.state, "", url);
}
