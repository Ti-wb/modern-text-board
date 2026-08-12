import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import { ToolPanels, type ToolPanelsProps } from "./ToolPanels";

function dispatchEscape(
  target: EventTarget,
  { isComposing = false, keyCode = 0 }: { isComposing?: boolean; keyCode?: number } = {},
) {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    key: "Escape",
  });
  Object.defineProperty(event, "isComposing", { value: isComposing });
  Object.defineProperty(event, "keyCode", { value: keyCode });
  target.dispatchEvent(event);
}

function renderPanel(onClose: () => void) {
  const noop = () => undefined;
  const props: ToolPanelsProps = {
    locale: "en",
    kind: "align",
    edge: "bottom",
    offsetRatio: 0.5,
    onClose,
    font: {
      fontFamily: "system-sans",
      maxFontSizePx: 80,
      effectiveFontSizePx: 80,
      fontWeight: 900,
      fitOverflow: false,
      onFontFamilyChange: noop,
      onFontSizeChange: noop,
      onFontWeightChange: noop,
    },
    color: {
      textColor: "auto",
      customColorDraft: "#007AFF",
      lowContrast: false,
      onTextColorChange: noop,
      onCustomColorDraftChange: noop,
      onCustomColorApply: noop,
    },
    align: {
      textAlign: "center",
      onTextAlignChange: noop,
    },
    marquee: {
      enabled: false,
      direction: "left",
      speed: 5,
      onEnabledChange: noop,
      onDirectionChange: noop,
      onSpeedChange: noop,
    },
    more: {
      mirrored: false,
      flashEnabled: false,
      qrEnabled: false,
      pageCount: 1,
      presenting: false,
      onMirroredChange: noop,
      onFlashEnabledChange: noop,
      onOpenQr: noop,
      onOpenPages: noop,
      onTogglePresentation: noop,
      onOpenSettings: noop,
    },
  };

  return render(<ToolPanels {...props} />);
}

describe("ToolPanels keyboard dismissal", () => {
  it("ignores IME Escape events and closes for an ordinary Escape", () => {
    const onClose = vi.fn();
    renderPanel(onClose);
    const dialog = screen.getByRole("dialog");

    dispatchEscape(dialog, { isComposing: true });
    dispatchEscape(dialog, { keyCode: 229 });
    expect(onClose).not.toHaveBeenCalled();

    dispatchEscape(dialog);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
