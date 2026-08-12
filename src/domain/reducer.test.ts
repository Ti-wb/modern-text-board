import { describe, expect, it } from "vitest";

import { LIMITS, createDefaultPage, createDefaultPreferences } from "./defaults";
import { preferencesReducer, workspaceReducer } from "./reducer";
import type { BoardPageV1, WorkspaceV1 } from "./types";

function workspace(...pages: BoardPageV1[]): WorkspaceV1 {
  return { pages, activePageId: pages[0].id };
}

describe("workspaceReducer page management", () => {
  it("adds after the active page and selects the new page", () => {
    const first = createDefaultPage("one", "One");
    const second = createDefaultPage("two", "Two");
    const result = workspaceReducer(workspace(first, second), {
      type: "page/add",
      id: "new",
      name: "New",
    });

    expect(result.pages.map((page) => page.id)).toEqual(["one", "new", "two"]);
    expect(result.activePageId).toBe("new");
  });

  it("duplicates nested settings without sharing references", () => {
    const first = createDefaultPage("one", "One");
    first.text = "Hello";
    first.marquee.enabled = true;
    first.qr.payload = "https://example.com";
    const result = workspaceReducer(workspace(first), {
      type: "page/duplicate",
      pageId: "one",
      id: "copy",
    });

    expect(result.pages).toHaveLength(2);
    expect(result.pages[1]).toMatchObject({ id: "copy", text: "Hello" });
    expect(result.pages[1].marquee).not.toBe(result.pages[0].marquee);
    expect(result.pages[1].qr).not.toBe(result.pages[0].qr);
  });

  it("keeps one page and selects the next or previous neighbor after deletion", () => {
    const pages = [
      createDefaultPage("one", "One"),
      createDefaultPage("two", "Two"),
      createDefaultPage("three", "Three"),
    ];
    let state: WorkspaceV1 = { pages, activePageId: "two" };
    state = workspaceReducer(state, { type: "page/delete", pageId: "two" });
    expect(state.activePageId).toBe("three");

    state = workspaceReducer(state, { type: "page/delete", pageId: "three" });
    expect(state.activePageId).toBe("one");

    const unchanged = workspaceReducer(state, { type: "page/delete", pageId: "one" });
    expect(unchanged).toBe(state);
  });

  it("reorders without changing the active ID and clamps target indexes", () => {
    const pages = [
      createDefaultPage("one", "One"),
      createDefaultPage("two", "Two"),
      createDefaultPage("three", "Three"),
    ];
    const state: WorkspaceV1 = { pages, activePageId: "two" };
    const result = workspaceReducer(state, {
      type: "page/move",
      pageId: "two",
      toIndex: 99,
    });
    expect(result.pages.map((page) => page.id)).toEqual(["one", "three", "two"]);
    expect(result.activePageId).toBe("two");
  });

  it("does not cycle previous/next navigation", () => {
    const state = workspace(
      createDefaultPage("one", "One"),
      createDefaultPage("two", "Two"),
    );
    expect(workspaceReducer(state, { type: "page/previous" })).toBe(state);
    const second = workspaceReducer(state, { type: "page/next" });
    expect(second.activePageId).toBe("two");
    expect(workspaceReducer(second, { type: "page/next" })).toBe(second);
  });

  it("enforces the 50-page limit and unique IDs", () => {
    const pages = Array.from({ length: LIMITS.maxPages }, (_, index) =>
      createDefaultPage(`page-${index}`, `Page ${index + 1}`),
    );
    const state = workspace(...pages);
    expect(
      workspaceReducer(state, { type: "page/add", id: "extra", name: "Extra" }),
    ).toBe(state);
    expect(
      workspaceReducer(workspace(pages[0]), {
        type: "page/add",
        id: pages[0].id,
        name: "Duplicate ID",
      }),
    ).toEqual(workspace(pages[0]));
  });
});

