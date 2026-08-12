import type { JSX } from "preact";
import type { Locale, Theme, ToolbarEdge } from "../domain/types";
import { Icon } from "./Icon";

export type ToolPanelKind = "font" | "color" | "align" | "marquee" | "more";

export interface ToolbarProps {
  locale: Locale;
  edge: ToolbarEdge;
  offsetRatio: number;
  hidden?: boolean;
  activePanel: ToolPanelKind | null;
  theme: Theme;
  bold: boolean;
  marqueeEnabled: boolean;
  onToggleTheme: () => void;
  onTogglePanel: (panel: ToolPanelKind) => void;
  onToggleBold: () => void;
  onGripPointerDown?: JSX.PointerEventHandler<HTMLButtonElement>;
}

const COPY = {
  "zh-TW": {
    toolbar: "文字手舉牌工具列",
    move: "拖曳工具列",
    lightTheme: "切換為白底",
    darkTheme: "切換為黑底",
    font: "字型與字級",
    color: "文字顏色",
    align: "文字對齊",
    bold: "粗體",
    marquee: "跑馬燈",
    more: "更多工具",
  },
  en: {
    toolbar: "Text placard toolbar",
    move: "Drag toolbar",
    lightTheme: "Use light background",
    darkTheme: "Use dark background",
    font: "Font and size",
    color: "Text color",
    align: "Text alignment",
    bold: "Bold",
    marquee: "Marquee",
    more: "More tools",
  },
} as const;

function panelButtonState(activePanel: ToolPanelKind | null, panel: ToolPanelKind) {
  const active = activePanel === panel;
  return {
    active,
    controls: `tool-panel-${panel}`,
  };
}

export function Toolbar({
  locale,
  edge,
  offsetRatio,
  hidden = false,
  activePanel,
  theme,
  bold,
  marqueeEnabled,
  onToggleTheme,
  onTogglePanel,
  onToggleBold,
  onGripPointerDown,
}: ToolbarProps) {
  const copy = COPY[locale];
  const boundedOffset = Math.min(0.96, Math.max(0.04, offsetRatio));
  const font = panelButtonState(activePanel, "font");
  const color = panelButtonState(activePanel, "color");
  const align = panelButtonState(activePanel, "align");
  const marquee = panelButtonState(activePanel, "marquee");
  const more = panelButtonState(activePanel, "more");

  return (
    <div
      class={`toolbar-shell edge-${edge}${hidden ? " is-hidden" : ""}`}
      style={`--toolbar-offset: ${boundedOffset}`}
    >
      <nav aria-label={copy.toolbar} class="toolbar">
        <button
          aria-label={copy.move}
          class="grip-button"
          onPointerDown={onGripPointerDown}
          title={copy.move}
          type="button"
        >
          <Icon name="grip" />
        </button>

        <span aria-hidden="true" class="toolbar-divider" />

        <button
          aria-label={theme === "dark" ? copy.lightTheme : copy.darkTheme}
          aria-pressed={theme === "dark"}
          class={`tool-button${theme === "dark" ? " is-active" : ""}`}
          onClick={onToggleTheme}
          title={theme === "dark" ? copy.lightTheme : copy.darkTheme}
          type="button"
        >
          <Icon name="theme" />
        </button>

        <button
          aria-controls={font.controls}
          aria-expanded={font.active}
          aria-haspopup="dialog"
          aria-label={copy.font}
          class={`tool-button${font.active ? " is-active" : ""}`}
          onClick={() => onTogglePanel("font")}
          title={copy.font}
          type="button"
        >
          <span aria-hidden="true" class="text-tool-icon">Aa</span>
        </button>

        <button
          aria-controls={color.controls}
          aria-expanded={color.active}
          aria-haspopup="dialog"
          aria-label={copy.color}
          class={`tool-button${color.active ? " is-active" : ""}`}
          onClick={() => onTogglePanel("color")}
          title={copy.color}
          type="button"
        >
          <Icon name="color" />
        </button>

        <button
          aria-controls={align.controls}
          aria-expanded={align.active}
          aria-haspopup="dialog"
          aria-label={copy.align}
          class={`tool-button${align.active ? " is-active" : ""}`}
          onClick={() => onTogglePanel("align")}
          title={copy.align}
          type="button"
        >
          <Icon name="align" />
        </button>

        <button
          aria-label={copy.bold}
          aria-pressed={bold}
          class={`tool-button${bold ? " is-active" : ""}`}
          onClick={onToggleBold}
          title={copy.bold}
          type="button"
        >
          <span aria-hidden="true" class="text-tool-icon">B</span>
        </button>

        <button
          aria-controls={marquee.controls}
          aria-expanded={marquee.active}
          aria-haspopup="dialog"
          aria-label={copy.marquee}
          aria-pressed={marqueeEnabled}
          class={`tool-button${marqueeEnabled || marquee.active ? " is-active" : ""}`}
          onClick={() => onTogglePanel("marquee")}
          title={copy.marquee}
          type="button"
        >
          <Icon name="marquee" />
        </button>

        <button
          aria-controls={more.controls}
          aria-expanded={more.active}
          aria-haspopup="dialog"
          aria-label={copy.more}
          class={`tool-button${more.active ? " is-active" : ""}`}
          onClick={() => onTogglePanel("more")}
          title={copy.more}
          type="button"
        >
          <Icon name="more" />
        </button>
      </nav>
    </div>
  );
}
