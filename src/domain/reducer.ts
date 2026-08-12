import {
  LIMITS,
  clamp,
  codePointLength,
  createDefaultPage,
  utf8ByteLength,
} from "./defaults";
import type {
  BoardPageV1,
  PreferencesAction,
  PreferencesV1,
  WorkspaceAction,
  WorkspaceV1,
} from "./types";

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isValidId(id: string): boolean {
  return id.trim().length > 0;
}

function normalizePageName(name: string): string | null {
  const trimmed = name.trim();
  return trimmed.length > 0 &&
    codePointLength(trimmed) <= LIMITS.maxPageNameCodePoints
    ? trimmed
    : null;
}

function replacePage(
  workspace: WorkspaceV1,
  pageId: string,
  update: (page: BoardPageV1) => BoardPageV1,
): WorkspaceV1 {
  const index = workspace.pages.findIndex((page) => page.id === pageId);
  if (index < 0) return workspace;

  const current = workspace.pages[index];
  const next = update(current);
  if (next === current) return workspace;

  const pages = workspace.pages.slice();
  pages[index] = next;
  return { ...workspace, pages };
}

function movePage(workspace: WorkspaceV1, pageId: string, toIndex: number): WorkspaceV1 {
  const fromIndex = workspace.pages.findIndex((page) => page.id === pageId);
  if (fromIndex < 0 || !Number.isFinite(toIndex)) return workspace;

  const target = clamp(Math.trunc(toIndex), 0, workspace.pages.length - 1);
  if (target === fromIndex) return workspace;

  const pages = workspace.pages.slice();
  const [page] = pages.splice(fromIndex, 1);
  pages.splice(target, 0, page);
  return { ...workspace, pages };
}

function isBasicWorkspaceInvariant(workspace: WorkspaceV1): boolean {
  if (
    workspace.pages.length < 1 ||
    workspace.pages.length > LIMITS.maxPages ||
    !workspace.pages.some((page) => page.id === workspace.activePageId) ||
    workspace.pages.some(
      (page) =>
        page.qr.enabled &&
        (page.qr.payload === null || page.qr.payload.length === 0),
    )
  ) {
    return false;
  }

  return new Set(workspace.pages.map((page) => page.id)).size === workspace.pages.length;
}

