import { describe, expect, it, vi } from "vitest";

import type { WebFontFamily } from "../domain/types";
import { WEB_FONT_FAMILIES } from "./catalog";
import {
  createFontStyleRegistry,
  type FontStyleLoader,
} from "./styleLoaders";

function fakeLoaders(loader: FontStyleLoader) {
  return Object.fromEntries(
    WEB_FONT_FAMILIES.map((fontFamily) => [fontFamily, loader]),
  ) as Record<WebFontFamily, FontStyleLoader>;
}

describe("font style loader registry", () => {
  it("deduplicates concurrent loads for the same family", async () => {
    let resolveLoad: () => void = () => undefined;
    const loader = vi.fn(() => new Promise<void>((resolve) => {
      resolveLoad = resolve;
    }));
    const registry = createFontStyleRegistry(fakeLoaders(loader));

    const first = registry.ensure("web-lato");
    const second = registry.ensure("web-lato");
    expect(first).toBe(second);
    expect(loader).toHaveBeenCalledOnce();

    resolveLoad();
    await first;
  });

  it("removes rejected loads so a retry can start again", async () => {
    const loader = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const registry = createFontStyleRegistry(fakeLoaders(loader));

    await expect(registry.ensure("web-lato")).rejects.toThrow("offline");
    await expect(registry.ensure("web-lato")).resolves.toBeUndefined();
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
