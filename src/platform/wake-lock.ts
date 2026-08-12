import { useEffect, useState } from "preact/hooks";

export type WakeLockPhase =
  | "idle"
  | "waiting"
  | "requesting"
  | "active"
  | "unsupported"
  | "error";

export type WakeLockReason =
  | "disabled"
  | "not-presenting"
  | "document-hidden"
  | "insecure-context"
  | "api-unsupported"
  | "permission-denied"
  | "request-failed"
  | "system-released"
  | null;

export interface WakeLockSnapshot {
  enabled: boolean;
  active: boolean;
  supported: boolean;
  phase: WakeLockPhase;
  reason: WakeLockReason;
}

interface ScreenWakeLockSentinel extends EventTarget {
  readonly released?: boolean;
  release: () => Promise<void>;
}

interface ScreenWakeLockApi {
  request: (type: "screen") => Promise<ScreenWakeLockSentinel>;
}

type WakeLockNavigator = Navigator & {
  wakeLock?: ScreenWakeLockApi;
};

export interface WakeLockEnvironment {
  document?: Document;
  navigator?: WakeLockNavigator;
  secureContext?: boolean;
  retryDelayMs?: number;
}

export interface WakeLockController {
  getSnapshot: () => WakeLockSnapshot;
  setEnabled: (enabled: boolean) => void;
  setPresentation: (presentationActive: boolean) => void;
  refresh: () => void;
  destroy: () => void;
}

export interface UseWakeLockOptions {
  enabled: boolean;
  presentationActive: boolean;
}

const INITIAL_SNAPSHOT: WakeLockSnapshot = {
  enabled: false,
  active: false,
  supported: false,
  phase: "idle",
  reason: "disabled",
};

function sameSnapshot(left: WakeLockSnapshot, right: WakeLockSnapshot): boolean {
  return left.enabled === right.enabled &&
    left.active === right.active &&
    left.supported === right.supported &&
    left.phase === right.phase &&
    left.reason === right.reason;
}

function permissionDenied(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError");
}

export function createWakeLockController(
  onChange: (snapshot: WakeLockSnapshot) => void,
  environment: WakeLockEnvironment = {},
): WakeLockController {
  const documentRef = environment.document ??
    (typeof document === "undefined" ? undefined : document);
  const navigatorRef = environment.navigator ??
    (typeof navigator === "undefined" ? undefined : navigator as WakeLockNavigator);
  const secureContext = environment.secureContext ??
    (typeof globalThis.isSecureContext === "boolean" && globalThis.isSecureContext);
  const wakeLockApi = navigatorRef?.wakeLock;
  const supported = secureContext && wakeLockApi !== undefined;
  const retryDelayMs = environment.retryDelayMs ?? 1_000;

  let enabled = false;
  let presentationActive = false;
  let destroyed = false;
  let sentinel: ScreenWakeLockSentinel | null = null;
  let requestVersion = 0;
  let pendingVersion: number | null = null;
  let retryAttempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let snapshot: WakeLockSnapshot = {
    ...INITIAL_SNAPSHOT,
    supported,
  };

  const update = (next: WakeLockSnapshot) => {
    if (sameSnapshot(snapshot, next)) return;
    snapshot = next;
    onChange(snapshot);
  };

  const eligibilityReason = (): WakeLockReason => {
    if (!enabled) return "disabled";
    if (!presentationActive) return "not-presenting";
    if (!documentRef || documentRef.visibilityState !== "visible") {
      return "document-hidden";
    }
    if (!secureContext) return "insecure-context";
    if (!wakeLockApi) return "api-unsupported";
    return null;
  };

  const releaseCurrent = () => {
    const current = sentinel;
    sentinel = null;
    if (!current) return;
    current.removeEventListener("release", handleSentinelRelease);
    void current.release().catch(() => undefined);
  };

  const clearRetry = () => {
    if (retryTimer === null) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const setWaitingSnapshot = (reason: WakeLockReason) => {
    const phase: WakeLockPhase = reason === "api-unsupported" || reason === "insecure-context"
      ? "unsupported"
      : reason === "disabled"
        ? "idle"
        : "waiting";

    update({ enabled, active: false, supported, phase, reason });
  };

  function handleSentinelRelease(): void {
    if (!sentinel) return;
    sentinel.removeEventListener("release", handleSentinelRelease);
    sentinel = null;
    update({
      enabled,
      active: false,
      supported,
      phase: "waiting",
      reason: "system-released",
    });

    if (eligibilityReason() === null && retryTimer === null) {
      const delay = Math.min(retryDelayMs * (2 ** retryAttempt), 30_000);
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        reconcile();
      }, delay);
    }
  }

  const acquire = async () => {
    if (!wakeLockApi || destroyed) return;

    clearRetry();
    const version = ++requestVersion;
    pendingVersion = version;
    update({ enabled, active: false, supported, phase: "requesting", reason: null });

    try {
      const acquired = await wakeLockApi.request("screen");

      if (pendingVersion === version) pendingVersion = null;

      if (destroyed || requestVersion !== version || eligibilityReason() !== null) {
        await acquired.release().catch(() => undefined);
        return;
      }

      sentinel = acquired;
      sentinel.addEventListener("release", handleSentinelRelease);
      update({ enabled, active: true, supported, phase: "active", reason: null });
    } catch (error) {
      if (pendingVersion !== version || destroyed || requestVersion !== version) return;
      pendingVersion = null;
      update({
        enabled,
        active: false,
        supported,
        phase: "error",
        reason: permissionDenied(error) ? "permission-denied" : "request-failed",
      });
    }
  };

  const reconcile = () => {
    if (destroyed) return;
    const reason = eligibilityReason();

    if (reason !== null) {
      clearRetry();
      retryAttempt = 0;
      requestVersion += 1;
      pendingVersion = null;
      releaseCurrent();
      setWaitingSnapshot(reason);
      return;
    }

    if (sentinel || pendingVersion !== null) return;
    void acquire();
  };

  const handleVisibilityChange = () => reconcile();
  documentRef?.addEventListener("visibilitychange", handleVisibilityChange);
  onChange(snapshot);

  return {
    getSnapshot: () => snapshot,
    setEnabled(nextEnabled) {
      if (enabled !== nextEnabled) retryAttempt = 0;
      enabled = nextEnabled;
      reconcile();
    },
    setPresentation(nextPresentationActive) {
      if (presentationActive !== nextPresentationActive) retryAttempt = 0;
      presentationActive = nextPresentationActive;
      reconcile();
    },
    refresh: reconcile,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      requestVersion += 1;
      pendingVersion = null;
      clearRetry();
      documentRef?.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseCurrent();
    },
  };
}

export function useWakeLock({
  enabled,
  presentationActive,
}: UseWakeLockOptions): WakeLockSnapshot {
  const [snapshot, setSnapshot] = useState<WakeLockSnapshot>(INITIAL_SNAPSHOT);
  const [controller, setController] = useState<WakeLockController | null>(null);

  useEffect(() => {
    const nextController = createWakeLockController(setSnapshot);
    setController(nextController);
    return () => nextController.destroy();
  }, []);

  useEffect(() => {
    controller?.setEnabled(enabled);
  }, [controller, enabled]);

  useEffect(() => {
    controller?.setPresentation(presentationActive);
  }, [controller, presentationActive]);

  return snapshot;
}
