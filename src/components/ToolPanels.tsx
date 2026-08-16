import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { LIMITS, clamp } from "../domain/defaults";
import { speedToPixelsPerSecond } from "../hooks/useMarqueeMotion";
import type {
  FontFamily,
  FontWeight,
  Locale,
  MarqueeDirection,
  TextAlign,
  ToolbarEdge,
} from "../domain/types";
import { Icon, type IconName } from "./Icon";
import type { ToolPanelKind } from "./Toolbar";

export interface FontPanelControls {
  fontFamily: FontFamily;
  fontScalePercent: number | null;
  legacyMaxFontSizePx: number;
  fillReferenceFontSizePx: number;
  maxFittingFontSizePx: number;
  effectiveFontSizePx: number;
  fontWeight: FontWeight;
  fitOverflow: boolean;
  onFontFamilyChange: (fontFamily: FontFamily) => void;
  onFontScaleChange: (percent: number) => void;
  onFontWeightChange: (fontWeight: FontWeight) => void;
}

export interface ColorPanelControls {
  textColor: "auto" | string;
  customColorDraft: string;
  lowContrast: boolean;
  customColorError?: string;
  onTextColorChange: (color: "auto" | string) => void;
  onCustomColorDraftChange: (value: string) => void;
  onCustomColorApply: () => void;
}

export interface AlignPanelControls {
  textAlign: TextAlign;
  onTextAlignChange: (textAlign: TextAlign) => void;
}

export interface MarqueePanelControls {
  enabled: boolean;
  direction: MarqueeDirection;
  speed: number;
  onEnabledChange: (enabled: boolean) => void;
  onDirectionChange: (direction: MarqueeDirection) => void;
  onSpeedPreview: (speed: number) => void;
  onSpeedCommit: (speed: number) => void;
}

export interface MorePanelControls {
  mirrored: boolean;
  flashEnabled: boolean;
  qrEnabled: boolean;
  pageCount: number;
  presenting: boolean;
  onMirroredChange: (mirrored: boolean) => void;
  onFlashEnabledChange: (enabled: boolean) => void;
  onOpenQr: () => void;
  onOpenPages: () => void;
  onTogglePresentation: () => void;
  onOpenSettings: () => void;
}

export interface ToolPanelsProps {
  locale: Locale;
  kind: ToolPanelKind | null;
  edge: ToolbarEdge;
  offsetRatio: number;
  onClose: () => void;
  font: FontPanelControls;
  color: ColorPanelControls;
  align: AlignPanelControls;
  marquee: MarqueePanelControls;
  more: MorePanelControls;
}

