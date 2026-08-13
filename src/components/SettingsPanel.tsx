import { useState } from "preact/hooks";
import type { Locale } from "../domain/types";
import type { WakeLockSnapshot } from "../platform/wake-lock";
import { Modal } from "./Modal";

export type PwaInstallState =
  | "installed"
  | "available"
  | "installing"
  | "unavailable";

export type PwaOfflineState = "ready" | "preparing" | "unavailable";

export type PwaUpdateState =
  | "current"
  | "available"
  | "updating"
  | "unavailable";

export interface SettingsPwaStatus {
  online: boolean;
  install: PwaInstallState;
  offline: PwaOfflineState;
  update: PwaUpdateState;
}

export interface SettingsPanelProps {
  locale: Locale;
  keepScreenAwake: boolean;
  pauseAnimations: boolean;
  wakeLockStatus: Pick<
    WakeLockSnapshot,
    "active" | "supported" | "phase" | "reason"
  >;
  pwaStatus: SettingsPwaStatus;
  appVersion?: string;
  onClose: () => void;
  onLocaleChange: (locale: Locale) => void;
  onKeepScreenAwakeChange: (enabled: boolean) => void;
  onPauseAnimationsChange: (enabled: boolean) => void;
  onReset: () => void;
  onShowShortcuts: () => void;
  onInstallPwa?: () => void;
  onApplyPwaUpdate?: () => void;
}

interface Copy {
  title: string;
  close: string;
  language: string;
  display: string;
  traditionalChinese: string;
  english: string;
  keepAwake: string;
  keepAwakeHelp: string;
  pauseAnimations: string;
  pauseAnimationsHelp: string;
  app: string;
  network: string;
  online: string;
  offline: string;
  offlineUse: string;
  install: string;
  update: string;
  installAction: string;
  updateAction: string;
  shortcuts: string;
  shortcutsHelp: string;
  version: string;
  reset: string;
  resetHelp: string;
  resetTitle: string;
  resetDescription: string;
  cancel: string;
  confirmReset: string;
  wake: Record<WakeLockSnapshot["phase"], string>;
  wakeReason: Partial<Record<NonNullable<WakeLockSnapshot["reason"]>, string>>;
  pwaInstall: Record<PwaInstallState, string>;
  pwaOffline: Record<PwaOfflineState, string>;
  pwaUpdate: Record<PwaUpdateState, string>;
}

