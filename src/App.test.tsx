import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it } from "vitest";

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
