import type { JSX } from "preact";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";

import { BoardCanvas } from "./components/BoardCanvas";
import { ImportPreview } from "./components/ImportPreview";
import { OverlayFrame } from "./components/OverlayFrame";
import { PageManager } from "./components/PageManager";
import { PwaStatus } from "./components/PwaStatus";
import { QrPanel } from "./components/QrPanel";
import { SettingsPanel, type SettingsPwaStatus } from "./components/SettingsPanel";
import { ShortcutHelp } from "./components/ShortcutHelp";
import { TextEditor } from "./components/TextEditor";
import { ToolPanels } from "./components/ToolPanels";
import { Toolbar, type ToolPanelKind } from "./components/Toolbar";
import {
  LIMITS,
  createDefaultPreferences,
  createDefaultWorkspace,
  createId
} from "./domain/defaults";
import { getActivePage, preferencesReducer, workspaceReducer } from "./domain/reducer";
import {
  createExport,
  hydrateDomainData,
  parseImport,
  serializeExport
} from "./domain/storage";
import type { ExportV1, Locale } from "./domain/types";
import { applyDocumentLocale, getTranslator, resolveLocale } from "./i18n";
import { useDomainPersistence } from "./hooks/useDomainPersistence";
import {
  exitPresentationFullscreen,
  requestPresentationFullscreen,
  subscribeFullscreen,
  usePwaStatus,
  useWakeLock
} from "./platform";

type Overlay = "qr" | "pages" | "settings" | null;

function contrastRatio(foreground: string, background: string): number {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => {
    const value = Number.parseInt(hex.slice(1), 16);
    return 0.2126 * channel((value >> 16) & 255) +
      0.7152 * channel((value >> 8) & 255) +
      0.0722 * channel(value & 255);
  };
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest("input, textarea, select, button, a, [role=button], [contenteditable=true]")
  );
}

