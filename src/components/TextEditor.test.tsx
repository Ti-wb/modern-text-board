import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { TextEditor } from "./TextEditor";

function renderEditor(overrides = {}) {
  const props = {
    effectiveFontSizePx: 72,
    fontScalePercent: null,
    fitOverflow: false,
    locale: "en" as const,
    maxCodePoints: 350,
    maxFontSizePx: 80,
    onApply: vi.fn(),
    onCancel: vi.fn(),
    text: "Original text",
    ...overrides
  };
  render(<TextEditor {...props} />);
  return props;
}

describe("TextEditor", () => {
  it("describes legacy and responsive font sizing accurately", () => {
    const legacy = renderEditor();
    expect(screen.getByText("Previous setting 80px / shown 72px")).toBeDefined();
    legacy.onCancel.mockClear();

    cleanup();
    renderEditor({ fontScalePercent: 100, effectiveFontSizePx: 536 });
    expect(screen.getByText("Fill 100% / shown 536px")).toBeDefined();
  });

  it("keeps edits in a draft until Apply is pressed", () => {
    const props = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Edit text" });

    fireEvent.input(textarea, { target: { value: "  新文字\n第二行  " } });
    expect(props.onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(props.onApply).toHaveBeenCalledWith("  新文字\n第二行  ");
  });

  it("cancels without applying and supports Escape from the modal", () => {
    const props = renderEditor();
    fireEvent.input(screen.getByRole("textbox", { name: "Edit text" }), {
      target: { value: "Discard this" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onApply).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
  });

  it("applies with Ctrl/Command+Enter but not while Chinese IME is composing", () => {
    const props = renderEditor();
    const textarea = screen.getByRole("textbox", { name: "Edit text" });

    fireEvent.input(textarea, { target: { value: "注音輸入中" } });
    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(props.onApply).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(props.onApply).toHaveBeenLastCalledWith("注音輸入中");

    fireEvent.input(textarea, { target: { value: "Command key" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(props.onApply).toHaveBeenLastCalledWith("Command key");
  });

  it("counts Unicode code points and prevents over-limit application", () => {
    const props = renderEditor({ locale: "zh-TW" as const, maxCodePoints: 2, text: "" });
    const textarea = screen.getByRole("textbox", { name: "編輯文字" });

    fireEvent.input(textarea, { target: { value: "A😀中" } });

    expect(textarea.getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByRole("button", { name: "套用" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    expect(props.onApply).not.toHaveBeenCalled();
  });
});
