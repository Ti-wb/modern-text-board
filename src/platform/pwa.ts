import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useRegisterSW } from "virtual:pwa-register/preact";

export type PwaPhase =
  | "idle"
  | "ready"
  | "offline-ready"
  | "offline"
  | "update-available"
  | "updating"
  | "registration-error";

export type PwaInstallPhase =
  | "installed"
  | "available"
  | "installing"
  | "unavailable";

export type PwaInstallOutcome = "accepted" | "dismissed" | "unavailable";

export interface UsePwaStatusOptions {
  beforeApplyUpdate?: () => Promise<void> | void;
}

export interface PwaStatusState {
  phase: PwaPhase;
  supported: boolean;
  online: boolean;
  registered: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  installPhase: PwaInstallPhase;
  standalone: boolean;
  error: string | null;
  dismissOfflineReady: () => void;
  dismissUpdate: () => void;
  dismissError: () => void;
  applyUpdate: () => Promise<void>;
  install: () => Promise<PwaInstallOutcome>;
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "service-worker-registration-failed";
}

function detectStandalone(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true;
}

function detectServiceWorkerControl(): boolean {
  return typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    navigator.serviceWorker.controller !== null;
}

export function usePwaStatus(
  options: UsePwaStatusOptions = {},
): PwaStatusState {
  const { beforeApplyUpdate } = options;
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  const [registered, setRegistered] = useState(false);
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [error, setError] = useState<string | null>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [offlineCapable, setOfflineCapable] = useState(detectServiceWorkerControl);
  const [standalone, setStandalone] = useState(detectStandalone);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);
  const {
    needRefresh: [updateAvailable],
    offlineReady: [offlineReadyNotice, setOfflineReadyNotice],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => setRegistered(Boolean(registration)),
    onOfflineReady: () => setOfflineCapable(true),
    onRegisterError: (registrationError) => {
      setError(messageFromError(registrationError));
      setErrorDismissed(false);
    },
  });

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (updateAvailable) setUpdateDismissed(false);
  }, [updateAvailable]);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
      setInstalling(false);
    };
    const handleDisplayMode = () => setStandalone(detectStandalone());

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    displayMode.addEventListener("change", handleDisplayMode);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
      displayMode.removeEventListener("change", handleDisplayMode);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    if (!updateAvailable || updating) return;
    setUpdating(true);

    try {
      await beforeApplyUpdate?.();
      // vite-plugin-pwa only activates the waiting worker here; this function is
      // called exclusively from an explicit user action in PwaStatus.
      await updateServiceWorker(true);
    } catch (updateError) {
      setError(messageFromError(updateError));
      setErrorDismissed(false);
      setUpdating(false);
    }
  }, [beforeApplyUpdate, updateAvailable, updateServiceWorker, updating]);

  const phase = useMemo<PwaPhase>(() => {
    if (error && !errorDismissed) return "registration-error";
    if (updating) return "updating";
    if (updateAvailable && !updateDismissed) return "update-available";
    if (offlineReadyNotice) return "offline-ready";
    if (!online) return "offline";
    if (registered) return "ready";
    return "idle";
  }, [
    error,
    errorDismissed,
    offlineReadyNotice,
    online,
    registered,
    updateAvailable,
    updateDismissed,
    updating,
  ]);

  const install = useCallback(async (): Promise<PwaInstallOutcome> => {
    if (!installPrompt || standalone || installing) return "unavailable";
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      setInstallPrompt(null);
      if (choice.outcome === "accepted") setStandalone(detectStandalone());
      return choice.outcome;
    } catch {
      setInstallPrompt(null);
      return "unavailable";
    } finally {
      setInstalling(false);
    }
  }, [installPrompt, installing, standalone]);

  const installPhase: PwaInstallPhase = standalone
    ? "installed"
    : installing
      ? "installing"
      : installPrompt
        ? "available"
        : "unavailable";

  return {
    phase,
    supported,
    online,
    registered,
    offlineReady: offlineCapable,
    updateAvailable,
    installPhase,
    standalone,
    error,
    dismissOfflineReady: () => setOfflineReadyNotice(false),
    dismissUpdate: () => setUpdateDismissed(true),
    dismissError: () => setErrorDismissed(true),
    applyUpdate,
    install,
  };
}
