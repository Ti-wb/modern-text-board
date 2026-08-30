import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

const fontRuntime = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  isReady: vi.fn(),
}));

vi.mock("./fonts/runtime", () => ({
  ensureWebFontReady: fontRuntime.ensureReady,
  isWebFontReady: fontRuntime.isReady,
}));

beforeEach(() => {
  fontRuntime.ensureReady.mockReset();
  fontRuntime.ensureReady.mockResolvedValue(undefined);
  fontRuntime.isReady.mockReset();
  fontRuntime.isReady.mockReturnValue(true);
});

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

describe("App optional font selection", () => {
  it("keeps the current family when loading fails", async () => {
    fontRuntime.ensureReady.mockRejectedValue(new Error("offline"));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Font and size" }));
    fireEvent.click(screen.getByRole("tab", { name: "Web Fonts" }));
    fireEvent.click(screen.getByRole("button", { name: /Lato.*Load/ }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Lato.*Retry/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("tab", { name: "System fonts" }));
    expect(
      screen.getByRole("button", { name: "System sans" }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });

  it("only applies the latest web font selection", async () => {
    const readyFamilies = new Set<string>();
    const requests = new Map<
      string,
      { resolve: () => void; promise: Promise<void> }
    >();
    fontRuntime.isReady.mockImplementation((fontFamily: string) =>
      readyFamilies.has(fontFamily),
    );
    fontRuntime.ensureReady.mockImplementation((fontFamily: string) => {
      let resolve: () => void = () => undefined;
      const promise = new Promise<void>((finish) => {
        resolve = () => {
          readyFamilies.add(fontFamily);
          finish();
        };
      });
      requests.set(fontFamily, { resolve, promise });
      return promise;
    });
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Font and size" }));
    fireEvent.click(screen.getByRole("tab", { name: "Web Fonts" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Noto Sans TC.*Load/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Lato.*Load/ }));

    await act(async () => requests.get("web-noto-sans-tc")?.resolve());
    expect(
      screen.getByRole("button", {
        name: /Noto Sans TC.*Loaded/,
      }).getAttribute("aria-pressed"),
    ).toBe("false");

    await act(async () => requests.get("web-lato")?.resolve());
    expect(
      screen.getByRole("button", { name: /Lato.*Loaded/ }).getAttribute(
        "aria-pressed",
      ),
    ).toBe("true");
  });
});
