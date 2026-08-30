import type {
  FontFamily,
  FontWeight,
  SystemFontFamily,
  WebFontFamily,
} from "../domain/types";

export type FontCategory = "system" | "traditional-chinese" | "latin";

export interface FontDefinition {
  id: FontFamily;
  cssFamily: string;
  displayName: string;
  category: FontCategory;
  fallback: SystemFontFamily;
  sample: string;
  stack: string;
  supportedWeights: readonly FontWeight[];
}

const ALL_WEIGHTS = [300, 400, 700, 900] as const satisfies readonly FontWeight[];

const SYSTEM_STACKS: Readonly<Record<SystemFontFamily, string>> = {
  "system-sans":
    'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif',
  "system-rounded":
    'ui-rounded, "SF Pro Rounded", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',
  "system-serif":
    'ui-serif, "Songti TC", "PMingLiU", "Noto Serif CJK TC", Georgia, serif',
  "system-mono":
    'ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
};

function systemFont(
  id: SystemFontFamily,
  displayName: string,
): FontDefinition {
  return {
    id,
    cssFamily: SYSTEM_STACKS[id].split(",")[0],
    displayName,
    category: "system",
    fallback: id,
    sample: "Aa 文字 123",
    stack: SYSTEM_STACKS[id],
    supportedWeights: ALL_WEIGHTS,
  };
}

function webFont(
  id: WebFontFamily,
  cssFamily: string,
  displayName: string,
  category: Exclude<FontCategory, "system">,
  fallback: SystemFontFamily,
  supportedWeights: readonly FontWeight[],
): FontDefinition {
  return {
    id,
    cssFamily,
    displayName,
    category,
    fallback,
    sample: category === "traditional-chinese" ? "手舉牌 Aa" : "Aa Sign 123",
    stack: `"${cssFamily}", ${SYSTEM_STACKS[fallback]}`,
    supportedWeights,
  };
}

export const SYSTEM_FONT_FAMILIES = [
  "system-sans",
  "system-rounded",
  "system-serif",
  "system-mono",
] as const satisfies readonly SystemFontFamily[];

export const WEB_FONT_FAMILIES = [
  "web-noto-sans-tc",
  "web-noto-serif-tc",
  "web-lxgw-wenkai-tc",
  "web-iansui",
  "web-wdxl-lubrifont-tc",
  "web-lato",
  "web-inter",
  "web-montserrat",
  "web-merriweather",
] as const satisfies readonly WebFontFamily[];

export const FONT_CATALOG: Readonly<Record<FontFamily, FontDefinition>> = {
  "system-sans": systemFont("system-sans", "System sans"),
  "system-rounded": systemFont("system-rounded", "System rounded"),
  "system-serif": systemFont("system-serif", "System serif"),
  "system-mono": systemFont("system-mono", "System mono"),
  "web-noto-sans-tc": webFont(
    "web-noto-sans-tc",
    "Noto Sans TC Variable",
    "Noto Sans TC",
    "traditional-chinese",
    "system-sans",
    ALL_WEIGHTS,
  ),
  "web-noto-serif-tc": webFont(
    "web-noto-serif-tc",
    "Noto Serif TC Variable",
    "Noto Serif TC",
    "traditional-chinese",
    "system-serif",
    ALL_WEIGHTS,
  ),
  "web-lxgw-wenkai-tc": webFont(
    "web-lxgw-wenkai-tc",
    "LXGW WenKai TC",
    "LXGW WenKai TC",
    "traditional-chinese",
    "system-serif",
    [300, 400, 700],
  ),
  "web-iansui": webFont(
    "web-iansui",
    "Iansui",
    "Iansui",
    "traditional-chinese",
    "system-serif",
    [400],
  ),
  "web-wdxl-lubrifont-tc": webFont(
    "web-wdxl-lubrifont-tc",
    "WDXL Lubrifont TC",
    "WDXL Lubrifont TC",
    "traditional-chinese",
    "system-sans",
    [400],
  ),
  "web-lato": webFont(
    "web-lato",
    "Lato",
    "Lato",
    "latin",
    "system-sans",
    ALL_WEIGHTS,
  ),
  "web-inter": webFont(
    "web-inter",
    "Inter Variable",
    "Inter",
    "latin",
    "system-sans",
    ALL_WEIGHTS,
  ),
  "web-montserrat": webFont(
    "web-montserrat",
    "Montserrat Variable",
    "Montserrat",
    "latin",
    "system-sans",
    ALL_WEIGHTS,
  ),
  "web-merriweather": webFont(
    "web-merriweather",
    "Merriweather Variable",
    "Merriweather",
    "latin",
    "system-serif",
    ALL_WEIGHTS,
  ),
};

export function isWebFontFamily(fontFamily: FontFamily): fontFamily is WebFontFamily {
  return FONT_CATALOG[fontFamily].category !== "system";
}

export function resolveFontStack(fontFamily: FontFamily): string {
  return FONT_CATALOG[fontFamily].stack;
}

export function resolveCanvasFontDeclaration(
  fontFamily: FontFamily,
  fontWeight: FontWeight,
  fontSizePx: number,
): string {
  return `${fontWeight} ${fontSizePx}px ${resolveFontStack(fontFamily)}`;
}

export function resolveSupportedFontWeight(
  fontFamily: FontFamily,
  requestedWeight: FontWeight,
): FontWeight {
  return resolveClosestFontWeight(
    FONT_CATALOG[fontFamily].supportedWeights,
    requestedWeight,
  );
}

export function resolveClosestFontWeight(
  weights: readonly FontWeight[],
  requestedWeight: number,
): FontWeight {
  return weights.reduce((closest, candidate) => {
    const candidateDistance = Math.abs(candidate - requestedWeight);
    const closestDistance = Math.abs(closest - requestedWeight);
    return candidateDistance < closestDistance ||
      (candidateDistance === closestDistance && candidate > closest)
      ? candidate
      : closest;
  });
}

export function supportsFontWeight(
  fontFamily: FontFamily,
  fontWeight: FontWeight,
): boolean {
  return FONT_CATALOG[fontFamily].supportedWeights.includes(fontWeight);
}