export function App() {
  const initial = useMemo(() => {
    const locale = resolveLocale();
    return hydrateDomainData(locale);
  }, []);
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, initial.workspace);
  const [preferences, dispatchPreferences] = useReducer(preferencesReducer, initial.preferences);
  const [panel, setPanel] = useState<ToolPanelKind | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [editing, setEditing] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [importPreview, setImportPreview] = useState<ExportV1 | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [effectiveSize, setEffectiveSize] = useState(80);
  const [fitOverflow, setFitOverflow] = useState(false);
  const [customColorDraft, setCustomColorDraft] = useState("#007AFF");
  const [customColorError, setCustomColorError] = useState<string | undefined>();
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [documentHidden, setDocumentHidden] = useState(document.visibilityState === "hidden");
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{ pointerId: number } | null>(null);
  const page = getActivePage(workspace);
  const pageIndex = workspace.pages.findIndex((item) => item.id === page.id);
  const locale = preferences.locale;
  const t = useMemo(() => getTranslator(locale), [locale]);

  const applyRemoteWorkspace = useCallback((remote: typeof workspace) => {
    dispatchWorkspace({ type: "workspace/replace", workspace: remote });
  }, []);
  const applyRemotePreferences = useCallback((remote: typeof preferences) => {
    dispatchPreferences({ type: "preferences/replace", preferences: remote });
  }, []);
  const persistence = useDomainPersistence({
    workspace,
    preferences,
    initialWorkspaceRevision: initial.workspaceRevision,
    initialPreferencesRevision: initial.preferencesRevision,
    hydrated: initial.autosaveAllowed,
    onRemoteWorkspace: applyRemoteWorkspace,
    onRemotePreferences: applyRemotePreferences
  });
  const pwa = usePwaStatus({
    beforeApplyUpdate: () => {
      if (!persistence.flush()) {
        throw new Error("Could not persist changes before updating");
      }
    }
  });
  const wakeLock = useWakeLock({
    enabled: preferences.keepScreenAwake,
    presentationActive: presentation
  });

  const notify = useCallback((message: string, error = false) => {
    setToast({ message, error });
    window.setTimeout(() => setToast((current) => current?.message === message ? null : current), 3600);
  }, []);

  const closeTransientUi = useCallback(() => {
    if (editing) setEditing(false);
    else if (shortcutsOpen) setShortcutsOpen(false);
    else if (importPreview) setImportPreview(null);
    else if (overlay) setOverlay(null);
    else if (panel) setPanel(null);
  }, [editing, importPreview, overlay, panel, shortcutsOpen]);
  const closePanel = useCallback(() => setPanel(null), []);
  const closeOverlay = useCallback(() => setOverlay(null), []);

  const exitPresentation = useCallback(async () => {
    await exitPresentationFullscreen();
    setPresentation(false);
  }, []);

  const togglePresentation = useCallback(async () => {
    setPanel(null);
    setOverlay(null);
    if (presentation) {
      await exitPresentation();
      return;
    }
    setPresentation(true);
    const result = await requestPresentationFullscreen();
    if (result.outcome !== "native") notify(t("fullscreen.unavailable"));
  }, [exitPresentation, notify, presentation, t]);

  const showToolbar = useCallback(() => {
    setToolbarHidden(false);
    if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    if (preferences.toolbar.autoHide && !editing && !panel && !overlay && !shortcutsOpen && !presentation) {
      hideTimerRef.current = window.setTimeout(() => {
        if (!dragStateRef.current && !document.querySelector(".toolbar-shell :focus-visible")) {
          setToolbarHidden(true);
        }
      }, 3000);
    }
  }, [editing, overlay, panel, preferences.toolbar.autoHide, presentation, shortcutsOpen]);

  useEffect(() => {
    applyDocumentLocale(locale);
    document.title = t("app.name");
  }, [locale, t]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateVisualViewport = () => {
      const height = visualViewport?.height ?? window.innerHeight;
      const top = Math.max(0, visualViewport?.offsetTop ?? 0);
      const left = Math.max(0, visualViewport?.offsetLeft ?? 0);
      document.documentElement.style.setProperty("--visual-viewport-height", `${height}px`);
      document.documentElement.style.setProperty("--visual-viewport-top", `${top}px`);
      document.documentElement.style.setProperty("--visual-viewport-left", `${left}px`);
    };
    updateVisualViewport();
    visualViewport?.addEventListener("resize", updateVisualViewport);
    visualViewport?.addEventListener("scroll", updateVisualViewport);
    window.addEventListener("resize", updateVisualViewport);
    window.addEventListener("orientationchange", updateVisualViewport);
    return () => {
      visualViewport?.removeEventListener("resize", updateVisualViewport);
      visualViewport?.removeEventListener("scroll", updateVisualViewport);
      window.removeEventListener("resize", updateVisualViewport);
      window.removeEventListener("orientationchange", updateVisualViewport);
    };
  }, []);

  useEffect(() => subscribeFullscreen((snapshot) => {
    setPresentation(snapshot.presentationActive || snapshot.nativeActive);
  }), []);

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    showToolbar();
    return () => {
      if (hideTimerRef.current !== null) window.clearTimeout(hideTimerRef.current);
    };
  }, [showToolbar, workspace.activePageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (event.isComposing || event.keyCode === 229)) return;
      if (event.key === "Escape") {
        if (editing || shortcutsOpen || importPreview || overlay || panel) closeTransientUi();
        else if (presentation) void exitPresentation();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        showToolbar();
        return;
      }
      if (editing || shortcutsOpen || importPreview || overlay || panel) return;
      const key = event.key.toLowerCase();
      if (key === "e" || event.key === "Enter") {
        event.preventDefault();
        setEditing(true);
      } else if (key === "b") {
        dispatchWorkspace({ type: "page/toggle-bold", pageId: page.id });
      } else if (key === "m") {
        dispatchWorkspace({
          type: "page/set-marquee-enabled",
          pageId: page.id,
          enabled: !page.marquee.enabled
        });
      } else if (key === "f") {
        event.preventDefault();
        void togglePresentation();
      } else if (event.key === "PageUp") {
        event.preventDefault();
        dispatchWorkspace({ type: "page/previous" });
      } else if (event.key === "PageDown") {
        event.preventDefault();
        dispatchWorkspace({ type: "page/next" });
      }
      showToolbar();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeTransientUi, editing, exitPresentation, importPreview, overlay, page, panel, presentation, shortcutsOpen, showToolbar, togglePresentation]);

  const handleGripPointerDown: JSX.PointerEventHandler<HTMLButtonElement> = (event) => {
    if (window.matchMedia("(max-width: 639px), (max-height: 519px)").matches) return;
    const pointerId = event.pointerId;
    dragStateRef.current = { pointerId };
    event.currentTarget.setPointerCapture(pointerId);
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      dispatchPreferences({
        type: "preferences/set-toolbar-offset",
        offsetRatio: moveEvent.clientX / Math.max(1, window.innerWidth)
      });
      dispatchPreferences({
        type: "preferences/set-toolbar-edge",
        edge: moveEvent.clientY < window.innerHeight / 2 ? "top" : "bottom"
      });
    };
    const onUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== pointerId) return;
      dragStateRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      showToolbar();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const openOverlay = (next: Exclude<Overlay, null>) => {
    setPanel(null);
    if (next === "qr") dispatchWorkspace({ type: "page/ensure-qr-initialized", pageId: page.id });
    setOverlay(next);
  };

  const handleExport = () => {
    try {
      const contents = serializeExport(createExport(workspace, preferences));
      const blob = new Blob([contents], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `modern-text-board-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      notify(t("export.success"));
    } catch {
      notify(locale === "zh-TW" ? "無法匯出備份" : "Could not export backup", true);
    }
  };

  const handleImport = async (file: File) => {
    if (file.size > LIMITS.maxImportFileBytes) {
      notify(t("import.tooLarge"), true);
      return;
    }
    const result = parseImport(await file.text());
    if (!result.success) {
      notify(
        result.error.code === "unsupported_version" ? t("import.unsupported") : t("import.invalid"),
        true
      );
      return;
    }
    setImportPreview(result.data);
  };

  const confirmImport = () => {
    if (!importPreview) return;
    const result = persistence.commitReplacement(importPreview);
    if (!result.success) {
      notify(t("import.invalid"), true);
      return;
    }
    setImportPreview(null);
    setOverlay(null);
    notify(t("import.success"));
  };

  const resetAll = () => {
    const nextLocale: Locale = preferences.locale;
    const nextWorkspace = createDefaultWorkspace(nextLocale);
    const nextPreferences = createDefaultPreferences(nextLocale);
    const result = persistence.commitReplacement(createExport(nextWorkspace, nextPreferences));
    if (!result.success) {
      dispatchWorkspace({ type: "workspace/replace", workspace: nextWorkspace });
      dispatchPreferences({ type: "preferences/replace", preferences: nextPreferences });
      setOverlay(null);
      notify(t("storage.failed"), true);
      return;
    }
    setOverlay(null);
    notify(locale === "zh-TW" ? "已重設" : "Reset complete");
  };

  const colorBackground = page.theme === "dark" ? "#000000" : "#FAFAFC";
  const lowContrast = page.textColor !== "auto" && contrastRatio(page.textColor, colorBackground) < 4.5;
  const pwaSettings: SettingsPwaStatus = {
    online: pwa.online,
    install: pwa.installPhase,
    offline: pwa.offlineReady ? "ready" : pwa.supported ? "preparing" : "unavailable",
    update: pwa.phase === "updating" ? "updating" : pwa.updateAvailable ? "available" : pwa.supported ? "current" : "unavailable"
  };
  const paused = preferences.pauseAnimations || editing || documentHidden;
  const pwaBannerVisible = !presentation && pwa.phase !== "idle" && pwa.phase !== "ready";
  const shellClass = [
    "app-shell",
    !presentation && preferences.toolbar.edge === "top" ? "toolbar-at-top" : null,
    pwaBannerVisible ? "has-pwa-banner" : null
  ].filter(Boolean).join(" ");

  return (
    <div class={shellClass} onPointerDown={showToolbar}>
      <BoardCanvas
        editHint={locale === "zh-TW" ? "雙擊畫面編輯文字" : "Double-click the board to edit"}
        onEdit={() => setEditing(true)}
        onFitChange={(size, overflow) => {
          setEffectiveSize(size);
          setFitOverflow(overflow);
        }}
        onInteraction={showToolbar}
        onNext={() => dispatchWorkspace({ type: "page/next" })}
        onPrevious={() => dispatchWorkspace({ type: "page/previous" })}
        page={page}
        paused={paused}
        placeholder={t("canvas.placeholder")}
        presentation={presentation}
        qrError={t("qr.generateFailed")}
      />

      {!presentation ? (
        <>
          <span class="save-indicator is-error" hidden={!persistence.saveFailed} role="alert">
            {t("storage.failed")}
          </span>
          <span class="page-indicator" aria-live="polite">
            {t("pages.pageCount", { current: pageIndex + 1, total: workspace.pages.length })}
          </span>
          <Toolbar
            activePanel={panel}
            bold={page.fontWeight >= 700}
            edge={preferences.toolbar.edge}
            hidden={toolbarHidden}
            locale={locale}
            marqueeEnabled={page.marquee.enabled}
            offsetRatio={preferences.toolbar.offsetRatio}
            onGripPointerDown={handleGripPointerDown}
            onToggleBold={() => dispatchWorkspace({ type: "page/toggle-bold", pageId: page.id })}
            onTogglePanel={(kind) => {
              setOverlay(null);
              setPanel((current) => current === kind ? null : kind);
            }}
            onToggleTheme={() => dispatchWorkspace({
              type: "page/set-theme",
              pageId: page.id,
              theme: page.theme === "dark" ? "light" : "dark"
            })}
            theme={page.theme}
          />
          <ToolPanels
            align={{
              textAlign: page.textAlign,
              onTextAlignChange: (textAlign) => dispatchWorkspace({ type: "page/set-text-align", pageId: page.id, textAlign })
            }}
            color={{
              textColor: page.textColor,
              customColorDraft,
              customColorError,
              lowContrast,
              onTextColorChange: (color) => dispatchWorkspace({ type: "page/set-text-color", pageId: page.id, color }),
              onCustomColorDraftChange: (value) => {
                setCustomColorDraft(value.toUpperCase());
                setCustomColorError(undefined);
              },
              onCustomColorApply: () => {
                if (/^#[0-9A-F]{6}$/i.test(customColorDraft)) {
                  dispatchWorkspace({ type: "page/set-text-color", pageId: page.id, color: customColorDraft });
                  setCustomColorError(undefined);
                } else setCustomColorError(t("color.invalidHex"));
              }
            }}
            edge={preferences.toolbar.edge}
            offsetRatio={preferences.toolbar.offsetRatio}
            font={{
              fontFamily: page.fontFamily,
              maxFontSizePx: page.maxFontSizePx,
              effectiveFontSizePx: effectiveSize,
              fontWeight: page.fontWeight,
              fitOverflow,
              onFontFamilyChange: (fontFamily) => dispatchWorkspace({ type: "page/set-font-family", pageId: page.id, fontFamily }),
              onFontSizeChange: (sizePx) => dispatchWorkspace({ type: "page/set-font-size", pageId: page.id, sizePx }),
              onFontWeightChange: (fontWeight) => dispatchWorkspace({ type: "page/set-font-weight", pageId: page.id, fontWeight })
            }}
            kind={panel}
            locale={locale}
            marquee={{
              enabled: page.marquee.enabled,
              direction: page.marquee.direction,
              speed: page.marquee.speed,
              onEnabledChange: (enabled) => dispatchWorkspace({ type: "page/set-marquee-enabled", pageId: page.id, enabled }),
              onDirectionChange: (direction) => dispatchWorkspace({ type: "page/set-marquee-direction", pageId: page.id, direction }),
              onSpeedChange: (speed) => dispatchWorkspace({ type: "page/set-marquee-speed", pageId: page.id, speed })
            }}
            more={{
              mirrored: page.mirrored,
              flashEnabled: page.flashEnabled,
              qrEnabled: page.qr.enabled,
              pageCount: workspace.pages.length,
              presenting: presentation,
              onMirroredChange: (mirrored) => dispatchWorkspace({ type: "page/set-mirrored", pageId: page.id, mirrored }),
              onFlashEnabledChange: (enabled) => dispatchWorkspace({ type: "page/set-flash-enabled", pageId: page.id, enabled }),
              onOpenQr: () => openOverlay("qr"),
              onOpenPages: () => openOverlay("pages"),
              onTogglePresentation: () => void togglePresentation(),
              onOpenSettings: () => openOverlay("settings")
            }}
            onClose={closePanel}
          />
        </>
      ) : null}

      {overlay ? (
        <OverlayFrame
          edge={preferences.toolbar.edge}
          labelledBy={overlay === "qr" ? "qr-panel-title" : overlay === "pages" ? "pages-panel-title" : "settings-panel-title"}
          offsetRatio={preferences.toolbar.offsetRatio}
          onClose={closeOverlay}
        >
          {overlay === "qr" ? (
            <QrPanel
              enabled={page.qr.enabled}
              locale={locale}
              onClose={closeOverlay}
              onEnabledChange={(enabled) => dispatchWorkspace({ type: "page/set-qr-enabled", pageId: page.id, enabled })}
              onPayloadChange={(payload) => dispatchWorkspace({ type: "page/set-qr-payload", pageId: page.id, payload })}
              payload={page.qr.payload}
            />
          ) : null}
          {overlay === "pages" ? (
            <PageManager
              activePageId={workspace.activePageId}
              locale={locale}
              maxPages={LIMITS.maxPages}
              onAdd={() => dispatchWorkspace({ type: "page/add", id: createId(), name: t("pages.defaultName", { number: workspace.pages.length + 1 }) })}
              onClose={closeOverlay}
              onDelete={(pageId) => dispatchWorkspace({ type: "page/delete", pageId })}
              onDuplicate={(pageId, name) => dispatchWorkspace({ type: "page/duplicate", pageId, id: createId(), name })}
              onMove={(pageId, toIndex) => dispatchWorkspace({ type: "page/move", pageId, toIndex })}
              onNext={() => dispatchWorkspace({ type: "page/next" })}
              onPrevious={() => dispatchWorkspace({ type: "page/previous" })}
              onRename={(pageId, name) => dispatchWorkspace({ type: "page/rename", pageId, name })}
              onSelect={(pageId) => dispatchWorkspace({ type: "page/set-active", pageId })}
              pages={workspace.pages}
            />
          ) : null}
          {overlay === "settings" ? (
            <SettingsPanel
              appVersion="1.0.0"
              keepScreenAwake={preferences.keepScreenAwake}
              locale={locale}
              onApplyPwaUpdate={() => void pwa.applyUpdate()}
              onClose={closeOverlay}
              onExport={handleExport}
              onImport={(file) => void handleImport(file)}
              onInstallPwa={() => void pwa.install()}
              onKeepScreenAwakeChange={(keepScreenAwake) => dispatchPreferences({ type: "preferences/set-keep-awake", keepScreenAwake })}
              onLocaleChange={(nextLocale) => dispatchPreferences({ type: "preferences/set-locale", locale: nextLocale })}
              onPauseAnimationsChange={(pauseAnimations) => dispatchPreferences({ type: "preferences/set-pause-animations", pauseAnimations })}
              onReset={resetAll}
              onShowShortcuts={() => setShortcutsOpen(true)}
              onToolbarAutoHideChange={(autoHide) => dispatchPreferences({ type: "preferences/set-toolbar-auto-hide", autoHide })}
              pauseAnimations={preferences.pauseAnimations}
              pwaStatus={pwaSettings}
              storageError={!persistence.persistenceEnabled ? t("storage.corrupt") : persistence.saveFailed ? t("storage.failed") : null}
              storageMode={!persistence.persistenceEnabled || persistence.saveFailed ? "memory" : "local"}
              toolbarAutoHide={preferences.toolbar.autoHide}
              wakeLockStatus={wakeLock}
            />
          ) : null}
        </OverlayFrame>
      ) : null}

      {editing ? (
        <TextEditor
          effectiveFontSizePx={effectiveSize}
          fitOverflow={fitOverflow}
          locale={locale}
          maxCodePoints={LIMITS.maxTextCodePoints}
          maxFontSizePx={page.maxFontSizePx}
          onApply={(text) => {
            dispatchWorkspace({ type: "page/set-text", pageId: page.id, text });
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          text={page.text}
        />
      ) : null}
      {presentation ? (
        <button
          class="presentation-exit"
          type="button"
          onClick={() => void exitPresentation()}
        >
          {locale === "zh-TW" ? "退出展示" : "Exit presentation"}
        </button>
      ) : null}
      {shortcutsOpen ? <ShortcutHelp locale={locale} onClose={() => setShortcutsOpen(false)} /> : null}
      {importPreview ? (
        <ImportPreview
          data={importPreview}
          locale={locale}
          onCancel={() => setImportPreview(null)}
          onConfirm={confirmImport}
        />
      ) : null}
      {persistence.workspaceStatus.status === "conflict" ? (
        <div class="toast-stack">
          <div class="toast" role="alert">
            {t("storage.conflict")}
            <div class="toast-actions">
              <button class="secondary-button" type="button" onClick={() => persistence.resolveConflict("remote")}>{t("storage.useRemote")}</button>
              <button class="primary-button" type="button" onClick={() => persistence.resolveConflict("local")}>{t("storage.keepLocal")}</button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div class="toast-stack">
          <div class={`toast ${toast.error ? "is-error" : ""}`} role={toast.error ? "alert" : "status"}>{toast.message}</div>
        </div>
      ) : null}
      {!presentation ? <PwaStatus locale={locale} status={pwa} /> : null}
    </div>
  );
}
