import { act, render } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FontFamily, FontWeight } from "../domain/types";
import { useFontRevision } from "./useFontRevision";

const runtime = vi.hoisted(() => ({
  ensureReady: vi.fn(),
  isReady: vi.fn(),
}));

vi.mock("./runtime", () => ({
  ensureWebFontReady: runtime.ensureReady,
  isWebFontReady: runtime.isReady,
}));

function Probe({
  fontFamily,
  fontWeight = 400,
  text,
}: {
  fontFamily: FontFamily;
  fontWeight?: FontWeight;
  text: string;
}) {
  const snapshot = useFontRevision({ fontFamily, fontWeight, text });
  return (
    <output
      data-ready={String(snapshot.ready)}
      data-revision={snapshot.revision}
    />
  );
}

beforeEach(() => {
  runtime.ensureReady.mockReset();
  runtime.isReady.mockReset();
  runtime.isReady.mockReturnValue(false);
});

describe("useFontRevision", () => {
  it("keeps a web font on fallback until the selected glyphs are ready", async () => {
    const finishes: Array<() => void> = [];
    runtime.ensureReady.mockImplementation(
      () => new Promise<void>((resolve) => finishes.push(resolve)),
    );
    const view = render(
      <Probe fontFamily="web-noto-sans-tc" text="台北" />,
    );
    const output = view.container.querySelector("output")!;

    expect(output.dataset.ready).toBe("false");
    expect(output.dataset.revision).toBe("0");

    await act(async () => finishes.shift()?.());
    expect(output.dataset.ready).toBe("true");
    expect(output.dataset.revision).toBe("1");

    view.rerender(
      <Probe fontFamily="web-noto-sans-tc" text="新字形🚄" />,
    );
    expect(output.dataset.ready).toBe("false");

    await act(async () => finishes.shift()?.());
    expect(output.dataset.ready).toBe("true");
    expect(output.dataset.revision).toBe("2");
  });

  it("uses system and already-ready web fonts without another load", () => {
    const system = render(<Probe fontFamily="system-sans" text="Hello" />);
    expect(
      system.container.querySelector("output")?.dataset.ready,
    ).toBe("true");
    expect(runtime.ensureReady).not.toHaveBeenCalled();
    system.unmount();

    runtime.isReady.mockReturnValue(true);
    const cached = render(<Probe fontFamily="web-lato" text="Hello" />);
    expect(
      cached.container.querySelector("output")?.dataset.ready,
    ).toBe("true");
    expect(runtime.ensureReady).not.toHaveBeenCalled();
  });
});
