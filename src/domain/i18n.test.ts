import { describe, expect, it } from "vitest";

import {
  applyDocumentLocale,
  dictionaries,
  resolveLocale,
  translate,
} from "../i18n";

describe("i18n", () => {
  it("keeps both dictionaries key-complete and interpolates values", () => {
    expect(Object.keys(dictionaries.en)).toEqual(Object.keys(dictionaries["zh-TW"]));
    expect(translate("en", "pages.pageCount", { current: 2, total: 5 })).toBe(
      "Page 2 of 5",
    );
    expect(
      translate("zh-TW", "qr.bytes", { count: 10, limit: 512 }),
    ).toBe("10 / 512 bytes");
  });

  it("resolves an explicit locale before the browser locale", () => {
    expect(resolveLocale("en", ["zh-TW"])).toBe("en");
    expect(resolveLocale(undefined, ["zh-Hant-HK"])).toBe("zh-TW");
    expect(resolveLocale(undefined, ["en-US"])).toBe("en");
    expect(resolveLocale(undefined, ["ja-JP"])).toBe("zh-TW");
  });

  it("updates the document language", () => {
    applyDocumentLocale("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
