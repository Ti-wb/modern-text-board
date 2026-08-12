import type { ExportV1, Locale } from "../domain/types";
import { Modal } from "./Modal";

export interface ImportPreviewProps {
  data: ExportV1;
  locale: Locale;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ImportPreview({ data, locale, onCancel, onConfirm }: ImportPreviewProps) {
  const active = data.workspace.pages.find((page) => page.id === data.workspace.activePageId);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(data.exportedAt));
  return (
    <Modal labelledBy="import-preview-title" onClose={onCancel}>
      <h2 class="modal-title" id="import-preview-title">
        {locale === "zh-TW" ? "確認匯入" : "Confirm import"}
      </h2>
      <p class="modal-description">
        {locale === "zh-TW"
          ? "這會完整取代目前所有頁面與偏好設定。確認前不會修改任何資料。"
          : "This completely replaces all current pages and preferences. Nothing changes until you confirm."}
      </p>
      <dl class="import-summary">
        <div><dt>{locale === "zh-TW" ? "頁數" : "Pages"}</dt><dd>{data.workspace.pages.length}</dd></div>
        <div><dt>{locale === "zh-TW" ? "目前頁" : "Active page"}</dt><dd>{active?.name ?? "—"}</dd></div>
        <div><dt>{locale === "zh-TW" ? "匯出時間" : "Exported"}</dt><dd>{date}</dd></div>
      </dl>
      <div class="button-row">
        <button class="secondary-button" type="button" onClick={onCancel}>
          {locale === "zh-TW" ? "取消" : "Cancel"}
        </button>
        <button class="danger-button" type="button" onClick={onConfirm}>
          {locale === "zh-TW" ? "取代目前資料" : "Replace current data"}
        </button>
      </div>
    </Modal>
  );
}
