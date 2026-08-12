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
  it("accepts a complete v1 export", () => {
    const data = createExport(
      createDefaultWorkspace("zh-TW", "page-1"),
      createDefaultPreferences("zh-TW"),
      new Date("2026-08-12T00:00:00.000Z"),
    );
    expect(validateExport(data)).toEqual({ success: true, data });
    expect(parseExportJson(serializeExport(data))).toMatchObject({ success: true });
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
      parseExportJson('{"format":"simple-white-board","schemaVersion":2}'),
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
