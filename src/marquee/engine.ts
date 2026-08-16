export type MarqueeEngineKind = "waapi" | "css" | "canvas" | "worker";

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
