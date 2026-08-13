import { describe, expect, it } from "vitest";

import {
  LIMITS,
  createDefaultPage,
  createDefaultPreferences,
  createDefaultWorkspace,
} from "./defaults";
import { createExport, serializeExport } from "./storage";
import {
  parseExportJson,
  validateExport,
  validatePreferences,
  validateWorkspace,
} from "./validation";

describe("domain validation", () => {
  it("accepts a complete current export", () => {
    const data = createExport(
      createDefaultWorkspace("zh-TW", "page-1"),
      createDefaultPreferences("zh-TW"),
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(validateExport(data)).toEqual({ success: true, data });
    expect(parseExportJson(serializeExport(data))).toMatchObject({ success: true });
  });

  it("migrates a schema v1 export to responsive schema v2 without changing pixels", () => {
    const current = createExport(
      createDefaultWorkspace("en", "legacy-page"),
      createDefaultPreferences("en"),
      new Date("2026-08-12T00:00:00.000Z"),
    );
    const legacy = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
    legacy.schemaVersion = 1;
    const legacyWorkspace = legacy.workspace as {
      pages: Array<Record<string, unknown>>;
    };
    delete legacyWorkspace.pages[0].fontScalePercent;

    expect(parseExportJson(JSON.stringify(legacy))).toMatchObject({
      success: true,
      data: {
        schemaVersion: 2,
        workspace: {
          pages: [{ maxFontSizePx: 80, fontScalePercent: null }],
        },
      },
    });
  });

  it("rejects unknown fields at every object level", () => {
    const workspace = createDefaultWorkspace("en", "page-1");
    const result = validateWorkspace({
      ...workspace,
      pages: [{ ...workspace.pages[0], unsafeHtml: "<script>" }],
    });
    expect(result).toMatchObject({ success: false });
  });

  it("rejects duplicate IDs and missing active pages", () => {
    const page = createDefaultPage("same", "Page");
    expect(
      validateWorkspace({ pages: [page, { ...page }], activePageId: "same" }),
    ).toMatchObject({ success: false });
    expect(
      validateWorkspace({ pages: [page], activePageId: "missing" }),
    ).toMatchObject({ success: false });
  });

  it("enforces page name and text limits in Unicode code points", () => {
    const page = createDefaultPage("page-1", "😀".repeat(60));
    page.text = "😀".repeat(LIMITS.maxTextCodePoints);
    expect(validateWorkspace({ pages: [page], activePageId: page.id })).toMatchObject({
      success: true,
    });

    expect(
      validateWorkspace({
        pages: [{ ...page, name: `${page.name}x` }],
        activePageId: page.id,
      }),
    ).toMatchObject({ success: false });
    expect(
      validateWorkspace({
        pages: [{ ...page, text: `${page.text}x` }],
        activePageId: page.id,
      }),
    ).toMatchObject({ success: false });
  });

  it("enforces the QR byte limit and initialization invariant", () => {
    const page = createDefaultPage("page-1", "Page");
    page.qr = { enabled: true, payload: "界".repeat(171) };
    expect(validateWorkspace({ pages: [page], activePageId: page.id })).toMatchObject({
      success: false,
    });
    page.qr.payload = null;
    expect(validateWorkspace({ pages: [page], activePageId: page.id })).toMatchObject({
      success: false,
    });
    page.qr.payload = "";
    expect(validateWorkspace({ pages: [page], activePageId: page.id })).toMatchObject({
      success: false,
    });
    expect(
      parseExportJson(JSON.stringify(createExport(
        { pages: [page], activePageId: page.id },
        createDefaultPreferences("en"),
      ))),
    ).toMatchObject({ success: false });
    page.qr.enabled = false;
    expect(validateWorkspace({ pages: [page], activePageId: page.id })).toMatchObject({
      success: true,
    });
  });

  it("rejects non-finite numbers and out-of-range values", () => {
    const preferences = createDefaultPreferences();
    expect(
      validatePreferences({
        ...preferences,
        toolbar: { ...preferences.toolbar, offsetRatio: Number.POSITIVE_INFINITY },
      }),
    ).toMatchObject({ success: false });

    const workspace = createDefaultWorkspace("en", "page-1");
    workspace.pages[0].maxFontSizePx = 201;
    expect(validateWorkspace(workspace)).toMatchObject({ success: false });

    const responsive = createDefaultWorkspace("en", "responsive-page");
    responsive.pages[0].fontScalePercent = LIMITS.maxFontScalePercent + 1;
    expect(validateWorkspace(responsive)).toMatchObject({ success: false });
    responsive.pages[0].fontScalePercent = LIMITS.minFontScalePercent;
    expect(validateWorkspace(responsive)).toMatchObject({ success: true });
  });

  it("normalizes legacy pages without a responsive font scale", () => {
    const workspace = createDefaultWorkspace("en", "legacy-page");
    const legacyPage = { ...workspace.pages[0] } as Record<string, unknown>;
    delete legacyPage.fontScalePercent;

    expect(
      validateWorkspace({ pages: [legacyPage], activePageId: "legacy-page" }),
    ).toMatchObject({
      success: true,
      data: { pages: [{ maxFontSizePx: 80, fontScalePercent: null }] },
    });
  });

  it("accepts fractional marquee speeds across the expanded range", () => {
    const workspace = createDefaultWorkspace("en", "marquee-page");
    workspace.pages[0].marquee.speed = 12.3;
    expect(validateWorkspace(workspace)).toMatchObject({ success: true });

    workspace.pages[0].marquee.speed = LIMITS.maxMarqueeSpeed + 0.1;
    expect(validateWorkspace(workspace)).toMatchObject({ success: false });
  });

  it("validates the toolbar vertical ratio", () => {
    const preferences = createDefaultPreferences();

    for (const verticalOffsetRatio of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -0.01,
      1.01,
    ]) {
      expect(
        validatePreferences({
          ...preferences,
          toolbar: { ...preferences.toolbar, verticalOffsetRatio },
        }),
      ).toMatchObject({ success: false });
    }
  });

  it("normalizes legacy toolbar preferences that do not have a vertical ratio", () => {
    const preferences = createDefaultPreferences();
    const top = validatePreferences({
      ...preferences,
      toolbar: {
        edge: "top",
        offsetRatio: 0.25,
        autoHide: false,
      },
    });
    const bottom = validatePreferences({
      ...preferences,
      toolbar: {
        edge: "bottom",
        offsetRatio: 0.75,
        autoHide: true,
      },
    });

    expect(top).toMatchObject({
      success: true,
      data: { toolbar: { verticalOffsetRatio: 0 } },
    });
    expect(bottom).toMatchObject({
      success: true,
      data: { toolbar: { verticalOffsetRatio: 1 } },
    });
  });

  it("returns useful errors for invalid JSON, formats, future versions, and huge files", () => {
    expect(parseExportJson("not-json")).toMatchObject({
      success: false,
      error: { code: "invalid_json" },
    });
    expect(parseExportJson('{"format":"other","schemaVersion":1}')).toMatchObject({
      success: false,
      error: { code: "invalid_format" },
    });
    expect(
      parseExportJson('{"format":"simple-white-board","schemaVersion":3}'),
    ).toMatchObject({
      success: false,
      error: { code: "unsupported_version" },
    });
    expect(parseExportJson(" ".repeat(LIMITS.maxImportFileBytes + 1))).toMatchObject({
      success: false,
      error: { code: "file_too_large" },
    });
  });
});
