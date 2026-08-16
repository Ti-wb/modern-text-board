import type { JSX } from "preact";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "preact/hooks";

import { BoardCanvas } from "./components/BoardCanvas";
import { MarqueeLabSwitcher } from "./components/MarqueeLabSwitcher";
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
import type { Locale } from "./domain/types";
import type { MarqueeMotionController } from "./hooks/useMarqueeMotion";
import {
  isMarqueeLabVisible,
  replaceMarqueeEngineInUrl,
  resolveMarqueeEngine,
  type MarqueeEngineKind,
} from "./marquee/engine";
import { applyDocumentLocale, getTranslator, resolveLocale } from "./i18n";
import {
  exitPresentationFullscreen,
  requestPresentationFullscreen,
  subscribeFullscreen,
  usePwaStatus,
  useWakeLock
} from "./platform";

type Overlay = "qr" | "pages" | "settings" | null;

const TOOLBAR_IDLE_DELAY_MS = 10_000;

interface ViewportMetrics {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ToolbarDragState {
  pointerId: number;
  pointerOffsetX: number;
  pointerOffsetY: number;
  grip: HTMLButtonElement;
  shell: HTMLElement;
  offsetRatio: number;
  verticalOffsetRatio: number;
  previewFrame: number | null;
  applyPreview: () => void;
  onMove: (event: PointerEvent) => void;
  onEnd: (event: PointerEvent) => void;
}

function getViewportMetrics(): ViewportMetrics {
  const viewport = window.visualViewport;
  return {
    top: Math.max(0, viewport?.offsetTop ?? 0),
    left: Math.max(0, viewport?.offsetLeft ?? 0),
    width: Math.max(1, viewport?.width ?? window.innerWidth),
    height: Math.max(1, viewport?.height ?? window.innerHeight),
  };
}

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
    return {
      workspace: createDefaultWorkspace(locale),
      preferences: createDefaultPreferences(locale),
    };
  }, []);
  const [workspace, dispatchWorkspace] = useReducer(workspaceReducer, initial.workspace);
  const [preferences, dispatchPreferences] = useReducer(preferencesReducer, initial.preferences);
  const [panel, setPanel] = useState<ToolPanelKind | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [editing, setEditing] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [presentation, setPresentation] = useState(false);
  const [effectiveSize, setEffectiveSize] = useState(80);
  const [maxFittingSize, setMaxFittingSize] = useState(80);
  const [fillReferenceSize, setFillReferenceSize] = useState(80);
  const [fitOverflow, setFitOverflow] = useState(false);
  const [customColorDraft, setCustomColorDraft] = useState("#007AFF");
  const [customColorError, setCustomColorError] = useState<string | undefined>();
  const [toolbarIdle, setToolbarIdle] = useState(false);
  const [toolbarDragging, setToolbarDragging] = useState(false);
  const [toolbarHovered, setToolbarHovered] = useState(false);
  const [toolbarFocused, setToolbarFocused] = useState(false);
  const [viewport, setViewport] = useState<ViewportMetrics>(getViewportMetrics);
  const [documentHidden, setDocumentHidden] = useState(document.visibilityState === "hidden");
  const [marqueeEngine, setMarqueeEngine] = useState(resolveMarqueeEngine);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const idleTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<ToolbarDragState | null>(null);
  const marqueeControllerRef = useRef<MarqueeMotionController>(null);
  const toolbarIdleBlockedRef = useRef(false);
  const viewportRef = useRef(viewport);
  const page = getActivePage(workspace);
  const pageIndex = workspace.pages.findIndex((item) => item.id === page.id);
  const locale = preferences.locale;
  const t = useMemo(() => getTranslator(locale), [locale]);
  const pwa = usePwaStatus();
  const marqueeLabVisible = useMemo(() => isMarqueeLabVisible(), []);
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
    else if (overlay) setOverlay(null);
    else if (panel) setPanel(null);
  }, [editing, overlay, panel, shortcutsOpen]);
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

  const toolbarIdleBlocked =
    editing ||
    panel !== null ||
    overlay !== null ||
    shortcutsOpen ||
    presentation ||
    toolbarDragging ||
    toolbarHovered ||
    toolbarFocused ||
    documentHidden;
  useLayoutEffect(() => {
    toolbarIdleBlockedRef.current = toolbarIdleBlocked;
  }, [toolbarIdleBlocked]);

  const activateToolbar = useCallback(() => {
    if (idleTimerRef.current !== null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    setToolbarIdle(false);
    if (toolbarIdleBlockedRef.current) return;
    idleTimerRef.current = window.setTimeout(() => {
      idleTimerRef.current = null;
      if (
        !dragStateRef.current &&
        !document.querySelector(".toolbar-shell")?.matches(":focus-within")
      ) {
        setToolbarIdle(true);
      }
    }, TOOLBAR_IDLE_DELAY_MS);
  }, []);

  useEffect(() => {
    applyDocumentLocale(locale);
    document.title = t("app.name");
  }, [locale, t]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const updateVisualViewport = () => {
      const next = getViewportMetrics();
      viewportRef.current = next;
      setViewport((current) =>
        current.top === next.top &&
        current.left === next.left &&
        current.width === next.width &&
        current.height === next.height
          ? current
          : next
      );
      document.documentElement.style.setProperty("--visual-viewport-height", `${next.height}px`);
      document.documentElement.style.setProperty("--visual-viewport-width", `${next.width}px`);
      document.documentElement.style.setProperty("--visual-viewport-top", `${next.top}px`);
      document.documentElement.style.setProperty("--visual-viewport-left", `${next.left}px`);
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

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => subscribeFullscreen((snapshot) => {
    setPresentation(snapshot.presentationActive || snapshot.nativeActive);
  }), []);

  useEffect(() => {
    const onVisibility = () => setDocumentHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useEffect(() => {
    activateToolbar();
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, [activateToolbar, toolbarIdleBlocked, workspace.activePageId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      activateToolbar();
      if (event.key === "Escape" && (event.isComposing || event.keyCode === 229)) return;
      if (event.key === "Escape") {
        if (editing || shortcutsOpen || overlay || panel) closeTransientUi();
        else if (presentation) void exitPresentation();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      if (editing || shortcutsOpen || overlay || panel) return;
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
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activateToolbar, closeTransientUi, editing, exitPresentation, overlay, page, panel, presentation, shortcutsOpen, togglePresentation]);

  const finishToolbarDrag = useCallback((pointerId?: number) => {
    const drag = dragStateRef.current;
    if (!drag || (pointerId !== undefined && drag.pointerId !== pointerId)) return;
    if (drag.previewFrame !== null) cancelAnimationFrame(drag.previewFrame);
    drag.applyPreview();
    dragStateRef.current = null;
    window.removeEventListener("pointermove", drag.onMove);
    window.removeEventListener("pointerup", drag.onEnd);
    window.removeEventListener("pointercancel", drag.onEnd);
    try {
      if (drag.grip.hasPointerCapture?.(drag.pointerId)) {
        drag.grip.releasePointerCapture(drag.pointerId);
      }
    } catch {
      // Pointer capture may already be released by the browser.
    }
    dispatchPreferences({
      type: "preferences/set-toolbar-position",
      offsetRatio: drag.offsetRatio,
      verticalOffsetRatio: drag.verticalOffsetRatio,
    });
    setToolbarDragging(false);
    setToolbarIdle(false);
  }, []);

  useEffect(() => () => {
    const drag = dragStateRef.current;
    if (!drag) return;
    if (drag.previewFrame !== null) cancelAnimationFrame(drag.previewFrame);
    window.removeEventListener("pointermove", drag.onMove);
    window.removeEventListener("pointerup", drag.onEnd);
    window.removeEventListener("pointercancel", drag.onEnd);
  }, []);

  const openEditor = useCallback(() => setEditing(true), []);
  const showNextPage = useCallback(() => {
    dispatchWorkspace({ type: "page/next" });
  }, []);
  const showPreviousPage = useCallback(() => {
    dispatchWorkspace({ type: "page/previous" });
  }, []);
  const handleFitChange = useCallback((
    size: number,
    overflow: boolean,
    fittingSize: number,
    referenceSize: number,
  ) => {
    setEffectiveSize((current) => current === size ? current : size);
    setMaxFittingSize((current) => current === fittingSize ? current : fittingSize);
    setFillReferenceSize((current) => current === referenceSize ? current : referenceSize);
    setFitOverflow((current) => current === overflow ? current : overflow);
  }, []);
  const previewMarqueeSpeed = useCallback((speed: number) => {
    marqueeControllerRef.current?.previewSpeed(speed);
  }, []);
  const commitMarqueeSpeed = useCallback((speed: number) => {
    dispatchWorkspace({
      type: "page/set-marquee-speed",
      pageId: page.id,
      speed,
    });
  }, [page.id]);

  const handleGripPointerDown: JSX.PointerEventHandler<HTMLButtonElement> = (event) => {
    if (event.button !== 0 || dragStateRef.current) return;
    event.preventDefault();
    activateToolbar();
    const shell = event.currentTarget.closest<HTMLElement>(".toolbar-shell");
    if (!shell) return;
    const bounds = shell.getBoundingClientRect();

    const pointerId = event.pointerId;
    const grip = event.currentTarget;
    const pointerOffsetX = event.clientX - (bounds.left + bounds.width / 2);
    const pointerOffsetY = event.clientY - (bounds.top + bounds.height / 2);
    const applyPreview = () => {
      const drag = dragStateRef.current;
      if (!drag || drag.pointerId !== pointerId) return;
      drag.previewFrame = null;
      const currentViewport = viewportRef.current;
      drag.shell.style.setProperty(
        "--toolbar-x",
        `${currentViewport.left + drag.offsetRatio * currentViewport.width}px`,
      );
      drag.shell.style.setProperty(
        "--toolbar-y",
        `${currentViewport.top + drag.verticalOffsetRatio * currentViewport.height}px`,
      );
    };
    const onMove = (moveEvent: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag || moveEvent.pointerId !== drag.pointerId) return;
      moveEvent.preventDefault();
      const currentViewport = viewportRef.current;
      drag.offsetRatio = Math.min(
        1,
        Math.max(
          0,
          (moveEvent.clientX - drag.pointerOffsetX - currentViewport.left) /
            currentViewport.width,
        ),
      );
      drag.verticalOffsetRatio = Math.min(
        1,
        Math.max(
          0,
          (moveEvent.clientY - drag.pointerOffsetY - currentViewport.top) /
            currentViewport.height,
        ),
      );
      if (drag.previewFrame === null) {
        drag.previewFrame = requestAnimationFrame(drag.applyPreview);
      }
    };
    const onEnd = (endEvent: PointerEvent) => {
      finishToolbarDrag(endEvent.pointerId);
    };

    dragStateRef.current = {
      pointerId,
      pointerOffsetX,
      pointerOffsetY,
      grip,
      shell,
      offsetRatio: preferences.toolbar.offsetRatio,
      verticalOffsetRatio: preferences.toolbar.verticalOffsetRatio,
      previewFrame: null,
      applyPreview,
      onMove,
      onEnd,
    };
    setToolbarDragging(true);
    try {
      grip.setPointerCapture(pointerId);
    } catch {
      // Capture is an enhancement; window listeners still complete the drag.
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  };

  const openOverlay = (next: Exclude<Overlay, null>) => {
    setPanel(null);
    if (next === "qr") dispatchWorkspace({ type: "page/ensure-qr-initialized", pageId: page.id });
    setOverlay(next);
  };

  const resetAll = () => {
    const nextLocale: Locale = preferences.locale;
    const nextWorkspace = createDefaultWorkspace(nextLocale);
    const nextPreferences = createDefaultPreferences(nextLocale);
    dispatchWorkspace({ type: "workspace/replace", workspace: nextWorkspace });
    dispatchPreferences({ type: "preferences/replace", preferences: nextPreferences });
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
  const toolbarPositionX =
    viewport.left + preferences.toolbar.offsetRatio * viewport.width;
  const toolbarPositionY =
    viewport.top + preferences.toolbar.verticalOffsetRatio * viewport.height;
  const panelEdge =
    preferences.toolbar.verticalOffsetRatio < 0.5 ? "top" : "bottom";
  const shellClass = [
    "app-shell",
    pwaBannerVisible ? "has-pwa-banner" : null,
    page.marquee.enabled && !paused ? "has-active-marquee" : null,
  ].filter(Boolean).join(" ");

  const changeMarqueeEngine = useCallback((engine: MarqueeEngineKind) => {
    replaceMarqueeEngineInUrl(engine);
    setMarqueeEngine(engine);
  }, []);

  return (
    <div class={shellClass} data-marquee-engine={marqueeEngine} onPointerDown={activateToolbar}>
      <BoardCanvas
        editHint={locale === "zh-TW" ? "雙擊畫面編輯文字" : "Double-click the board to edit"}
        marqueeControllerRef={marqueeControllerRef}
        marqueeEngine={marqueeEngine}
        onEdit={openEditor}
        onFitChange={handleFitChange}
        onNext={showNextPage}
        onPrevious={showPreviousPage}
        page={page}
        paused={paused}
        placeholder={t("canvas.placeholder")}
        presentation={presentation}
        qrError={t("qr.generateFailed")}
      />

      {marqueeLabVisible && !presentation ? (
        <MarqueeLabSwitcher engine={marqueeEngine} onChange={changeMarqueeEngine} />
      ) : null}

      {!presentation ? (
        <>
          <span class="page-indicator" aria-live="polite">
            {t("pages.pageCount", { current: pageIndex + 1, total: workspace.pages.length })}
          </span>
          <Toolbar
            activePanel={panel}
            bold={page.fontWeight >= 700}
            dragging={toolbarDragging}
            idle={toolbarIdle}
            locale={locale}
            marqueeEnabled={page.marquee.enabled}
            onActivate={activateToolbar}
            onFocusChange={setToolbarFocused}
            onGripPointerDown={handleGripPointerDown}
            onGripLostPointerCapture={(event) => finishToolbarDrag(event.pointerId)}
            onHoverChange={setToolbarHovered}
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
            positionX={toolbarPositionX}
            positionY={toolbarPositionY}
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
            edge={panelEdge}
            offsetRatio={preferences.toolbar.offsetRatio}
            font={{
              fontFamily: page.fontFamily,
              fontScalePercent: page.fontScalePercent,
              legacyMaxFontSizePx: page.maxFontSizePx,
              fillReferenceFontSizePx: fillReferenceSize,
              maxFittingFontSizePx: maxFittingSize,
              effectiveFontSizePx: effectiveSize,
              fontWeight: page.fontWeight,
              fitOverflow,
              onFontFamilyChange: (fontFamily) => dispatchWorkspace({ type: "page/set-font-family", pageId: page.id, fontFamily }),
              onFontScaleChange: (percent) => dispatchWorkspace({
                type: "page/set-font-scale",
                pageId: page.id,
                percent,
              }),
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
              onSpeedPreview: previewMarqueeSpeed,
              onSpeedCommit: commitMarqueeSpeed,
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
          edge={panelEdge}
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
              appVersion="1.1.0"
              keepScreenAwake={preferences.keepScreenAwake}
              locale={locale}
              onApplyPwaUpdate={() => void pwa.applyUpdate()}
              onClose={closeOverlay}
              onInstallPwa={() => void pwa.install()}
              onKeepScreenAwakeChange={(keepScreenAwake) => dispatchPreferences({ type: "preferences/set-keep-awake", keepScreenAwake })}
              onLocaleChange={(nextLocale) => dispatchPreferences({ type: "preferences/set-locale", locale: nextLocale })}
              onPauseAnimationsChange={(pauseAnimations) => dispatchPreferences({ type: "preferences/set-pause-animations", pauseAnimations })}
              onReset={resetAll}
              onShowShortcuts={() => setShortcutsOpen(true)}
              pauseAnimations={preferences.pauseAnimations}
              pwaStatus={pwaSettings}
              wakeLockStatus={wakeLock}
            />
          ) : null}
        </OverlayFrame>
      ) : null}

      {editing ? (
        <TextEditor
          effectiveFontSizePx={effectiveSize}
          fontScalePercent={page.fontScalePercent}
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
      {toast ? (
        <div class="toast-stack">
          <div class={`toast ${toast.error ? "is-error" : ""}`} role={toast.error ? "alert" : "status"}>{toast.message}</div>
        </div>
      ) : null}
      {!presentation ? <PwaStatus locale={locale} status={pwa} /> : null}
    </div>
  );
}
