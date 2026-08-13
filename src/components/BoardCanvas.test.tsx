import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { describe, expect, it, vi } from "vitest";
import "../styles.css";
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
    onFitChange: vi.fn()
  };

  const view = render(
    <BoardCanvas
      devicePixelRatio={2}
      displayCadence={{
        refreshRateHz: 60,
        frameIntervalMs: 1000 / 60,
        status: "stable",
      }}
      editHint="Double-click to edit"
      marqueeControllerRef={{ current: null }}
      page={page}
      paused={false}
      placeholder="Tap to enter text"
      overflowWarning="Try shortening the text"
      presentation={false}
      qrError="Unable to create QR"
      {...handlers}
    />
  );

  return { handlers, page, ...view };
}

describe("BoardCanvas", () => {
  it("keeps main landmark semantics and opens editing on a canvas double-click", () => {
    const { handlers } = renderCanvas();
    const main = screen.getByRole("main");

    expect(screen.getAllByText("Meet me at the gate")).toHaveLength(2);
    expect(main.tagName).toBe("MAIN");
    expect(main.hasAttribute("role")).toBe(false);
    expect(main.hasAttribute("tabindex")).toBe(false);
    expect(screen.getAllByText("Double-click to edit")).toHaveLength(2);

    fireEvent.dblClick(main);
    expect(handlers.onEdit).toHaveBeenCalledOnce();
  });

  it("provides a separate focusable edit button without changing the main role", () => {
    const { handlers } = renderCanvas();
    const editButton = screen.getByRole("button", { name: "Double-click to edit" });

    expect(editButton.tagName).toBe("BUTTON");
    expect(editButton.getAttribute("type")).toBe("button");
    expect(editButton.classList.contains("canvas-edit-access")).toBe(true);
    expect(getComputedStyle(editButton).width).toBe("44px");
    expect(getComputedStyle(editButton).height).toBe("44px");
    expect(getComputedStyle(editButton).opacity).toBe("0");
    editButton.focus();
    expect(document.activeElement).toBe(editButton);
    const focusRule = [...document.styleSheets]
      .flatMap((sheet) => [...sheet.cssRules])
      .find((rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule && rule.selectorText === ".canvas-edit-access:focus-visible"
      );
    expect(focusRule?.style.opacity).toBe("1");

    fireEvent.click(editButton);
    expect(handlers.onEdit).toHaveBeenCalledOnce();
  });

  it("uses the placeholder for an empty page and hides editing chrome in presentation mode", () => {
    const page = createDefaultPage("page-2", "Page 2");
    render(
      <BoardCanvas
        devicePixelRatio={2}
        displayCadence={{
          refreshRateHz: 60,
          frameIntervalMs: 1000 / 60,
          status: "stable",
        }}
        editHint="Double-click to edit"
        marqueeControllerRef={{ current: null }}
        onEdit={vi.fn()}
        onFitChange={vi.fn()}
        onNext={vi.fn()}
        onPrevious={vi.fn()}
        page={page}
        paused={false}
        placeholder="Tap to enter text"
        overflowWarning="Try shortening the text"
        presentation
        qrError="Unable to create QR"
      />
    );

    expect(screen.getAllByText("Tap to enter text")).toHaveLength(2);
    expect(screen.queryByText("Double-click to edit")).toBeNull();
    expect(screen.queryByRole("button", { name: "Double-click to edit" })).toBeNull();
    expect(screen.getByRole("main").classList.contains("is-presenting")).toBe(true);
  });

  it("shares one flash timeline while keeping mirror and marquee transforms separate", () => {
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
    expect(displayed!.closest(".moving-text")?.classList.contains("is-flashing")).toBe(true);
    expect(document.querySelectorAll(".is-flashing")).toHaveLength(1);
    expect(displayed!.closest(".is-marquee")).not.toBeNull();
    const copies = document.querySelectorAll(".marquee-copy");
    expect(copies).toHaveLength(2);
    expect(copies[0].getAttribute("aria-hidden")).toBe("false");
    expect(copies[1].getAttribute("aria-hidden")).toBe("true");
    expect(displayed!.closest(".moving-text")?.className).not.toContain(
      "is-marquee-suppressed",
    );
    expect(getComputedStyle(copies[0]).willChange).toBe("transform");
    expect(getComputedStyle(displayed!.closest(".moving-text")!).willChange).not.toBe("transform");
    expect(screen.getByRole("main").classList.contains("board-dark")).toBe(true);
  });

  it("uses unbounded text for horizontal marquee and wrapped text for vertical marquee", async () => {
    const horizontal = renderCanvas({
      marquee: { enabled: true, direction: "left", speed: 5 }
    });
    const horizontalText = screen
      .getAllByText("Meet me at the gate")
      .find((element) => element.classList.contains("display-text"));
    const horizontalMeasure = document.querySelector<HTMLElement>(".text-measure");

    expect(horizontalText?.classList.contains("no-wrap")).toBe(true);
    await waitFor(() => expect(horizontalMeasure?.style.whiteSpace).toBe("pre"));
    expect(horizontalMeasure?.style.width).toBe("max-content");
    horizontal.unmount();

    renderCanvas({
      marquee: { enabled: true, direction: "up", speed: 5 }
    });
    const verticalText = screen
      .getAllByText("Meet me at the gate")
      .find((element) => element.classList.contains("display-text"));
    const verticalMeasure = document.querySelector<HTMLElement>(".text-measure");
    const verticalMovingText = verticalText?.closest<HTMLElement>(".moving-text");

    expect(verticalText?.classList.contains("no-wrap")).toBe(false);
    expect(verticalMovingText?.style.width).toBe("100%");
    expect(verticalMovingText?.style.maxWidth).toBe("100%");
    await waitFor(() => expect(verticalMeasure?.style.whiteSpace).toBe("pre-wrap"));
    expect(verticalMeasure?.style.width).not.toBe("max-content");
  });

  it("coalesces fitting into one layout frame without a follow-up loop", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });

    const view = renderCanvas({
      marquee: { enabled: true, direction: "right", speed: 5 }
    });
    expect(frames).toHaveLength(2);

    act(() => {
      const initialFrames = frames.splice(0);
      initialFrames.forEach((callback) => callback(performance.now()));
    });

    expect(frames).toHaveLength(0);
    view.unmount();
    requestFrame.mockRestore();
  });
});
