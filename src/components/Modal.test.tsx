import { fireEvent, render, screen } from "@testing-library/preact";
import { useState } from "preact/hooks";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

function DismissibleModal({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button onClick={() => setOpen(true)}>Open editor</button>
      {open ? (
        <Modal
          labelledBy="modal-heading"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <h2 id="modal-heading">Edit text</h2>
          <button>Cancel</button>
          <button>Apply</button>
        </Modal>
      ) : null}
    </div>
  );
}

describe("Modal", () => {
  it("moves focus into the dialog, traps Tab, and restores focus after Escape", () => {
    const onClose = vi.fn();
    render(<DismissibleModal onClose={onClose} />);

    const trigger = screen.getByRole("button", { name: "Open editor" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Edit text" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(document.activeElement).toBe(cancel);

    apply.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);

    cancel.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(apply);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(dialog.isConnected).toBe(false);
  });

  it("closes when the backdrop itself is pressed", () => {
    const onClose = vi.fn();
    render(
      <Modal labelledBy="title" onClose={onClose}>
        <h2 id="title">Panel</h2>
      </Modal>
    );

    const backdrop = screen.getByRole("dialog").parentElement;
    expect(backdrop).not.toBeNull();
    fireEvent.mouseDown(backdrop!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