export function workspaceReducer(
  workspace: WorkspaceV1,
  action: WorkspaceAction,
): WorkspaceV1 {
  switch (action.type) {
    case "workspace/replace":
      return isBasicWorkspaceInvariant(action.workspace) ? action.workspace : workspace;

    case "page/add": {
      const name = normalizePageName(action.name);
      if (
        workspace.pages.length >= LIMITS.maxPages ||
        !isValidId(action.id) ||
        workspace.pages.some((page) => page.id === action.id) ||
        name === null
      ) {
        return workspace;
      }

      const afterPageId = action.afterPageId ?? workspace.activePageId;
      const afterIndex = workspace.pages.findIndex((page) => page.id === afterPageId);
      const insertAt = afterIndex < 0 ? workspace.pages.length : afterIndex + 1;
      const pages = workspace.pages.slice();
      pages.splice(insertAt, 0, createDefaultPage(action.id, name));
      return { pages, activePageId: action.id };
    }

    case "page/duplicate": {
      const sourceIndex = workspace.pages.findIndex((page) => page.id === action.pageId);
      const source = workspace.pages[sourceIndex];
      const name = normalizePageName(action.name ?? source?.name ?? "");
      if (
        !source ||
        workspace.pages.length >= LIMITS.maxPages ||
        !isValidId(action.id) ||
        workspace.pages.some((page) => page.id === action.id) ||
        name === null
      ) {
        return workspace;
      }

      const copy: BoardPageV1 = {
        ...source,
        id: action.id,
        name,
        marquee: { ...source.marquee },
        qr: { ...source.qr },
      };
      const pages = workspace.pages.slice();
      pages.splice(sourceIndex + 1, 0, copy);
      return { pages, activePageId: copy.id };
    }

    case "page/rename": {
      const name = normalizePageName(action.name);
      if (name === null) return workspace;
      return replacePage(workspace, action.pageId, (page) =>
        page.name === name ? page : { ...page, name },
      );
    }

    case "page/delete": {
      if (workspace.pages.length === 1) return workspace;
      const index = workspace.pages.findIndex((page) => page.id === action.pageId);
      if (index < 0) return workspace;

      const pages = workspace.pages.filter((page) => page.id !== action.pageId);
      if (workspace.activePageId !== action.pageId) return { ...workspace, pages };

      const nextActive = pages[Math.min(index, pages.length - 1)];
      return { pages, activePageId: nextActive.id };
    }

    case "page/move":
      return movePage(workspace, action.pageId, action.toIndex);

    case "page/move-by": {
      const index = workspace.pages.findIndex((page) => page.id === action.pageId);
      return index < 0 ? workspace : movePage(workspace, action.pageId, index + action.offset);
    }

    case "page/set-active":
      return workspace.pages.some((page) => page.id === action.pageId)
        ? { ...workspace, activePageId: action.pageId }
        : workspace;

    case "page/previous": {
      const index = workspace.pages.findIndex((page) => page.id === workspace.activePageId);
      return index > 0 ? { ...workspace, activePageId: workspace.pages[index - 1].id } : workspace;
    }

    case "page/next": {
      const index = workspace.pages.findIndex((page) => page.id === workspace.activePageId);
      return index >= 0 && index < workspace.pages.length - 1
        ? { ...workspace, activePageId: workspace.pages[index + 1].id }
        : workspace;
    }

    case "page/set-text":
      if (codePointLength(action.text) > LIMITS.maxTextCodePoints) return workspace;
      return replacePage(workspace, action.pageId, (page) =>
        page.text === action.text ? page : { ...page, text: action.text },
      );

    case "page/set-theme":
      return replacePage(workspace, action.pageId, (page) =>
        page.theme === action.theme ? page : { ...page, theme: action.theme },
      );

    case "page/set-text-color": {
      if (action.color !== "auto" && !HEX_COLOR_PATTERN.test(action.color)) return workspace;
      const color = action.color === "auto" ? "auto" : action.color.toUpperCase();
      return replacePage(workspace, action.pageId, (page) =>
        page.textColor === color ? page : { ...page, textColor: color },
      );
    }

    case "page/set-font-family":
      return replacePage(workspace, action.pageId, (page) =>
        page.fontFamily === action.fontFamily
          ? page
          : { ...page, fontFamily: action.fontFamily },
      );

    case "page/set-font-size": {
      if (!Number.isFinite(action.sizePx)) return workspace;
      const maxFontSizePx = clamp(
        Math.round(action.sizePx),
        LIMITS.minFontSizePx,
        LIMITS.maxFontSizePx,
      );
      return replacePage(workspace, action.pageId, (page) =>
        page.maxFontSizePx === maxFontSizePx ? page : { ...page, maxFontSizePx },
      );
    }

    case "page/set-font-weight":
      return replacePage(workspace, action.pageId, (page) =>
        page.fontWeight === action.fontWeight
          ? page
          : { ...page, fontWeight: action.fontWeight },
      );

    case "page/toggle-bold":
      return replacePage(workspace, action.pageId, (page) => ({
        ...page,
        fontWeight: page.fontWeight < 700 ? 700 : 400,
      }));

    case "page/set-text-align":
      return replacePage(workspace, action.pageId, (page) =>
        page.textAlign === action.textAlign ? page : { ...page, textAlign: action.textAlign },
      );

    case "page/set-mirrored":
      return replacePage(workspace, action.pageId, (page) =>
        page.mirrored === action.mirrored ? page : { ...page, mirrored: action.mirrored },
      );

    case "page/set-marquee-enabled":
      return replacePage(workspace, action.pageId, (page) =>
        page.marquee.enabled === action.enabled
          ? page
          : { ...page, marquee: { ...page.marquee, enabled: action.enabled } },
      );

    case "page/set-marquee-direction":
      return replacePage(workspace, action.pageId, (page) =>
        page.marquee.direction === action.direction
          ? page
          : { ...page, marquee: { ...page.marquee, direction: action.direction } },
      );

    case "page/set-marquee-speed": {
      if (!Number.isFinite(action.speed)) return workspace;
      const speed = clamp(
        Math.round(action.speed),
        LIMITS.minMarqueeSpeed,
        LIMITS.maxMarqueeSpeed,
      );
      return replacePage(workspace, action.pageId, (page) =>
        page.marquee.speed === speed
          ? page
          : { ...page, marquee: { ...page.marquee, speed } },
      );
    }

    case "page/set-flash-enabled":
      return replacePage(workspace, action.pageId, (page) =>
        page.flashEnabled === action.enabled ? page : { ...page, flashEnabled: action.enabled },
      );

    case "page/ensure-qr-initialized":
      return replacePage(workspace, action.pageId, (page) => {
        if (page.qr.payload !== null) return page;
        const payload =
          utf8ByteLength(page.text) <= LIMITS.maxQrPayloadBytes ? page.text : "";
        return { ...page, qr: { ...page.qr, payload } };
      });

    case "page/set-qr-enabled":
      return replacePage(workspace, action.pageId, (page) => {
        const payload =
          action.enabled && page.qr.payload === null
            ? utf8ByteLength(page.text) <= LIMITS.maxQrPayloadBytes
              ? page.text
              : ""
            : page.qr.payload;
        if (action.enabled && (payload === null || payload.length === 0)) {
          return page;
        }
        return page.qr.enabled === action.enabled && payload === page.qr.payload
          ? page
          : { ...page, qr: { enabled: action.enabled, payload } };
      });

    case "page/set-qr-payload":
      if (
        action.payload !== null &&
        utf8ByteLength(action.payload) > LIMITS.maxQrPayloadBytes
      ) {
        return workspace;
      }
      return replacePage(workspace, action.pageId, (page) => {
        if (
          page.qr.enabled &&
          (action.payload === null || action.payload.length === 0)
        ) {
          return page;
        }
        return page.qr.payload === action.payload
          ? page
          : { ...page, qr: { ...page.qr, payload: action.payload } };
      });
  }
}

