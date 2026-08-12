import type { Locale } from "../domain/types";
import { Modal } from "./Modal";

export interface ShortcutHelpProps {
  locale: Locale;
  onClose: () => void;
}

const ROWS = {
  "zh-TW": [
    ["E / Enter", "編輯文字"],
    ["B", "切換粗體"],
    ["M", "切換跑馬燈"],
    ["F", "進入／離開展示模式"],
    ["Page Up", "上一頁"],
    ["Page Down", "下一頁"],
    ["Esc", "關閉面板／離開展示"],
    ["?", "顯示這份快捷鍵說明"]
  ],
  en: [
    ["E / Enter", "Edit text"],
    ["B", "Toggle bold"],
    ["M", "Toggle marquee"],
    ["F", "Enter or leave presentation mode"],
    ["Page Up", "Previous page"],
    ["Page Down", "Next page"],
    ["Esc", "Close a panel or leave presentation"],
    ["?", "Show keyboard shortcuts"]
  ]
} as const;

export function ShortcutHelp({ locale, onClose }: ShortcutHelpProps) {
  return (
    <Modal labelledBy="shortcut-title" onClose={onClose}>
      <h2 class="modal-title" id="shortcut-title">
        {locale === "zh-TW" ? "鍵盤快捷鍵" : "Keyboard shortcuts"}
      </h2>
      <p class="modal-description">
        {locale === "zh-TW"
          ? "游標位於輸入欄位時，全域字母快捷鍵會暫停。"
          : "Global letter shortcuts pause while an input field is focused."}
      </p>
      <div class="shortcut-grid">
        {ROWS[locale].map(([key, label]) => (
          <>
            <kbd>{key}</kbd>
            <span>{label}</span>
          </>
        ))}
      </div>
      <div class="button-row">
        <button class="primary-button" type="button" onClick={onClose}>
          {locale === "zh-TW" ? "完成" : "Done"}
        </button>
      </div>
    </Modal>
  );
}
