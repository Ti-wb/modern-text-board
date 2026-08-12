import { fireEvent, render, screen } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPage } from "../domain/defaults";
import { BoardCanvas } from "./BoardCanvas";

function renderCanvas(overrides = {}) {
  const page = {
    ...createDefaultPage("page-1", "Page 1"),
    text: "Meet me at the gate",
    ...overrides
  };
  const handlers = {
    onEdit: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onInteraction: vi.fn(),
    onFitChange: vi.fn()
  };

  render(
    <BoardCanvas
      editHint="Double-click to edit"
      page={page}
      paused={false}
      placeholder="Tap to enter text"
      presentation={false}
      qrError="Unable to create QR"
      {...handlers}
    />
  );

  return { handlers, page };
}

describe("BoardCanvas", () => {
  it("renders the current text and opens editing on a canvas double-click", () => {
    const { handlers } = renderCanvas();

    expect(screen.getAllByText("Meet me at the gate")).toHaveLength(2);
    expect(screen.getByText("Double-click to edit")).not.toBeNull();

    fireEvent.dblClick(screen.getByRole("main"));
    expect(handlers.onEdit).toHaveBeenCalledOnce();
  });

  it("uses the placeholder for an empty page and hides editing chrome in presentation mode", () => {
    const page = createDefaultPage("page-2", "Page 2");
    render(
      <BoardCanvas
        editHint="Double-click to edit"
        onEdit={vi.fn()}
        onFitChange={vi.fn()}
        onInteraction={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        page={page}
        paused={false}
        placeholder="Tap to enter text"
        presentation
        qrError="Unable to create QR"
      />
    );

    expect(screen.getAllByText("Tap to enter text")).toHaveLength(2);
    expect(screen.queryByText("Double-click to edit")).toBeNull();
    expect(screen.getByRole("main").classList.contains("is-presenting")).toBe(true);
  });

  it("keeps flash, mirror, and marquee effects on separate wrappers", () => {
    renderCanvas({
      theme: "dark",
      mirrored: true,
      flashEnabled: true,
      marquee: { enabled: true, direction: "left", speed: 5 }
    });

    const displayed = screen
      .getAllByText("Meet me at the gate")
      .find((element) => element.classList.contains("display-text"));
    expect(displayed).toBeDefined();
    expect(displayed!.closest(".is-mirrored")).not.toBeNull();
    expect(displayed!.closest(".is-flashing")).not.toBeNull();
    expect(displayed!.closest(".is-marquee")).not.toBeNull();
    expect(screen.getByRole("main").classList.contains("board-dark")).toBe(true);
  });
});