const COPY: Record<Locale, Copy> = {
  "zh-TW": {
    title: "設定",
    close: "關閉",
    language: "語言",
    display: "顯示與操作",
    traditionalChinese: "繁體中文",
    english: "English",
    keepAwake: "保持螢幕常亮",
    keepAwakeHelp: "只在展示模式且頁面可見時嘗試啟用。",
    pauseAnimations: "暫停所有動態",
    pauseAnimationsHelp: "暫停跑馬燈與閃爍，設定不會被清除。",
    app: "離線與 App",
    network: "網路狀態",
    online: "線上",
    offline: "離線",
    offlineUse: "離線使用",
    install: "安裝 Web App",
    update: "版本更新",
    installAction: "安裝",
    updateAction: "更新並重新載入",
    shortcuts: "鍵盤快捷鍵",
    shortcutsHelp: "查看編輯、效果、換頁與全螢幕快捷鍵。",
    version: "版本",
    reset: "重設本次內容",
    resetHelp: "清除目前工作階段的頁面與偏好，並建立一個新的空白頁。",
    resetTitle: "確定要重設嗎？",
    resetDescription:
      "這會清除目前工作階段的所有白板內容與設定。這個動作無法復原。",
    cancel: "取消",
    confirmReset: "確認重設",
    wake: {
      idle: "未啟用",
      waiting: "等待啟用",
      requesting: "正在取得常亮權限…",
      active: "已成功保持常亮",
      unsupported: "此環境不支援常亮",
      error: "無法取得常亮權限",
    },
    wakeReason: {
      disabled: "未啟用",
      "not-presenting": "進入展示模式後啟用",
      "document-hidden": "回到頁面後會重新嘗試",
      "insecure-context": "常亮功能需要 HTTPS",
      "api-unsupported": "此瀏覽器不支援 Wake Lock",
      "permission-denied": "瀏覽器已拒絕常亮權限",
      "request-failed": "常亮請求失敗，可稍後重試",
      "system-released": "系統已釋放，符合條件時會重試",
    },
    pwaInstall: {
      installed: "已安裝",
      available: "可以安裝",
      installing: "正在安裝…",
      unavailable: "可從瀏覽器選單加入主畫面",
    },
    pwaOffline: {
      ready: "已可完整離線使用",
      preparing: "首次快取尚未完成",
      unavailable: "此瀏覽器不支援離線安裝",
    },
    pwaUpdate: {
      current: "已是最新版本",
      available: "有新版本可用",
      updating: "正在更新…",
      unavailable: "無法檢查更新",
    },
  },
  en: {
    title: "Settings",
    close: "Close",
    language: "Language",
    display: "Display & controls",
    traditionalChinese: "繁體中文",
    english: "English",
    keepAwake: "Keep screen awake",
    keepAwakeHelp: "Only attempted while presenting and this page is visible.",
    pauseAnimations: "Pause all motion",
    pauseAnimationsHelp: "Pause marquee and flash without clearing their settings.",
    app: "Offline & app",
    network: "Network",
    online: "Online",
    offline: "Offline",
    offlineUse: "Offline use",
    install: "Install Web App",
    update: "Updates",
    installAction: "Install",
    updateAction: "Update and reload",
    shortcuts: "Keyboard shortcuts",
    shortcutsHelp: "View shortcuts for editing, effects, pages, and fullscreen.",
    version: "Version",
    reset: "Reset this session",
    resetHelp: "Clear this session's pages and preferences, then create one new blank page.",
    resetTitle: "Reset this session?",
    resetDescription:
      "This clears every board and setting in the current session. It cannot be undone.",
    cancel: "Cancel",
    confirmReset: "Reset everything",
    wake: {
      idle: "Not enabled",
      waiting: "Waiting to activate",
      requesting: "Requesting wake lock…",
      active: "Screen wake lock is active",
      unsupported: "Wake lock is unavailable here",
      error: "Could not acquire wake lock",
    },
    wakeReason: {
      disabled: "Not enabled",
      "not-presenting": "Activates after entering presentation mode",
      "document-hidden": "Will try again when you return",
      "insecure-context": "Wake lock requires HTTPS",
      "api-unsupported": "This browser does not support Wake Lock",
      "permission-denied": "The browser denied wake lock permission",
      "request-failed": "Wake lock request failed; try again later",
      "system-released": "Released by the system; retries when eligible",
    },
    pwaInstall: {
      installed: "Installed",
      available: "Ready to install",
      installing: "Installing…",
      unavailable: "Use the browser menu to add it to your Home Screen",
    },
    pwaOffline: {
      ready: "Fully ready for offline use",
      preparing: "First offline cache is not ready yet",
      unavailable: "Offline installation is not supported here",
    },
    pwaUpdate: {
      current: "You have the latest version",
      available: "A new version is available",
      updating: "Updating…",
      unavailable: "Unable to check for updates",
    },
  },
};

