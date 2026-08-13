import { fireEvent, render, screen } from "@testing-library/preact";
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

function renderPanel(
  onClose: () => void,
  kind: ToolPanelsProps["kind"] = "align",
  onFontScaleChange = vi.fn(),
  onMarqueeSpeedChange = vi.fn(),
) {
  const noop = () => undefined;
  const props: ToolPanelsProps = {
    locale: "en",
    kind,
    edge: "bottom",
    offsetRatio: 0.5,
    onClose,
    font: {
      fontFamily: "system-sans",
      fontScalePercent: null,
      legacyMaxFontSizePx: 80,
      fillReferenceFontSizePx: 640,
      maxFittingFontSizePx: 320,
      effectiveFontSizePx: 80,
      fontWeight: 900,
      fitOverflow: false,
      onFontFamilyChange: noop,
      onFontScaleChange,
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
      onSpeedChange: onMarqueeSpeedChange,
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

  it("exposes responsive fill percentage and converts the first slider input", () => {
    const onFontScaleChange = vi.fn();
    renderPanel(vi.fn(), "font", onFontScaleChange);

    const slider = screen.getByRole("slider", { name: "Screen fill" });
    expect(slider.getAttribute("min")).toBe("5");
    expect(slider.getAttribute("max")).toBe("100");
    expect(slider.getAttribute("aria-valuetext")).toBe("13% · 80 px");

    fireEvent.input(slider, { target: { value: "100" } });
    expect(onFontScaleChange).toHaveBeenCalledWith(100);
  });

  it("offers a high-range continuous marquee speed with accessible units", () => {
    const onMarqueeSpeedChange = vi.fn();
    renderPanel(vi.fn(), "marquee", vi.fn(), onMarqueeSpeedChange);

    const slider = screen.getByRole("slider", { name: "Speed" });
    expect(slider.getAttribute("min")).toBe("1");
    expect(slider.getAttribute("max")).toBe("40");
    expect(slider.getAttribute("step")).toBe("0.1");
    expect(slider.getAttribute("aria-valuetext")).toBe("84 pixels per second");
    expect(screen.getByText("84 px/s")).toBeTruthy();

    fireEvent.input(slider, { target: { value: "37.5" } });
    expect(onMarqueeSpeedChange).toHaveBeenCalledWith(37.5);
  });
});
