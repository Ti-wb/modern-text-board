import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebFontRuntime } from "./runtime";

afterEach(() => {
  vi.useRealTimers();
});

describe("web font runtime", () => {
  it("loads styles before requesting the selected face and current text", async () => {
    const events: string[] = [];
    const runtime = createWebFontRuntime({
      ensureStyles: async () => {
        events.push("styles");
      },
      loadFaces: async (declaration, sample) => {
        events.push(`${declaration}:${sample}`);
        return [{}];
      },
    });

    await runtime("web-noto-sans-tc", 900, "下一站");
    expect(events[0]).toBe("styles");
    expect(events[1]).toContain('900 1em "Noto Sans TC Variable"');
    expect(events[1]).toContain("下一站");
  });

  it("shares identical in-flight requests and remembers completed requests", async () => {
    let finishStyleLoad: () => void = () => undefined;
    const ensureStyles = vi.fn(() => new Promise<void>((resolve) => {
      finishStyleLoad = resolve;
    }));
    const loadFaces = vi.fn<
      (declaration: string, sample: string) => Promise<unknown[]>
    >(async () => [{}]);
    const runtime = createWebFontRuntime({ ensureStyles, loadFaces });

    const first = runtime("web-lato", 400, "Hello");
    const second = runtime("web-lato", 400, "Hello");
    expect(first).toBe(second);
    expect(runtime.isReady("web-lato", 400, "Hello")).toBe(false);

    finishStyleLoad();
    await first;
    expect(runtime.isReady("web-lato", 400, "Hello")).toBe(true);
    await runtime("web-lato", 400, "Hello");
    expect(ensureStyles).toHaveBeenCalledOnce();
    expect(loadFaces).toHaveBeenCalledOnce();
  });

  it("loads again when newly edited text needs another glyph sample", async () => {
    const ensureStyles = vi.fn(async () => undefined);
    const loadFaces = vi.fn<
      (declaration: string, sample: string) => Promise<unknown[]>
    >(async () => [{}]);
    const runtime = createWebFontRuntime({ ensureStyles, loadFaces });

    await runtime("web-noto-sans-tc", 700, "台北");
    await runtime("web-noto-sans-tc", 700, "高雄🚄");

    expect(loadFaces).toHaveBeenCalledTimes(2);
    expect(loadFaces.mock.calls[1][1]).toContain("高雄🚄");
  });

  it("rejects an empty FontFaceSet result as unavailable", async () => {
    const runtime = createWebFontRuntime({
      ensureStyles: async () => undefined,
      loadFaces: async () => [],
    });

    await expect(runtime("web-lato", 400, "Hello")).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("removes failed requests so the same glyph load can be retried", async () => {
    const loadFaces = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([{}]);
    const runtime = createWebFontRuntime({
      ensureStyles: async () => undefined,
      loadFaces,
    });

    await expect(runtime("web-lato", 400, "Retry")).rejects.toMatchObject({
      code: "unavailable",
    });
    await expect(runtime("web-lato", 400, "Retry")).resolves.toBeUndefined();
    expect(loadFaces).toHaveBeenCalledTimes(2);
  });

  it("applies one timeout to the complete load operation", async () => {
    vi.useFakeTimers();
    const runtime = createWebFontRuntime({
      ensureStyles: () => new Promise(() => undefined),
      loadFaces: async () => [{}],
    });
    const loading = runtime("web-lato", 400, "Hello", 20_000);
    const rejection = expect(loading).rejects.toMatchObject({
      code: "timeout",
      name: "WebFontLoadError",
    });

    await vi.advanceTimersByTimeAsync(20_000);
    await rejection;
  });
});
