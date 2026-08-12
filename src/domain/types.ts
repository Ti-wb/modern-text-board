export type Locale = "zh-TW" | "en";

export type Theme = "light" | "dark";

export type FontFamily =
  | "system-sans"
  | "system-rounded"
  | "system-serif"
  | "system-mono";

export type FontWeight = 300 | 400 | 700 | 900;

export type TextAlign = "left" | "center" | "right";

export type MarqueeDirection = "left" | "right" | "up" | "down";

export type ToolbarEdge = "top" | "bottom";

export interface BoardPageV1 {
  id: string;
  name: string;
  text: string;
  theme: Theme;
  textColor: "auto" | string;
  fontFamily: FontFamily;
  maxFontSizePx: number;
  fontWeight: FontWeight;
  textAlign: TextAlign;
  mirrored: boolean;
  marquee: {
    enabled: boolean;
    direction: MarqueeDirection;
    speed: number;
  };
  flashEnabled: boolean;
  qr: {
    enabled: boolean;
    payload: string | null;
  };
}

export interface WorkspaceV1 {
  pages: BoardPageV1[];
  activePageId: string;
}

export interface PreferencesV1 {
  locale: Locale;
  toolbar: {
    edge: ToolbarEdge;
    offsetRatio: number;
    autoHide: boolean;
  };
  keepScreenAwake: boolean;
  pauseAnimations: boolean;
}

export interface ExportV1 {
  format: "simple-white-board";
  schemaVersion: 1;
  exportedAt: string;
  workspace: WorkspaceV1;
  preferences: PreferencesV1;
}

export interface WorkspaceStorageEnvelopeV1 {
  format: "simple-white-board/local-workspace";
  schemaVersion: 1;
  revision: number;
  savedAt: string;
  writerId: string;
  workspace: WorkspaceV1;
}

export interface PreferencesStorageEnvelopeV1 {
  format: "simple-white-board/local-preferences";
  schemaVersion: 1;
  revision: number;
  savedAt: string;
  writerId: string;
  preferences: PreferencesV1;
}

export type WorkspaceAction =
  | { type: "workspace/replace"; workspace: WorkspaceV1 }
  | { type: "page/add"; id: string; name: string; afterPageId?: string }
  | {
      type: "page/duplicate";
      pageId: string;
      id: string;
      name?: string;
    }
  | { type: "page/rename"; pageId: string; name: string }
  | { type: "page/delete"; pageId: string }
  | { type: "page/move"; pageId: string; toIndex: number }
  | { type: "page/move-by"; pageId: string; offset: -1 | 1 }
  | { type: "page/set-active"; pageId: string }
  | { type: "page/previous" }
  | { type: "page/next" }
  | { type: "page/set-text"; pageId: string; text: string }
  | { type: "page/set-theme"; pageId: string; theme: Theme }
  | { type: "page/set-text-color"; pageId: string; color: "auto" | string }
  | { type: "page/set-font-family"; pageId: string; fontFamily: FontFamily }
  | { type: "page/set-font-size"; pageId: string; sizePx: number }
  | { type: "page/set-font-weight"; pageId: string; fontWeight: FontWeight }
  | { type: "page/toggle-bold"; pageId: string }
  | { type: "page/set-text-align"; pageId: string; textAlign: TextAlign }
  | { type: "page/set-mirrored"; pageId: string; mirrored: boolean }
  | { type: "page/set-marquee-enabled"; pageId: string; enabled: boolean }
  | {
      type: "page/set-marquee-direction";
      pageId: string;
      direction: MarqueeDirection;
    }
  | { type: "page/set-marquee-speed"; pageId: string; speed: number }
  | { type: "page/set-flash-enabled"; pageId: string; enabled: boolean }
  | { type: "page/ensure-qr-initialized"; pageId: string }
  | { type: "page/set-qr-enabled"; pageId: string; enabled: boolean }
  | { type: "page/set-qr-payload"; pageId: string; payload: string | null };

export type PreferencesAction =
  | { type: "preferences/replace"; preferences: PreferencesV1 }
  | { type: "preferences/set-locale"; locale: Locale }
  | { type: "preferences/set-toolbar-edge"; edge: ToolbarEdge }
  | { type: "preferences/set-toolbar-offset"; offsetRatio: number }
  | { type: "preferences/set-toolbar-auto-hide"; autoHide: boolean }
  | { type: "preferences/set-keep-awake"; keepScreenAwake: boolean }
  | { type: "preferences/set-pause-animations"; pauseAnimations: boolean };
