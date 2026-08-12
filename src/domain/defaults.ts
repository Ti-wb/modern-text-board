import type {
  BoardPageV1,
  Locale,
  PreferencesV1,
  WorkspaceV1,
} from "./types";

export const SCHEMA_VERSION = 1 as const;

export const LIMITS = Object.freeze({
  maxPages: 50,
  maxPageNameCodePoints: 60,
  maxTextCodePoints: 2_000,
  maxQrPayloadBytes: 512,
  maxWorkspaceBytes: 512 * 1024,
  maxImportFileBytes: 1024 * 1024,
  minFontSizePx: 24,
  maxFontSizePx: 200,
  minMarqueeSpeed: 1,
  maxMarqueeSpeed: 10,
});

export const STORAGE_KEYS = Object.freeze({
  workspace: "simple-white-board.workspace",
  preferences: "simple-white-board.preferences",
});

export const DEFAULT_PAGE_NAMES: Record<Locale, string> = {
  "zh-TW": "第 1 頁",
  en: "Page 1",
};

export function createId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function createDefaultPage(
  id = createId(),
  name = DEFAULT_PAGE_NAMES["zh-TW"],
): BoardPageV1 {
  return {
    id,
    name,
    text: "",
    theme: "light",
    textColor: "auto",
    fontFamily: "system-sans",
    maxFontSizePx: 80,
    fontWeight: 900,
    textAlign: "center",
    mirrored: false,
    marquee: {
      enabled: false,
      direction: "left",
      speed: 5,
    },
    flashEnabled: false,
    qr: {
      enabled: false,
      payload: null,
    },
  };
}

export function createDefaultWorkspace(
  locale: Locale = "zh-TW",
  id = createId(),
): WorkspaceV1 {
  const page = createDefaultPage(id, DEFAULT_PAGE_NAMES[locale]);
  return { pages: [page], activePageId: page.id };
}

export function createDefaultPreferences(locale: Locale = "zh-TW"): PreferencesV1 {
  return {
    locale,
    toolbar: {
      edge: "bottom",
      offsetRatio: 0.5,
      autoHide: false,
    },
    keepScreenAwake: false,
    pauseAnimations: false,
  };
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
