import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPage } from "../domain/defaults";
import { PageManager } from "./PageManager";

function mockRect(top: number): DOMRect {
  return {
    bottom: top + 44,
    height: 44,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function renderManager(pageCount = 2) {
  const pages = Array.from({ length: pageCount }, (_, index) =>
    createDefaultPage(`page-${index + 1}`, `Page ${index + 1}`)
  );
  const handlers = {
    onAdd: vi.fn(),
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onMove: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onRename: vi.fn(),
    onSelect: vi.fn()
  };
  render(
    <PageManager
      activePageId="page-1"
      locale="en"
      maxPages={50}
      pages={pages}
      {...handlers}
    />
  );
  return handlers;
}

describe("PageManager", () => {
  it("exposes page selection and primary navigation without relying on gestures", () => {
    const handlers = renderManager();

    fireEvent.click(screen.getByRole("button", { name: /2Page 2/ }));
    expect(handlers.onSelect).toHaveBeenCalledWith("page-2");

    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(handlers.onNext).toHaveBeenCalledOnce();
  });

  it("supports add, duplicate, rename, reorder, and delete controls", () => {
    const handlers = renderManager();

    fireEvent.click(screen.getByRole("button", { name: "Add page" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));
    fireEvent.click(screen.getByRole("button", { name: "Move down" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(handlers.onAdd).toHaveBeenCalledOnce();
    expect(handlers.onDuplicate).toHaveBeenCalledWith("page-1", "Page 1 copy");
    expect(handlers.onMove).toHaveBeenCalledWith("page-1", 1);
    expect(handlers.onDelete).toHaveBeenCalledWith("page-1");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const renameInput = screen.getByRole("textbox");
    fireEvent.input(renameInput, { target: { value: "Gate sign" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    expect(handlers.onRename).toHaveBeenCalledWith("page-1", "Gate sign");
  });

  it("keeps the last page and its unavailable actions disabled", () => {
    const handlers = renderManager(1);

    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move down" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Delete" }) as HTMLButtonElement).disabled).toBe(true);
    expect(handlers.onDelete).not.toHaveBeenCalled();
  });

  it("reorders a page once on pointer release without requiring pointer capture support", () => {
    const handlers = renderManager(3);
    const rows = [...document.querySelectorAll<HTMLElement>("[data-page-index]")];
    rows.forEach((row, index) => {
      row.getBoundingClientRect = vi.fn(() => mockRect(index * 52));
    });

    const handle = screen.getByRole("button", { name: "Drag to reorder Page 1" });
    Object.defineProperties(handle, {
      hasPointerCapture: { configurable: true, value: undefined },
      releasePointerCapture: { configurable: true, value: undefined },
      setPointerCapture: { configurable: true, value: undefined },
    });

    fireEvent.pointerDown(handle, {
      button: 0,
      clientY: 22,
      pointerId: 17,
      pointerType: "touch",
    });
    fireEvent.pointerMove(handle, {
      buttons: 1,
      clientY: 126,
      pointerId: 17,
      pointerType: "touch",
    });

    expect(handlers.onMove).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, {
      button: 0,
      clientY: 126,
      pointerId: 17,
      pointerType: "touch",
    });
    expect(handlers.onMove).toHaveBeenCalledOnce();
    expect(handlers.onMove).toHaveBeenCalledWith("page-1", 2);

    fireEvent.pointerUp(handle, {
      button: 0,
      clientY: 126,
      pointerId: 17,
      pointerType: "touch",
    });
    expect(handlers.onMove).toHaveBeenCalledOnce();
  });
});
