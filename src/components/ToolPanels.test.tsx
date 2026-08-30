import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";

import {
  ToolPanels,
  type FontPanelControls,
  type ToolPanelsProps,
} from "./ToolPanels";

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
  onMarqueeSpeedPreview = vi.fn(),
  onMarqueeSpeedCommit = vi.fn(),
  options: {
    font?: Partial<FontPanelControls>;
    locale?: ToolPanelsProps["locale"];
  } = {},
) {
  const noop = () => undefined;
  const props: ToolPanelsProps = {
    locale: options.locale ?? "en",
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
      fontLoadStates: {
        "web-noto-sans-tc": "idle",
        "web-noto-serif-tc": "idle",
        "web-lxgw-wenkai-tc": "idle",
        "web-iansui": "idle",
        "web-wdxl-lubrifont-tc": "idle",
        "web-lato": "idle",
        "web-inter": "idle",
        "web-montserrat": "idle",
        "web-merriweather": "idle",
      },
      online: true,
      fitOverflow: false,
      onFontFamilyChange: noop,
      onFontScaleChange,
      onFontWeightChange: noop,
      ...options.font,
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
      devicePixelRatio: 2,
      enabled: false,
      direction: "left",
      refreshRateHz: 60,
      speed: 5,
      onEnabledChange: noop,
      onDirectionChange: noop,
      onSpeedPreview: onMarqueeSpeedPreview,
      onSpeedCommit: onMarqueeSpeedCommit,
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

  it("shows localized system and web font tabs and requests a web font", () => {
    const onFontFamilyChange = vi.fn();
    renderPanel(
      vi.fn(),
      "font",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { font: { onFontFamilyChange }, locale: "zh-TW" },
    );

    fireEvent.click(screen.getByRole("tab", { name: "Web Fonts" }));
    expect(screen.getByText("繁中文字型")).toBeTruthy();
    expect(screen.getByText("歐文字型")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Iansui.*載入/ }));
    expect(onFontFamilyChange).toHaveBeenCalledWith("web-iansui");
  });

  it("announces load state, previews ready fonts, and disables unavailable weights", () => {
    renderPanel(
      vi.fn(),
      "font",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      {
        font: {
          fontFamily: "web-iansui",
          fontWeight: 400,
          fontLoadStates: {
            "web-noto-sans-tc": "loading",
            "web-noto-serif-tc": "idle",
            "web-lxgw-wenkai-tc": "idle",
            "web-iansui": "ready",
            "web-wdxl-lubrifont-tc": "error",
            "web-lato": "idle",
            "web-inter": "idle",
            "web-montserrat": "idle",
            "web-merriweather": "idle",
          },
        },
      },
    );

    const loading = screen.getByRole("button", {
      name: /Noto Sans TC.*Loading/,
    });
    expect((loading as HTMLButtonElement).disabled).toBe(true);
    expect(loading.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Retry")).toBeTruthy();

    const sample = screen.getByText("手舉牌 Aa");
    expect(sample.getAttribute("style")).toContain("Iansui");
    expect((screen.getByRole("button", { name: "Light" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Regular" }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "Bold" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Black" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("explains the safe fallback while offline", () => {
    renderPanel(
      vi.fn(),
      "font",
      vi.fn(),
      vi.fn(),
      vi.fn(),
      { font: { online: false } },
    );
    fireEvent.click(screen.getByRole("tab", { name: "Web Fonts" }));

    expect(
      screen.getByRole("status").textContent,
    ).toContain("Only previously cached fonts and glyphs");
  });

  it("coalesces high-range marquee previews to one display-frame update", async () => {
    const onMarqueeSpeedPreview = vi.fn();
    const onMarqueeSpeedCommit = vi.fn();
    renderPanel(
      vi.fn(),
      "marquee",
      vi.fn(),
      onMarqueeSpeedPreview,
      onMarqueeSpeedCommit,
    );

    const slider = screen.getByRole("slider", { name: "Speed" });
    expect(slider.getAttribute("min")).toBe("1");
    expect(slider.getAttribute("max")).toBe("40");
    expect(slider.getAttribute("step")).toBe("0.1");
    expect(slider.getAttribute("aria-valuetext")).toBe(
      "84 pixels per second, adaptive for 60Hz",
    );
    expect(screen.getByText("84 px/s · 60Hz adaptive")).toBeTruthy();

    fireEvent.input(slider, { target: { value: "12.5" } });
    fireEvent.input(slider, { target: { value: "24.5" } });
    fireEvent.input(slider, { target: { value: "37.5" } });
    expect(onMarqueeSpeedPreview).not.toHaveBeenCalled();
    expect(onMarqueeSpeedCommit).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onMarqueeSpeedPreview).toHaveBeenCalledOnce();
      expect(onMarqueeSpeedPreview).toHaveBeenCalledWith(37.5);
    });
    expect(screen.getByText("574 px/s · 60Hz adaptive")).toBeTruthy();

    fireEvent.pointerUp(slider, { target: { value: "37.5" } });
    expect(onMarqueeSpeedCommit).toHaveBeenCalledOnce();
    expect(onMarqueeSpeedCommit).toHaveBeenCalledWith(37.5);
  });

  it("commits a keyboard speed adjustment only when the key gesture completes", async () => {
    const onMarqueeSpeedPreview = vi.fn();
    const onMarqueeSpeedCommit = vi.fn();
    renderPanel(
      vi.fn(),
      "marquee",
      vi.fn(),
      onMarqueeSpeedPreview,
      onMarqueeSpeedCommit,
    );

    const slider = screen.getByRole("slider", { name: "Speed" });
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.input(slider, { target: { value: "5.1" } });
    expect(onMarqueeSpeedCommit).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onMarqueeSpeedPreview).toHaveBeenCalledWith(5.1);
    });
    fireEvent.keyUp(slider, { key: "ArrowRight" });
    expect(onMarqueeSpeedCommit).toHaveBeenCalledOnce();
    expect(onMarqueeSpeedCommit).toHaveBeenCalledWith(5.1);
  });

  it("rolls an incomplete marquee speed preview back when the panel closes", async () => {
    const onMarqueeSpeedPreview = vi.fn();
    const onMarqueeSpeedCommit = vi.fn();
    const view = renderPanel(
      vi.fn(),
      "marquee",
      vi.fn(),
      onMarqueeSpeedPreview,
      onMarqueeSpeedCommit,
    );

    const slider = screen.getByRole("slider", { name: "Speed" });
    fireEvent.input(slider, { target: { value: "37.5" } });
    await waitFor(() => {
      expect(onMarqueeSpeedPreview).toHaveBeenCalledWith(37.5);
    });
    view.unmount();

    expect(onMarqueeSpeedCommit).not.toHaveBeenCalled();
    expect(onMarqueeSpeedPreview).toHaveBeenLastCalledWith(5);
  });
});
