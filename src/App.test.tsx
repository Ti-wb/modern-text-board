import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

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

describe("App keyboard shortcuts", () => {
  it("keeps the text editor open for IME Escape events and closes it for ordinary Escape", async () => {
    render(<App />);
    fireEvent.keyDown(document, { key: "e" });

    const editor = screen.getByRole("textbox", { name: /Edit text|編輯文字/ });
    dispatchEscape(editor, { isComposing: true });
    expect(screen.getByRole("textbox", { name: /Edit text|編輯文字/ })).toBeTruthy();

    dispatchEscape(editor, { keyCode: 229 });
    expect(screen.getByRole("textbox", { name: /Edit text|編輯文字/ })).toBeTruthy();

    dispatchEscape(editor);
    await waitFor(() => {
      expect(screen.queryByRole("textbox", { name: /Edit text|編輯文字/ })).toBeNull();
    });
  });
});

describe("App toolbar idle treatment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("dims after ten seconds, restores on interaction, and stays active while focused", () => {
    const { container } = render(<App />);
    const toolbar = container.querySelector<HTMLElement>(".toolbar-shell");
    const firstButton = toolbar?.querySelector<HTMLButtonElement>("button");
    expect(toolbar).not.toBeNull();
    expect(firstButton).not.toBeNull();

    act(() => { vi.advanceTimersByTime(9_999); });
    expect(toolbar?.classList.contains("is-idle")).toBe(false);

    act(() => { vi.advanceTimersByTime(1); });
    expect(toolbar?.classList.contains("is-idle")).toBe(true);

    fireEvent.pointerDown(toolbar!);
    expect(toolbar?.classList.contains("is-idle")).toBe(false);

    fireEvent.focus(firstButton!);
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(toolbar?.classList.contains("is-idle")).toBe(false);

    fireEvent.blur(firstButton!, { relatedTarget: document.body });
    act(() => { vi.advanceTimersByTime(9_999); });
    expect(toolbar?.classList.contains("is-idle")).toBe(false);
    act(() => { vi.advanceTimersByTime(1); });
    expect(toolbar?.classList.contains("is-idle")).toBe(true);
  });
});
