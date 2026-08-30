import type { FontWeight, WebFontFamily } from "../domain/types";
import { FONT_CATALOG } from "./catalog";
import { ensureWebFontStyles } from "./styleLoaders";

export const DEFAULT_FONT_LOAD_TIMEOUT_MS = 20_000;

export class WebFontLoadError extends Error {
  constructor(
    readonly code: "timeout" | "unavailable",
    options?: ErrorOptions,
  ) {
    super(
      code === "timeout"
        ? "The web font did not load in time"
        : "The web font could not be loaded",
      options,
    );
    this.name = "WebFontLoadError";
  }
}

export interface WebFontRuntimeDependencies {
  ensureStyles: (fontFamily: WebFontFamily) => Promise<void>;
  loadFaces: (
    declaration: string,
    sample: string,
  ) => Promise<readonly unknown[]>;
}

export interface WebFontRuntime {
  (
    fontFamily: WebFontFamily,
    fontWeight: FontWeight,
    text: string,
    timeoutMs?: number,
  ): Promise<void>;
  isReady: (
    fontFamily: WebFontFamily,
    fontWeight: FontWeight,
    text: string,
  ) => boolean;
  reset: () => void;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new WebFontLoadError("timeout")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function createWebFontRuntime(
  dependencies: WebFontRuntimeDependencies,
): WebFontRuntime {
  const pending = new Map<string, Promise<void>>();
  const ready = new Set<string>();
  const requestKey = (
    fontFamily: WebFontFamily,
    fontWeight: FontWeight,
    text: string,
  ) => `${fontFamily}:${fontWeight}:${text}`;
  const sampleFor = (fontFamily: WebFontFamily, text: string) => {
    const definition = FONT_CATALOG[fontFamily];
    return `${definition.sample} ${text}`.slice(0, 2_048);
  };

  const ensureReady = (
    fontFamily: WebFontFamily,
    fontWeight: FontWeight,
    text: string,
    timeoutMs = DEFAULT_FONT_LOAD_TIMEOUT_MS,
  ): Promise<void> => {
    const key = requestKey(fontFamily, fontWeight, text);
    if (ready.has(key)) return Promise.resolve();
    const existing = pending.get(key);
    if (existing) return existing;

    const definition = FONT_CATALOG[fontFamily];
    const sample = sampleFor(fontFamily, text);

    const loading = withTimeout(
      (async () => {
        await dependencies.ensureStyles(fontFamily);
        const faces = await dependencies.loadFaces(
          `${fontWeight} 1em "${definition.cssFamily}"`,
          sample,
        );
        if (faces.length === 0) {
          throw new WebFontLoadError("unavailable");
        }
      })(),
      timeoutMs,
    ).catch((error: unknown) => {
      if (error instanceof WebFontLoadError) throw error;
      throw new WebFontLoadError("unavailable", { cause: error });
    });
    pending.set(key, loading);
    void loading.then(
      () => {
        pending.delete(key);
        ready.add(key);
      },
      () => {
        pending.delete(key);
      },
    );
    return loading;
  };

  return Object.assign(ensureReady, {
    isReady: (
      fontFamily: WebFontFamily,
      fontWeight: FontWeight,
      text: string,
    ) => ready.has(requestKey(fontFamily, fontWeight, text)),
    reset: () => {
      pending.clear();
      ready.clear();
    },
  });
}

const defaultRuntime = createWebFontRuntime({
  ensureStyles: ensureWebFontStyles,
  loadFaces: async (declaration, sample) => {
    if (typeof document === "undefined" || !document.fonts?.load) {
      return [true];
    }
    return document.fonts.load(declaration, sample);
  },
});

export const ensureWebFontReady = defaultRuntime;

export const isWebFontReady = defaultRuntime.isReady;