const COPY = {
  "zh-TW": {
    close: "關閉",
    fontTitle: "字型與字級",
    fontFamily: "系統字型",
    fontSize: "畫面填滿程度",
    configured: "填滿",
    effective: "實際顯示",
    overflow: "即使縮至安全字級仍無法完整顯示，建議精簡文字。",
    fontWeight: "字重",
    sans: "系統黑體",
    rounded: "系統圓體",
    serif: "系統明／襯線體",
    mono: "系統等寬體",
    light: "細體",
    regular: "標準",
    bold: "粗體",
    black: "特粗",
    colorTitle: "文字顏色",
    autoContrast: "自動對比",
    basic: "Basic",
    neon: "Neon",
    pastel: "Pastel",
    customColor: "自訂顏色",
    colorPicker: "開啟色彩選擇器",
    hexPlaceholder: "#007AFF",
    apply: "套用",
    lowContrast: "目前文字色與背景對比較低，遠距離可能不易閱讀。",
    alignTitle: "文字對齊",
    left: "靠左",
    center: "置中",
    right: "靠右",
    marqueeTitle: "跑馬燈",
    marqueeEnabled: "啟用跑馬燈",
    direction: "方向",
    directionLeft: "向左",
    directionRight: "向右",
    directionUp: "向上",
    directionDown: "向下",
    speed: "速度",
    speedValue: (speed: number) => `${Math.round(speedToPixelsPerSecond(speed))} px/s`,
    speedAria: (speed: number) => `每秒 ${Math.round(speedToPixelsPerSecond(speed))} 像素`,
    animationNote: "跑馬燈可與閃爍同時播放；可在設定暫停所有動態。",
    moreTitle: "更多工具",
    mirror: "鏡像文字",
    mirrorHint: "適合從鏡面或前鏡頭觀看",
    flash: "柔和閃爍",
    flashHint: "約兩秒一次的透明度循環",
    qr: "QR Code",
    qrHint: "內容可獨立於白板文字編輯",
    pages: "頁面管理",
    pagesValue: (count: number) => `${count} 頁`,
    fullscreen: "全螢幕展示",
    fullscreenHint: "瀏覽器不支援時仍會進入展示模式",
    settings: "設定",
    settingsHint: "語言、常亮、離線與快捷鍵",
    on: "開啟",
    off: "關閉",
    enter: "進入",
    exit: "退出",
  },
  en: {
    close: "Close",
    fontTitle: "Font & size",
    fontFamily: "System font",
    fontSize: "Screen fill",
    configured: "Fill",
    effective: "Displayed",
    overflow: "The text still does not fit at a safe size. Try shortening it.",
    fontWeight: "Weight",
    sans: "System sans",
    rounded: "System rounded",
    serif: "System serif",
    mono: "System mono",
    light: "Light",
    regular: "Regular",
    bold: "Bold",
    black: "Black",
    colorTitle: "Text color",
    autoContrast: "Automatic contrast",
    basic: "Basic",
    neon: "Neon",
    pastel: "Pastel",
    customColor: "Custom color",
    colorPicker: "Open color picker",
    hexPlaceholder: "#007AFF",
    apply: "Apply",
    lowContrast: "This color has low contrast with the background and may be hard to read at a distance.",
    alignTitle: "Text alignment",
    left: "Left",
    center: "Center",
    right: "Right",
    marqueeTitle: "Marquee",
    marqueeEnabled: "Enable marquee",
    direction: "Direction",
    directionLeft: "Left",
    directionRight: "Right",
    directionUp: "Up",
    directionDown: "Down",
    speed: "Speed",
    speedValue: (speed: number) => `${Math.round(speedToPixelsPerSecond(speed))} px/s`,
    speedAria: (speed: number) => `${Math.round(speedToPixelsPerSecond(speed))} pixels per second`,
    animationNote: "Marquee and flash can play together. Pause all motion in Settings.",
    moreTitle: "More tools",
    mirror: "Mirror text",
    mirrorHint: "Useful through a mirror or front-facing camera",
    flash: "Gentle flash",
    flashHint: "A soft opacity cycle about every two seconds",
    qr: "QR Code",
    qrHint: "Edited independently from the board text",
    pages: "Manage pages",
    pagesValue: (count: number) => `${count} ${count === 1 ? "page" : "pages"}`,
    fullscreen: "Full-screen presentation",
    fullscreenHint: "Presentation mode still works if browser fullscreen is unavailable",
    settings: "Settings",
    settingsHint: "Language, wake lock, offline use, and shortcuts",
    on: "On",
    off: "Off",
    enter: "Enter",
    exit: "Exit",
  },
} as const;

type Copy = (typeof COPY)[Locale];

const FONT_OPTIONS: Array<{ value: FontFamily; label: keyof Pick<Copy, "sans" | "rounded" | "serif" | "mono"> }> = [
  { value: "system-sans", label: "sans" },
  { value: "system-rounded", label: "rounded" },
  { value: "system-serif", label: "serif" },
  { value: "system-mono", label: "mono" },
];

const WEIGHTS: Array<{ value: FontWeight; label: keyof Pick<Copy, "light" | "regular" | "bold" | "black"> }> = [
  { value: 300, label: "light" },
  { value: 400, label: "regular" },
  { value: 700, label: "bold" },
  { value: 900, label: "black" },
];