describe("workspaceReducer page settings", () => {
  it("counts Unicode code points for board text", () => {
    const state = workspace(createDefaultPage("one", "One"));
    const accepted = "😀".repeat(LIMITS.maxTextCodePoints);
    const result = workspaceReducer(state, {
      type: "page/set-text",
      pageId: "one",
      text: accepted,
    });
    expect(result.pages[0].text).toBe(accepted);
    expect(
      workspaceReducer(result, {
        type: "page/set-text",
        pageId: "one",
        text: `${accepted}x`,
      }),
    ).toBe(result);
  });

  it("clamps font size and marquee speed and follows the bold toggle rule", () => {
    let state = workspace(createDefaultPage("one", "One"));
    state = workspaceReducer(state, {
      type: "page/set-font-size",
      pageId: "one",
      sizePx: 999,
    });
    state = workspaceReducer(state, {
      type: "page/set-marquee-speed",
      pageId: "one",
      speed: -5,
    });
    expect(state.pages[0]).toMatchObject({
      maxFontSizePx: LIMITS.maxFontSizePx,
      marquee: { speed: LIMITS.minMarqueeSpeed },
    });

    state = workspaceReducer(state, { type: "page/toggle-bold", pageId: "one" });
    expect(state.pages[0].fontWeight).toBe(400);
    state = workspaceReducer(state, { type: "page/toggle-bold", pageId: "one" });
    expect(state.pages[0].fontWeight).toBe(700);
  });

  it("allows marquee and flash to play together in every direction", () => {
    let state = workspace(createDefaultPage("one", "One"));
    for (const direction of ["left", "right", "up", "down"] as const) {
      state = workspaceReducer(state, {
        type: "page/set-marquee-direction",
        pageId: "one",
        direction,
      });
      expect(state.pages[0].marquee.direction).toBe(direction);
    }
    state = workspaceReducer(state, {
      type: "page/set-marquee-enabled",
      pageId: "one",
      enabled: true,
    });
    state = workspaceReducer(state, {
      type: "page/set-flash-enabled",
      pageId: "one",
      enabled: true,
    });
    expect(state.pages[0].marquee.enabled).toBe(true);
    expect(state.pages[0].flashEnabled).toBe(true);
  });

  it("initializes QR from board text once and keeps it when disabled", () => {
    const page = createDefaultPage("one", "One");
    page.text = "first";
    let state = workspace(page);
    state = workspaceReducer(state, {
      type: "page/set-qr-enabled",
      pageId: "one",
      enabled: true,
    });
    expect(state.pages[0].qr).toEqual({ enabled: true, payload: "first" });

    state = workspaceReducer(state, {
      type: "page/set-text",
      pageId: "one",
      text: "second",
    });
    state = workspaceReducer(state, {
      type: "page/set-qr-enabled",
      pageId: "one",
      enabled: false,
    });
    state = workspaceReducer(state, {
      type: "page/set-qr-enabled",
      pageId: "one",
      enabled: true,
    });
    expect(state.pages[0].qr.payload).toBe("first");
  });

  it("refuses to enable QR when the effective payload is empty", () => {
    const page = createDefaultPage("one", "One");
    let state = workspace(page);

    expect(
      workspaceReducer(state, {
        type: "page/set-qr-enabled",
        pageId: "one",
        enabled: true,
      }),
    ).toBe(state);

    state = workspaceReducer(state, {
      type: "page/set-qr-payload",
      pageId: "one",
      payload: "",
    });
    const emptyPayloadState = state;
    expect(
      workspaceReducer(state, {
        type: "page/set-qr-enabled",
        pageId: "one",
        enabled: true,
      }),
    ).toBe(emptyPayloadState);

    state = workspaceReducer(state, {
      type: "page/set-qr-payload",
      pageId: "one",
      payload: " ",
    });
    state = workspaceReducer(state, {
      type: "page/set-qr-enabled",
      pageId: "one",
      enabled: true,
    });
    expect(state.pages[0].qr).toEqual({ enabled: true, payload: " " });
  });

  it("does not clear the payload of an enabled QR", () => {
    const page = createDefaultPage("one", "One");
    page.qr = { enabled: true, payload: "kept" };
    const state = workspace(page);

    expect(
      workspaceReducer(state, {
        type: "page/set-qr-payload",
        pageId: "one",
        payload: "",
      }),
    ).toBe(state);
    expect(
      workspaceReducer(state, {
        type: "page/set-qr-payload",
        pageId: "one",
        payload: null,
      }),
    ).toBe(state);
  });

  it("rejects replacement workspaces containing an enabled empty QR", () => {
    const current = workspace(createDefaultPage("one", "One"));
    const invalidPage = createDefaultPage("invalid", "Invalid");
    invalidPage.qr = { enabled: true, payload: "" };
    const invalid = workspace(invalidPage);

    expect(
      workspaceReducer(current, { type: "workspace/replace", workspace: invalid }),
    ).toBe(current);
  });

  it("enforces QR limits by UTF-8 bytes without trimming whitespace", () => {
    const page = createDefaultPage("one", "One");
    let state = workspace(page);
    const accepted = "界".repeat(170); // 510 UTF-8 bytes
    state = workspaceReducer(state, {
      type: "page/set-qr-payload",
      pageId: "one",
      payload: ` ${accepted}`,
    });
    expect(state.pages[0].qr.payload).toBe(` ${accepted}`);

    const rejected = workspaceReducer(state, {
      type: "page/set-qr-payload",
      pageId: "one",
      payload: "界".repeat(171),
    });
    expect(rejected).toBe(state);
  });
});

