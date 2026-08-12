import { render, screen, waitFor } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";

import { OverlayFrame } from "./OverlayFrame";

interface HarnessProps {
  onClose?: () => void;
}

function Harness({ onClose = () => undefined }: HarnessProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button onClick={() => setOpen(true)} type="button">Open tools</button>
      {open && (
        <OverlayFrame
          edge="bottom"
          labelledBy="overlay-title"
          offsetRatio={0.5}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <section class="tool-panel">
            <h2 id="overlay-title">Tools</h2>
            <input aria-label="Draft" autoFocus />
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </section>
        </OverlayFrame>
      )}
    </>
  );
}

async function openOverlay(onClose?: () => void) {
  const user = userEvent.setup();
  const rendered = render(<Harness onClose={onClose} />);
  const opener = screen.getByRole("button", { name: "Open tools" });
  await user.click(opener);
  await screen.findByRole("dialog");
  return { ...rendered, opener, user };
}

describe("OverlayFrame focus and dismissal", () => {
  it("moves initial focus to the explicitly auto-focused control", async () => {
    await openOverlay();

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Draft" }));
    });
  });

  it("wraps Tab and Shift+Tab within the overlay", async () => {
    await openOverlay();
    const first = screen.getByRole("textbox", { name: "Draft" });
    const last = screen.getByRole("button", { name: "Last action" });

    last.focus();
    const forwardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
    });
    last.dispatchEvent(forwardTab);
    expect(document.activeElement).toBe(first);
    expect(forwardTab.defaultPrevented).toBe(true);

    first.focus();
    const backwardTab = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Tab",
      shiftKey: true,
    });
    first.dispatchEvent(backwardTab);
    expect(document.activeElement).toBe(last);
    expect(backwardTab.defaultPrevented).toBe(true);
  });

  it("does not close when Escape is emitted during IME composition", async () => {
    const onClose = vi.fn();
    await openOverlay(onClose);
    const draft = screen.getByRole("textbox", { name: "Draft" });
    draft.focus();

    const composingEscape = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    Object.defineProperty(composingEscape, "isComposing", { value: true });
    Object.defineProperty(composingEscape, "keyCode", { value: 229 });
    draft.dispatchEvent(composingEscape);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes on ordinary Escape and restores focus after unmount", async () => {
    const onClose = vi.fn();
    const { opener } = await openOverlay(onClose);
    const draft = screen.getByRole("textbox", { name: "Draft" });
    draft.focus();

    draft.dispatchEvent(new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onClose).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("closes from the scrim", async () => {
    const onClose = vi.fn();
    const { container, user } = await openOverlay(onClose);
    const scrim = container.querySelector<HTMLElement>(".panel-scrim");
    expect(scrim).not.toBeNull();

    await user.click(scrim!);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