const COLOR_GROUPS = [
  {
    label: "basic" as const,
    values: ["#FFFFFF", "#1C1C1E", "#FF3B30", "#FF9500", "#FFCC00", "#34C759"],
  },
  {
    label: "neon" as const,
    values: ["#00FFFF", "#39FF14", "#FF10F0", "#FFF01F", "#FF5F1F", "#BC13FE"],
  },
  {
    label: "pastel" as const,
    values: ["#FFB3BA", "#FFDFBA", "#FFFFBA", "#BAFFC9", "#BAE1FF", "#D7BAFF"],
  },
] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

function PanelFrame({
  kind,
  edge,
  offsetRatio,
  title,
  closeLabel,
  wide = false,
  onClose,
  children,
}: {
  kind: ToolPanelKind;
  edge: ToolbarEdge;
  offsetRatio: number;
  title: string;
  closeLabel: string;
  wide?: boolean;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = `tool-panel-${kind}-title`;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (event.isComposing || event.keyCode === 229)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <>
      <div aria-hidden="true" class="panel-scrim" onClick={onClose} />
      <div class={`tool-panel-wrap edge-${edge}`} style={`--toolbar-offset: ${offsetRatio}`}>
        <section
          aria-labelledby={titleId}
          aria-modal="true"
          class={`tool-panel${wide ? " wide" : ""}`}
          data-panel-kind={kind}
          id={`tool-panel-${kind}`}
          ref={dialogRef}
          role="dialog"
        >
          <header class="panel-header">
            <h2 class="panel-title" id={titleId}>{title}</h2>
            <button class="panel-close" onClick={onClose} type="button">{closeLabel}</button>
          </header>
          {children}
        </section>
      </div>
    </>
  );
}