describe("preferencesReducer", () => {
  it("updates preferences separately and clamps the toolbar ratio", () => {
    let preferences = createDefaultPreferences();
    preferences = preferencesReducer(preferences, {
      type: "preferences/set-toolbar-offset",
      offsetRatio: 2,
    });
    preferences = preferencesReducer(preferences, {
      type: "preferences/set-locale",
      locale: "en",
    });
    preferences = preferencesReducer(preferences, {
      type: "preferences/set-pause-animations",
      pauseAnimations: true,
    });
    expect(preferences).toMatchObject({
      locale: "en",
      toolbar: { offsetRatio: 1 },
      pauseAnimations: true,
    });
  });

  it("updates both toolbar axes atomically and clamps them into the viewport", () => {
    const preferences = createDefaultPreferences();
    const moved = preferencesReducer(preferences, {
      type: "preferences/set-toolbar-position",
      offsetRatio: -0.25,
      verticalOffsetRatio: 1.25,
    });

    expect(moved.toolbar).toEqual({
      ...preferences.toolbar,
      edge: "bottom",
      offsetRatio: 0,
      verticalOffsetRatio: 1,
    });

    const movedToTop = preferencesReducer(moved, {
      type: "preferences/set-toolbar-position",
      offsetRatio: 0.75,
      verticalOffsetRatio: 0.25,
    });
    expect(movedToTop.toolbar).toEqual({
      ...preferences.toolbar,
      edge: "top",
      offsetRatio: 0.75,
      verticalOffsetRatio: 0.25,
    });
  });

  it("rejects a non-finite toolbar axis without partially updating the other", () => {
    const preferences = createDefaultPreferences();

    expect(
      preferencesReducer(preferences, {
        type: "preferences/set-toolbar-position",
        offsetRatio: Number.NaN,
        verticalOffsetRatio: 0.25,
      }),
    ).toBe(preferences);
    expect(
      preferencesReducer(preferences, {
        type: "preferences/set-toolbar-position",
        offsetRatio: 0.25,
        verticalOffsetRatio: Number.POSITIVE_INFINITY,
      }),
    ).toBe(preferences);
  });
});
