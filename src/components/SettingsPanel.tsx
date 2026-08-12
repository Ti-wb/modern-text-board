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
  toolbarAutoHide: boolean;
  keepScreenAwake: boolean;
  pauseAnimations: boolean;
  wakeLockStatus: Pick<
    WakeLockSnapshot,
    "active" | "supported" | "phase" | "reason"
  >;
  pwaStatus: SettingsPwaStatus;
  storageMode?: "local" | "memory";
  storageError?: string | null;
  appVersion?: string;
  importDisabled?: boolean;
  exportDisabled?: boolean;
  onClose: () => void;
  onLocaleChange: (locale: Locale) => void;
  onToolbarAutoHideChange: (enabled: boolean) => void;
  onKeepScreenAwakeChange: (enabled: boolean) => void;
  onPauseAnimationsChange: (enabled: boolean) => void;
  onExport: () => void;
  onImport: (file: File) => void;
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
  toolbarAutoHide: string;
  toolbarAutoHideHelp: string;
  keepAwake: string;
  keepAwakeHelp: string;
  pauseAnimations: string;
  pauseAnimationsHelp: string;
  data: string;
  localOnly: string;
  localStorage: string;
  memoryOnly: string;
  export: string;
  import: string;
  importHelp: string;
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
    toolbarAutoHide: "自動隱藏工具列",
    toolbarAutoHideHelp: "閒置三秒後隱藏；點一下畫布即可叫回。",
    keepAwake: "保持螢幕常亮",
    keepAwakeHelp: "只在展示模式且頁面可見時嘗試啟用。",
    pauseAnimations: "暫停所有動態",
    pauseAnimationsHelp: "暫停跑馬燈與閃爍，設定不會被清除。",
    data: "資料與備份",
    localOnly:
      "文字與設定只保存在目前瀏覽器或安裝的 Web App。Safari 與主畫面 App 的資料可能彼此分開，也可能被系統清除；重要內容請定期匯出備份。",
    localStorage: "已儲存在此瀏覽器",
    memoryOnly: "目前僅保留在記憶體",
    export: "匯出備份",
    import: "匯入備份",
    importHelp: "匯入前會先驗證，確認後才會完整取代目前資料。檔案上限 1 MiB。",
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
    reset: "重設所有內容",
    resetHelp: "清除目前所有頁面與偏好設定，並建立一個新的空白頁。",
    resetTitle: "確定要重設嗎？",
    resetDescription:
      "這會刪除目前瀏覽器內的所有白板內容與設定。這個動作無法復原，建議先匯出備份。",
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
    toolbarAutoHide: "Auto-hide toolbar",
    toolbarAutoHideHelp: "Hide after three idle seconds; tap the board to bring it back.",
    keepAwake: "Keep screen awake",
    keepAwakeHelp: "Only attempted while presenting and this page is visible.",
    pauseAnimations: "Pause all motion",
    pauseAnimationsHelp: "Pause marquee and flash without clearing their settings.",
    data: "Data & backup",
    localOnly:
      "Text and settings stay only in this browser or installed Web App. Safari and Home Screen apps may keep separate data, and the system may remove it. Export important boards regularly.",
    localStorage: "Saved in this browser",
    memoryOnly: "Currently kept in memory only",
    export: "Export backup",
    import: "Import backup",
    importHelp: "The file is validated first and replaces current data only after confirmation. Maximum size: 1 MiB.",
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
    reset: "Reset everything",
    resetHelp: "Clear all pages and preferences, then create one new blank page.",
    resetTitle: "Reset everything?",
    resetDescription:
      "This deletes every board and setting stored in this browser. It cannot be undone. Export a backup first if you need one.",
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
  toolbarAutoHide,
  keepScreenAwake,
  pauseAnimations,
  wakeLockStatus,
  pwaStatus,
  storageMode = "local",
  storageError = null,
  appVersion,
  importDisabled = false,
  exportDisabled = false,
  onClose,
  onLocaleChange,
  onToolbarAutoHideChange,
  onKeepScreenAwakeChange,
  onPauseAnimationsChange,
  onExport,
  onImport,
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
            <strong>{copy.toolbarAutoHide}</strong>
            <small id="settings-auto-hide-help">{copy.toolbarAutoHideHelp}</small>
          </div>
          <SettingSwitch
            checked={toolbarAutoHide}
            describedBy="settings-auto-hide-help"
            label={copy.toolbarAutoHide}
            onChange={onToolbarAutoHideChange}
          />
        </div>

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
        <span class="section-label">{copy.data}</span>
        <p class="storage-note">{copy.localOnly}</p>
        <p
          class={storageMode === "memory" ? "warning-text" : "field-help"}
          role={storageMode === "memory" ? "alert" : "status"}
        >
          {storageMode === "memory" ? copy.memoryOnly : copy.localStorage}
          {storageError ? ` — ${storageError}` : ""}
        </p>
        <div class="button-row">
          <button
            type="button"
            class="secondary-button"
            disabled={exportDisabled}
            onClick={onExport}
          >
            {copy.export}
          </button>
          <label
            class="file-input-label"
            aria-disabled={importDisabled}
            aria-describedby="settings-import-help"
          >
            {copy.import}
            <input
              type="file"
              accept="application/json,.json"
              disabled={importDisabled}
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (file) onImport(file);
                input.value = "";
              }}
            />
          </label>
        </div>
        <p class="field-help" id="settings-import-help">
          {copy.importHelp}
        </p>

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