export function preferencesReducer(
  preferences: PreferencesV1,
  action: PreferencesAction,
): PreferencesV1 {
  switch (action.type) {
    case "preferences/replace":
      return action.preferences;
    case "preferences/set-locale":
      return { ...preferences, locale: action.locale };
    case "preferences/set-toolbar-edge":
      return { ...preferences, toolbar: { ...preferences.toolbar, edge: action.edge } };
    case "preferences/set-toolbar-offset":
      if (!Number.isFinite(action.offsetRatio)) return preferences;
      return {
        ...preferences,
        toolbar: {
          ...preferences.toolbar,
          offsetRatio: clamp(action.offsetRatio, 0, 1),
        },
      };
    case "preferences/set-toolbar-auto-hide":
      return {
        ...preferences,
        toolbar: { ...preferences.toolbar, autoHide: action.autoHide },
      };
    case "preferences/set-keep-awake":
      return { ...preferences, keepScreenAwake: action.keepScreenAwake };
    case "preferences/set-pause-animations":
      return { ...preferences, pauseAnimations: action.pauseAnimations };
  }
}

export function getActivePage(workspace: WorkspaceV1): BoardPageV1 {
  return (
    workspace.pages.find((page) => page.id === workspace.activePageId) ??
    workspace.pages[0]
  );
}

export const reducer = workspaceReducer;