interface SettingSwitchProps {
  checked: boolean;
  describedBy: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function SettingSwitch({
  checked,
  describedBy,
  label,
  onChange,
}: SettingSwitchProps) {
  return (
    <button
      type="button"
      class={`switch${checked ? " is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
    >
      <span class="sr-only">{label}</span>
    </button>
  );
}

function wakeStatusText(
  status: SettingsPanelProps["wakeLockStatus"],
  copy: Copy,
): string {
  if (status.active) return copy.wake.active;
  if (status.reason) return copy.wakeReason[status.reason] ?? copy.wake[status.phase];
  if (!status.supported) return copy.wake.unsupported;
  return copy.wake[status.phase];
}

export function SettingsPanel({
  locale,
  keepScreenAwake,
  pauseAnimations,
  wakeLockStatus,
  pwaStatus,
  appVersion,
  onClose,
  onLocaleChange,
  onKeepScreenAwakeChange,
  onPauseAnimationsChange,
  onReset,
  onShowShortcuts,
  onInstallPwa,
  onApplyPwaUpdate,
}: SettingsPanelProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const copy = COPY[locale];
  const wakeText = wakeStatusText(wakeLockStatus, copy);

  return (
    <>
      <section class="tool-panel wide" aria-labelledby="settings-panel-title">
        <header class="panel-header">
          <h2 class="panel-title" id="settings-panel-title">
            {copy.title}
          </h2>
          <button type="button" class="panel-close" onClick={onClose}>
            {copy.close}
          </button>
        </header>

        <span class="section-label" id="settings-language-label">
          {copy.language}
        </span>
        <div class="segmented" role="group" aria-labelledby="settings-language-label">
          <button
            type="button"
            class={locale === "zh-TW" ? "is-active" : ""}
            aria-pressed={locale === "zh-TW"}
            onClick={() => onLocaleChange("zh-TW")}
          >
            {copy.traditionalChinese}
          </button>
          <button
            type="button"
            class={locale === "en" ? "is-active" : ""}
            aria-pressed={locale === "en"}
            onClick={() => onLocaleChange("en")}
          >
            {copy.english}
          </button>
        </div>

        <div class="panel-divider" />
        <span class="section-label">{copy.display}</span>

        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.keepAwake}</strong>
            <small id="settings-wake-help">{copy.keepAwakeHelp}</small>
            <small aria-live="polite">{wakeText}</small>
          </div>
          <SettingSwitch
            checked={keepScreenAwake}
            describedBy="settings-wake-help"
            label={copy.keepAwake}
            onChange={onKeepScreenAwakeChange}
          />
        </div>

        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.pauseAnimations}</strong>
            <small id="settings-pause-help">{copy.pauseAnimationsHelp}</small>
          </div>
          <SettingSwitch
            checked={pauseAnimations}
            describedBy="settings-pause-help"
            label={copy.pauseAnimations}
            onChange={onPauseAnimationsChange}
          />
        </div>

        <div class="panel-divider" />
        <span class="section-label">{copy.app}</span>
        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.network}</strong>
          </div>
          <span class="status-chip" role="status">
            {pwaStatus.online ? copy.online : copy.offline}
          </span>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.offlineUse}</strong>
            <small>{copy.pwaOffline[pwaStatus.offline]}</small>
          </div>
          <span class="status-chip">{copy.pwaOffline[pwaStatus.offline]}</span>
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.install}</strong>
            <small>{copy.pwaInstall[pwaStatus.install]}</small>
          </div>
          {pwaStatus.install === "available" && onInstallPwa ? (
            <button type="button" class="compact-button" onClick={onInstallPwa}>
              {copy.installAction}
            </button>
          ) : (
            <span class="status-chip">{copy.pwaInstall[pwaStatus.install]}</span>
          )}
        </div>
        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.update}</strong>
            <small>{copy.pwaUpdate[pwaStatus.update]}</small>
          </div>
          {pwaStatus.update === "available" && onApplyPwaUpdate ? (
            <button
              type="button"
              class="compact-button"
              onClick={onApplyPwaUpdate}
            >
              {copy.updateAction}
            </button>
          ) : (
            <span class="status-chip">{copy.pwaUpdate[pwaStatus.update]}</span>
          )}
        </div>

        <div class="panel-divider" />
        <button type="button" class="menu-row" onClick={onShowShortcuts}>
          <span class="setting-copy">
            <strong>{copy.shortcuts}</strong>
            <small>{copy.shortcutsHelp}</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>

        {appVersion && (
          <div class="setting-row">
            <div class="setting-copy">
              <strong>{copy.version}</strong>
            </div>
            <span class="menu-value">{appVersion}</span>
          </div>
        )}

        <div class="panel-divider" />
        <div class="setting-row">
          <div class="setting-copy">
            <strong>{copy.reset}</strong>
            <small>{copy.resetHelp}</small>
          </div>
          <button
            type="button"
            class="danger-button"
            onClick={() => setConfirmingReset(true)}
          >
            {copy.reset}
          </button>
        </div>
      </section>

      {confirmingReset && (
        <Modal
          labelledBy="settings-reset-title"
          onClose={() => setConfirmingReset(false)}
        >
          <h2 class="modal-title" id="settings-reset-title">
            {copy.resetTitle}
          </h2>
          <p class="modal-description">{copy.resetDescription}</p>
          <div class="button-row">
            <button
              type="button"
              class="secondary-button"
              onClick={() => setConfirmingReset(false)}
            >
              {copy.cancel}
            </button>
            <button
              type="button"
              class="danger-button"
              onClick={() => {
                setConfirmingReset(false);
                onReset();
              }}
            >
              {copy.confirmReset}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
