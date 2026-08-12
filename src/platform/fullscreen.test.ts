import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRESENTATION_ATTRIBUTE,
  exitPresentationFullscreen,
  requestPresentationFullscreen,
  subscribeFullscreen,
} from "./fullscreen";

afterEach(() => {
  document.documentElement.removeAttribute(PRESENTATION_ATTRIBUTE);
  vi.restoreAllMocks();
});

describe("presentation fullscreen", () => {
  it("keeps CSS presentation mode when native fullscreen is unsupported", async () => {
    const target = document.createElement("main");
    document.body.append(target);

    const result = await requestPresentationFullscreen(target);

    expect(result.outcome).toBe("fallback-unsupported");
    expect(result.presentationActive).toBe(true);
    expect(document.documentElement.getAttribute(PRESENTATION_ATTRIBUTE)).toBe("true");
    target.remove();
  });

  it("sets presentation mode before requesting native fullscreen", async () => {
    const target = document.createElement("main");
    document.body.append(target);
    const requestFullscreen = vi.fn(async () => {
      expect(document.documentElement.getAttribute(PRESENTATION_ATTRIBUTE)).toBe("true");
    });
    Object.defineProperty(target, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    const result = await requestPresentationFullscreen(target);

    expect(requestFullscreen).toHaveBeenCalledOnce();
    expect(result.outcome).toBe("native");
    expect(result.nativeActive).toBe(true);
    target.remove();
  });

  it("preserves the fallback when the browser denies fullscreen", async () => {
    const target = document.createElement("main");
    document.body.append(target);
    Object.defineProperty(target, "requestFullscreen", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")),
    });

    const result = await requestPresentationFullscreen(target);

    expect(result.outcome).toBe("fallback-denied");
    expect(result.presentationActive).toBe(true);
    target.remove();
  });

  it("notifies subscribers and exits the CSS fallback", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullscreen(listener);

    await requestPresentationFullscreen(document.documentElement);
    await exitPresentationFullscreen();

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls.at(-1)?.[0].presentationActive).toBe(false);
    unsubscribe();
  });

  it("ends presentation when the browser exits a native fullscreen session", () => {
    let fullscreenElement: Element | null = document.documentElement;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    document.documentElement.setAttribute(PRESENTATION_ATTRIBUTE, "true");
    const listener = vi.fn();
    const unsubscribe = subscribeFullscreen(listener);

    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));

    expect(document.documentElement.hasAttribute(PRESENTATION_ATTRIBUTE)).toBe(false);
    expect(listener.mock.calls.at(-1)?.[0]).toMatchObject({
      nativeActive: false,
      presentationActive: false,
    });
    unsubscribe();
  });
});
