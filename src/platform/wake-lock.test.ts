import { describe, expect, it, vi } from "vitest";
import {
  createWakeLockController,
  type WakeLockEnvironment,
  type WakeLockSnapshot,
} from "./wake-lock";

class FakeSentinel extends EventTarget {
  released = false;

  async release() {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  }
}

function setVisibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("wake lock controller", () => {
  it("requests only while enabled, visible, secure, and presenting", async () => {
    setVisibility("visible");
    const sentinel = new FakeSentinel();
    const request = vi.fn().mockResolvedValue(sentinel);
    let latest: WakeLockSnapshot | undefined;
    const controller = createWakeLockController(
      (snapshot) => { latest = snapshot; },
      {
        document,
        navigator: { wakeLock: { request } } as unknown as WakeLockEnvironment["navigator"],
        secureContext: true,
      },
    );

    controller.setEnabled(true);
    expect(request).not.toHaveBeenCalled();
    expect(latest?.reason).toBe("not-presenting");

    controller.setPresentation(true);
    await settle();

    expect(request).toHaveBeenCalledWith("screen");
    expect(latest).toMatchObject({ enabled: true, active: true, phase: "active" });
    controller.destroy();
  });

  it("releases in the background and reacquires when visible", async () => {
    setVisibility("visible");
    const first = new FakeSentinel();
    const second = new FakeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createWakeLockController(
      () => undefined,
      {
        document,
        navigator: { wakeLock: { request } } as unknown as WakeLockEnvironment["navigator"],
        secureContext: true,
      },
    );

    controller.setPresentation(true);
    controller.setEnabled(true);
    await settle();

    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(first.released).toBe(true);

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(request).toHaveBeenCalledTimes(2);

    controller.destroy();
  });

  it("reports unavailable capability without attempting a request", () => {
    setVisibility("visible");
    let latest: WakeLockSnapshot | undefined;
    const controller = createWakeLockController(
      (snapshot) => { latest = snapshot; },
      { document, navigator: {} as Navigator, secureContext: true },
    );

    controller.setPresentation(true);
    controller.setEnabled(true);

    expect(latest).toMatchObject({
      enabled: true,
      active: false,
      supported: false,
      phase: "unsupported",
      reason: "api-unsupported",
    });
    controller.destroy();
  });

  it("does not keep a lock that resolves after the preference is disabled", async () => {
    setVisibility("visible");
    let resolveRequest: ((sentinel: FakeSentinel) => void) | undefined;
    const request = vi.fn(() => new Promise<FakeSentinel>((resolve) => {
      resolveRequest = resolve;
    }));
    const controller = createWakeLockController(
      () => undefined,
      {
        document,
        navigator: { wakeLock: { request } } as unknown as WakeLockEnvironment["navigator"],
        secureContext: true,
      },
    );

    controller.setPresentation(true);
    controller.setEnabled(true);
    controller.setEnabled(false);
    const lateSentinel = new FakeSentinel();
    resolveRequest?.(lateSentinel);
    await settle();

    expect(lateSentinel.released).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ active: false, reason: "disabled" });
    controller.destroy();
  });

  it("retries with backoff when the system releases an eligible lock", async () => {
    vi.useFakeTimers();
    setVisibility("visible");
    const first = new FakeSentinel();
    const second = new FakeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const controller = createWakeLockController(
      () => undefined,
      {
        document,
        navigator: { wakeLock: { request } } as unknown as WakeLockEnvironment["navigator"],
        secureContext: true,
        retryDelayMs: 1_000,
      },
    );

    controller.setPresentation(true);
    controller.setEnabled(true);
    await settle();

    first.dispatchEvent(new Event("release"));
    expect(controller.getSnapshot()).toMatchObject({
      active: false,
      reason: "system-released",
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot()).toMatchObject({ active: true, phase: "active" });

    controller.destroy();
    vi.useRealTimers();
  });
});
