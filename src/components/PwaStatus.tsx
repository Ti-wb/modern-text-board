import type { PwaStatusState } from "../platform/pwa";

export type PwaStatusLocale = "zh-TW" | "en";

export interface PwaStatusProps {
  locale: PwaStatusLocale;
  className?: string;
  status: PwaStatusState;
}

interface PwaStatusViewProps {
  locale: PwaStatusLocale;
  className?: string;
  status: PwaStatusState;
}

const COPY = {
  "zh-TW": {
    offlineReady: "已可離線使用",
    offline: "目前離線，仍可繼續使用本次內容",
    updateAvailable: "有新版本可用；更新會重設本次內容",
    updating: "正在更新…",
    registrationError: "無法啟用離線功能",
    update: "更新並重新載入",
    later: "稍後",
    dismiss: "關閉",
  },
  en: {
    offlineReady: "Ready to use offline",
    offline: "You are offline. This session remains usable.",
    updateAvailable: "An update is available; reloading resets this session",
    updating: "Updating…",
    registrationError: "Offline support could not be enabled",
    update: "Update and reload",
    later: "Later",
    dismiss: "Dismiss",
  },
} as const;

function PwaStatusView({
  locale,
  className,
  status,
}: PwaStatusViewProps) {
  const copy = COPY[locale];
  const rootClassName = [
    "toast",
    "pwa-status",
    status.phase === "registration-error" ? "is-error" : null,
    className,
  ].filter(Boolean).join(" ");

  if (status.phase === "idle" || status.phase === "ready") return null;

  if (status.phase === "update-available" || status.phase === "updating") {
    return (
      <section class={rootClassName} role="alert" aria-live="assertive">
        <p>{status.phase === "updating" ? copy.updating : copy.updateAvailable}</p>
        <div class="toast-actions pwa-status__actions">
          <button
            type="button"
            onClick={() => void status.applyUpdate()}
            disabled={status.phase === "updating"}
          >
            {copy.update}
          </button>
          <button
            type="button"
            onClick={status.dismissUpdate}
            disabled={status.phase === "updating"}
          >
            {copy.later}
          </button>
        </div>
      </section>
    );
  }

  const message = status.phase === "offline-ready"
    ? copy.offlineReady
    : status.phase === "offline"
      ? copy.offline
      : copy.registrationError;
  const dismiss = status.phase === "offline-ready"
    ? status.dismissOfflineReady
    : status.dismissError;

  return (
    <section class={rootClassName} role="status" aria-live="polite">
      <p>{message}</p>
      {status.phase !== "offline" && (
        <button type="button" onClick={dismiss} aria-label={copy.dismiss}>
          {copy.dismiss}
        </button>
      )}
    </section>
  );
}

export function PwaStatus({
  locale,
  className,
  status,
}: PwaStatusProps) {
  return <PwaStatusView className={className} locale={locale} status={status} />;
}
