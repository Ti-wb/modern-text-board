import { describe, expect, it } from "vitest";

import {
  FONT_CATALOG,
  SYSTEM_FONT_FAMILIES,
  WEB_FONT_FAMILIES,
  isWebFontFamily,
  resolveCanvasFontDeclaration,
  resolveClosestFontWeight,
  resolveFontStack,
  resolveSupportedFontWeight,
  supportsFontWeight,
} from "./catalog";

describe("font catalog", () => {
  it("contains four system families and nine optional web families", () => {
    expect(SYSTEM_FONT_FAMILIES).toHaveLength(4);
    expect(WEB_FONT_FAMILIES).toHaveLength(9);
    expect(Object.keys(FONT_CATALOG)).toHaveLength(13);
    expect(SYSTEM_FONT_FAMILIES.every((font) => !isWebFontFamily(font))).toBe(true);
    expect(WEB_FONT_FAMILIES.every(isWebFontFamily)).toBe(true);
  });

  it("declares real weights and platform-safe fallback stacks", () => {
    expect(Object.fromEntries(WEB_FONT_FAMILIES.map((font) => [
      font,
      {
        fallback: FONT_CATALOG[font].fallback,
        weights: FONT_CATALOG[font].supportedWeights,
      },
    ]))).toEqual({
      "web-noto-sans-tc": {
        fallback: "system-sans",
        weights: [300, 400, 700, 900],
      },
      "web-noto-serif-tc": {
        fallback: "system-serif",
        weights: [300, 400, 700, 900],
      },
      "web-lxgw-wenkai-tc": {
        fallback: "system-serif",
        weights: [300, 400, 700],
      },
      "web-iansui": { fallback: "system-serif", weights: [400] },
      "web-wdxl-lubrifont-tc": {
        fallback: "system-sans",
        weights: [400],
      },
      "web-lato": {
        fallback: "system-sans",
        weights: [300, 400, 700, 900],
      },
      "web-inter": {
        fallback: "system-sans",
        weights: [300, 400, 700, 900],
      },
      "web-montserrat": {
        fallback: "system-sans",
        weights: [300, 400, 700, 900],
      },
      "web-merriweather": {
        fallback: "system-serif",
        weights: [300, 400, 700, 900],
      },
    });
    expect(resolveFontStack("web-noto-serif-tc")).toContain("Songti TC");
    expect(resolveFontStack("web-lato")).toContain("system-ui");
  });

  it("chooses the nearest real weight and prefers the heavier tie", () => {
    expect(resolveSupportedFontWeight("web-lxgw-wenkai-tc", 900)).toBe(700);
    expect(resolveSupportedFontWeight("web-iansui", 300)).toBe(400);
    expect(resolveClosestFontWeight([300, 700], 500)).toBe(700);
    expect(supportsFontWeight("web-iansui", 400)).toBe(true);
    expect(supportsFontWeight("web-iansui", 700)).toBe(false);
  });

  it("provides one font declaration for Canvas and Worker rasterization", () => {
    expect(resolveCanvasFontDeclaration("web-lato", 700, 80)).toBe(
      '700 80px "Lato", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", sans-serif',
    );
  });
});
