import type { WebFontFamily } from "../domain/types";

export type FontStyleLoader = () => Promise<unknown>;

export const WEB_FONT_STYLE_LOADERS: Readonly<
  Record<WebFontFamily, FontStyleLoader>
> = {
  "web-noto-sans-tc": () => import("./styles/font-noto-sans-tc"),
  "web-noto-serif-tc": () => import("./styles/font-noto-serif-tc"),
  "web-lxgw-wenkai-tc": () => import("./styles/font-lxgw-wenkai-tc"),
  "web-iansui": () => import("./styles/font-iansui"),
  "web-wdxl-lubrifont-tc": () => import("./styles/font-wdxl-lubrifont-tc"),
  "web-lato": () => import("./styles/font-lato"),
  "web-inter": () => import("./styles/font-inter"),
  "web-montserrat": () => import("./styles/font-montserrat"),
  "web-merriweather": () => import("./styles/font-merriweather"),
};

export function createFontStyleRegistry(
  loaders: Readonly<Record<WebFontFamily, FontStyleLoader>>,
) {
  const pending = new Map<WebFontFamily, Promise<void>>();

  const ensure = (fontFamily: WebFontFamily): Promise<void> => {
    const existing = pending.get(fontFamily);
    if (existing) return existing;

    const loading = loaders[fontFamily]().then(
      () => undefined,
      (error: unknown) => {
        pending.delete(fontFamily);
        throw error;
      },
    );
    pending.set(fontFamily, loading);
    return loading;
  };

  return {
    ensure,
    reset: () => pending.clear(),
  };
}

const defaultRegistry = createFontStyleRegistry(WEB_FONT_STYLE_LOADERS);

export const ensureWebFontStyles = defaultRegistry.ensure;

export function resetWebFontStylesForTests(): void {
  defaultRegistry.reset();
}