function FontPanel({ controls, copy }: { controls: FontPanelControls; copy: Copy }) {
  const derivedPercent = clamp(
    Math.round(
      (controls.legacyMaxFontSizePx /
        Math.max(1, controls.fillReferenceFontSizePx)) *
        100,
    ),
    LIMITS.minFontScalePercent,
    LIMITS.maxFontScalePercent,
  );
  const scalePercent = controls.fontScalePercent ?? derivedPercent;

  return (
    <>
      <span class="section-label">{copy.fontFamily}</span>
      <ul class="font-list">
        {FONT_OPTIONS.map((option) => {
          const selected = option.value === controls.fontFamily;
          return (
            <li key={option.value}>
              <button
                aria-pressed={selected}
                class={`font-option font-${option.value}${selected ? " is-selected" : ""}`}
                onClick={() => controls.onFontFamilyChange(option.value)}
                type="button"
              >
                <span>{copy[option.label]}</span>
                {selected && <Icon name="check" size={16} />}
              </button>
            </li>
          );
        })}
      </ul>

      <div class="panel-divider" />

      <div class="range-block">
        <label class="range-label" for="font-size-range">
          <span>{copy.fontSize}</span>
          <output aria-hidden="true">{scalePercent}%</output>
        </label>
        <input
          aria-valuemax={LIMITS.maxFontScalePercent}
          aria-valuemin={LIMITS.minFontScalePercent}
          aria-valuenow={scalePercent}
          aria-valuetext={`${scalePercent}% · ${controls.effectiveFontSizePx} px`}
          id="font-size-range"
          max={LIMITS.maxFontScalePercent}
          min={LIMITS.minFontScalePercent}
          onInput={(event) => controls.onFontScaleChange(Number(event.currentTarget.value))}
          step="1"
          style="min-height: 44px"
          type="range"
          value={scalePercent}
        />
        <div class="panel-row">
          <span class="menu-value">{copy.configured}: {scalePercent}%</span>
          <span class="menu-value">{copy.effective}: {controls.effectiveFontSizePx} px</span>
        </div>
        {controls.fitOverflow && <p class="warning-text" role="status">{copy.overflow}</p>}
      </div>

      <span class="section-label">{copy.fontWeight}</span>
      <div class="segmented" role="group" aria-label={copy.fontWeight}>
        {WEIGHTS.map((weight) => (
          <button
            aria-pressed={controls.fontWeight === weight.value}
            class={controls.fontWeight === weight.value ? "is-active" : ""}
            key={weight.value}
            onClick={() => controls.onFontWeightChange(weight.value)}
            style="min-height: 44px"
            type="button"
          >
            <span aria-hidden="true" style={`font-weight: ${weight.value}`}>{weight.value}</span>
            <span class="sr-only">{copy[weight.label]}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ColorPanel({ controls, copy }: { controls: ColorPanelControls; copy: Copy }) {
  const draftValid = HEX_COLOR.test(controls.customColorDraft);
  const pickerValue = draftValid
    ? controls.customColorDraft
    : controls.textColor !== "auto" && HEX_COLOR.test(controls.textColor)
      ? controls.textColor
      : "#007AFF";

  return (
    <>
      <button
        aria-pressed={controls.textColor === "auto"}
        class={`font-option${controls.textColor === "auto" ? " is-selected" : ""}`}
        onClick={() => controls.onTextColorChange("auto")}
        type="button"
      >
        <span>{copy.autoContrast}</span>
        {controls.textColor === "auto" && <Icon name="check" size={16} />}
      </button>

      {COLOR_GROUPS.map((group) => (
        <fieldset key={group.label} style="min-width: 0; margin: 0; padding: 0; border: 0">
          <legend class="section-label">{copy[group.label]}</legend>
          <div style="display: grid; grid-template-columns: repeat(6, minmax(44px, 1fr)); gap: 2px">
            {group.values.map((color) => {
              const selected = controls.textColor.toUpperCase() === color;
              return (
                <button
                  aria-label={color}
                  aria-pressed={selected}
                  class="tool-button"
                  key={color}
                  onClick={() => controls.onTextColorChange(color)}
                  title={color}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    class={`color-chip${selected ? " is-selected" : ""}`}
                    style={`background-color: ${color}`}
                  />
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <span class="section-label">{copy.customColor}</span>
      <form
        class="hex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftValid) controls.onCustomColorApply();
        }}
      >
        <input
          aria-label={copy.colorPicker}
          onInput={(event) => {
            controls.onCustomColorDraftChange(event.currentTarget.value.toUpperCase());
            controls.onTextColorChange(event.currentTarget.value.toUpperCase());
          }}
          type="color"
          value={pickerValue}
        />
        <input
          aria-invalid={!draftValid}
          aria-label="Hex"
          class="text-input"
          inputMode="text"
          maxLength={7}
          onInput={(event) => controls.onCustomColorDraftChange(event.currentTarget.value)}
          placeholder={copy.hexPlaceholder}
          spellcheck={false}
          value={controls.customColorDraft}
        />
        <button class="primary-button" disabled={!draftValid} type="submit">{copy.apply}</button>
      </form>
      {controls.customColorError && <p class="error-text" role="alert">{controls.customColorError}</p>}
      {controls.lowContrast && <p class="warning-text" role="status">{copy.lowContrast}</p>}
    </>
  );
}

function AlignPanel({ controls, copy }: { controls: AlignPanelControls; copy: Copy }) {
  const options: Array<{ value: TextAlign; label: string; symbol: string }> = [
    { value: "left", label: copy.left, symbol: "≡" },
    { value: "center", label: copy.center, symbol: "≡" },
    { value: "right", label: copy.right, symbol: "≡" },
  ];
  return (
    <div class="segmented" role="group" aria-label={copy.alignTitle}>
      {options.map((option) => (
        <button
          aria-label={option.label}
          aria-pressed={controls.textAlign === option.value}
          class={controls.textAlign === option.value ? "is-active" : ""}
          key={option.value}
          onClick={() => controls.onTextAlignChange(option.value)}
          style={`min-height: 44px; text-align: ${option.value}`}
          title={option.label}
          type="button"
        >
          <span aria-hidden="true" style="display: block; width: 22px; margin: auto; font-size: 22px; line-height: 1">{option.symbol}</span>
        </button>
      ))}
    </div>
  );
}

function MarqueePanel({ controls, copy }: { controls: MarqueePanelControls; copy: Copy }) {
  const [draftSpeed, setDraftSpeed] = useState(controls.speed);
  const committedSpeedRef = useRef(controls.speed);
  const pendingSpeedRef = useRef(controls.speed);
  const previewFrameRef = useRef<number | null>(null);
  const previewCallbackRef = useRef(controls.onSpeedPreview);
  useEffect(() => {
    setDraftSpeed(controls.speed);
    committedSpeedRef.current = controls.speed;
    pendingSpeedRef.current = controls.speed;
  }, [controls.speed]);
  useEffect(() => {
    previewCallbackRef.current = controls.onSpeedPreview;
  }, [controls.onSpeedPreview]);
  useEffect(() => () => {
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    // Closing the panel while a pointer gesture is incomplete is a cancel,
    // so return the renderer to the last committed setting.
    previewCallbackRef.current(committedSpeedRef.current);
  }, []);

  const previewSpeed = (value: string) => {
    const speed = Number(value);
    pendingSpeedRef.current = speed;
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const pendingSpeed = pendingSpeedRef.current;
      setDraftSpeed(pendingSpeed);
      previewCallbackRef.current(pendingSpeed);
    });
  };
  const flushSpeedPreview = (speed: number) => {
    if (previewFrameRef.current !== null) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    pendingSpeedRef.current = speed;
    setDraftSpeed(speed);
    previewCallbackRef.current(speed);
  };
  const commitSpeed = (value: string) => {
    const speed = Number(value);
    flushSpeedPreview(speed);
    if (Math.abs(speed - committedSpeedRef.current) < 0.0001) return;
    committedSpeedRef.current = speed;
    controls.onSpeedCommit(speed);
  };
  const cancelSpeed = (input: HTMLInputElement) => {
    const speed = committedSpeedRef.current;
    input.value = String(speed);
    flushSpeedPreview(speed);
  };
  const directions: Array<{ value: MarqueeDirection; label: string; icon: IconName }> = [
    { value: "left", label: copy.directionLeft, icon: "arrow-left" },
    { value: "right", label: copy.directionRight, icon: "arrow-right" },
    { value: "up", label: copy.directionUp, icon: "arrow-up" },
    { value: "down", label: copy.directionDown, icon: "arrow-down" },
  ];

  return (
    <>
      <div class="setting-row">
        <div class="setting-copy"><strong>{copy.marqueeEnabled}</strong></div>
        <button
          aria-label={copy.marqueeEnabled}
          aria-pressed={controls.enabled}
          class={`switch${controls.enabled ? " is-on" : ""}`}
          onClick={() => controls.onEnabledChange(!controls.enabled)}
          type="button"
        />
      </div>

      <span class="section-label">{copy.direction}</span>
      <div class="segmented" role="group" aria-label={copy.direction}>
        {directions.map((direction) => (
          <button
            aria-label={direction.label}
            aria-pressed={controls.direction === direction.value}
            class={controls.direction === direction.value ? "is-active" : ""}
            key={direction.value}
            onClick={() => controls.onDirectionChange(direction.value)}
            style="min-height: 44px"
            title={direction.label}
            type="button"
          >
            <Icon name={direction.icon} />
          </button>
        ))}
      </div>

      <div class="range-block" style="margin-top: 14px">
        <label class="range-label" for="marquee-speed-range">
          <span>{copy.speed}</span>
          <output aria-hidden="true">{copy.speedValue(draftSpeed)}</output>
        </label>
        <div class="range-with-icons">
          <Icon name="turtle" />
          <input
            aria-valuemax={LIMITS.maxMarqueeSpeed}
            aria-valuemin={LIMITS.minMarqueeSpeed}
            aria-valuenow={draftSpeed}
            aria-valuetext={copy.speedAria(draftSpeed)}
            id="marquee-speed-range"
            max={LIMITS.maxMarqueeSpeed}
            min={LIMITS.minMarqueeSpeed}
            onBlur={(event) => commitSpeed(event.currentTarget.value)}
            onChange={(event) => commitSpeed(event.currentTarget.value)}
            onInput={(event) => previewSpeed(event.currentTarget.value)}
            onPointerCancel={(event) => cancelSpeed(event.currentTarget)}
            onPointerUp={(event) => commitSpeed(event.currentTarget.value)}
            step={LIMITS.marqueeSpeedStep}
            style="min-height: 44px"
            type="range"
            value={draftSpeed}
          />
          <Icon name="rabbit" />
        </div>
      </div>
      <p class="field-help">{copy.animationNote}</p>
    </>
  );
}

function MoreToggleRow({
  icon,
  label,
  hint,
  checked,
  onChange,
}: {
  icon: IconName;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <li>
      <button
        aria-pressed={checked}
        class="menu-row"
        onClick={() => onChange(!checked)}
        type="button"
      >
        <span class="menu-label">
          <Icon name={icon} />
          <span class="setting-copy"><strong>{label}</strong><small>{hint}</small></span>
        </span>
        <span aria-hidden="true" class={`switch${checked ? " is-on" : ""}`} />
      </button>
    </li>
  );
}

function MoreActionRow({
  icon,
  label,
  hint,
  value,
  onClick,
}: {
  icon: IconName;
  label: string;
  hint: string;
  value?: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button class="menu-row" onClick={onClick} type="button">
        <span class="menu-label">
          <Icon name={icon} />
          <span class="setting-copy"><strong>{label}</strong><small>{hint}</small></span>
        </span>
        {value && <span class="menu-value">{value}</span>}
      </button>
    </li>
  );
}

function MorePanel({ controls, copy }: { controls: MorePanelControls; copy: Copy }) {
  return (
    <ul class="menu-list">
      <MoreToggleRow
        checked={controls.mirrored}
        hint={copy.mirrorHint}
        icon="mirror"
        label={copy.mirror}
        onChange={controls.onMirroredChange}
      />
      <MoreToggleRow
        checked={controls.flashEnabled}
        hint={copy.flashHint}
        icon="flash"
        label={copy.flash}
        onChange={controls.onFlashEnabledChange}
      />
      <MoreActionRow
        hint={copy.qrHint}
        icon="qr"
        label={copy.qr}
        onClick={controls.onOpenQr}
        value={controls.qrEnabled ? copy.on : copy.off}
      />
      <MoreActionRow
        hint={copy.pages}
        icon="pages"
        label={copy.pages}
        onClick={controls.onOpenPages}
        value={copy.pagesValue(controls.pageCount)}
      />
      <MoreActionRow
        hint={copy.fullscreenHint}
        icon="fullscreen"
        label={copy.fullscreen}
        onClick={controls.onTogglePresentation}
        value={controls.presenting ? copy.exit : copy.enter}
      />
      <MoreActionRow
        hint={copy.settingsHint}
        icon="settings"
        label={copy.settings}
        onClick={controls.onOpenSettings}
      />
    </ul>
  );
}

export function ToolPanels({
  locale,
  kind,
  edge,
  offsetRatio,
  onClose,
  font,
  color,
  align,
  marquee,
  more,
}: ToolPanelsProps) {
  if (!kind) return null;
  const copy = COPY[locale];
  const titles: Record<ToolPanelKind, string> = {
    font: copy.fontTitle,
    color: copy.colorTitle,
    align: copy.alignTitle,
    marquee: copy.marqueeTitle,
    more: copy.moreTitle,
  };

  return (
    <PanelFrame
      closeLabel={copy.close}
      edge={edge}
      offsetRatio={offsetRatio}
      kind={kind}
      onClose={onClose}
      title={titles[kind]}
      wide={kind !== "align"}
    >
      {kind === "font" && <FontPanel controls={font} copy={copy} />}
      {kind === "color" && <ColorPanel controls={color} copy={copy} />}
      {kind === "align" && <AlignPanel controls={align} copy={copy} />}
      {kind === "marquee" && <MarqueePanel controls={marquee} copy={copy} />}
      {kind === "more" && <MorePanel controls={more} copy={copy} />}
    </PanelFrame>
  );
}
