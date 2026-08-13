import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";

import type { Locale } from "../domain/types";
import { getTranslator } from "../i18n";
import { Modal } from "./Modal";

export interface TextEditorProps {
  text: string;
  locale: Locale;
  maxCodePoints: number;
  maxFontSizePx: number;
  fontScalePercent: number | null;
  effectiveFontSizePx: number;
  fitOverflow: boolean;
  onApply: (text: string) => void;
  onCancel: () => void;
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

export function TextEditor({
  text,
  locale,
  maxCodePoints,
  maxFontSizePx,
  fontScalePercent,
  effectiveFontSizePx,
  fitOverflow,
  onApply,
  onCancel,
}: TextEditorProps) {
  const [draft, setDraft] = useState(text);
  const composingRef = useRef(false);
  const t = getTranslator(locale);
  const count = codePointLength(draft);
  const tooLong = count > maxCodePoints;

  const apply = () => {
    if (!tooLong && !composingRef.current) onApply(draft);
  };

  const handleKeyDown: JSX.KeyboardEventHandler<HTMLTextAreaElement> = (event) => {
    if (event.key !== "Enter" || (!event.metaKey && !event.ctrlKey)) return;
    event.preventDefault();
    apply();
  };

  return (
    <Modal className="text-editor-modal" labelledBy="text-editor-title" onClose={onCancel}>
      <h2 class="modal-title" id="text-editor-title">{t("editor.title")}</h2>
      <p class="modal-description">
        {locale === "zh-TW"
          ? "保留換行與空白。按 Command 或 Ctrl + Enter 套用。"
          : "Line breaks and spaces are preserved. Press Command or Ctrl + Enter to apply."}
      </p>

      <label class="sr-only" for="text-editor-input">{t("editor.title")}</label>
      <textarea
        aria-describedby="text-editor-count text-editor-warning"
        aria-invalid={tooLong ? "true" : undefined}
        class="textarea-input"
        id="text-editor-input"
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onInput={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("editor.placeholder")}
        rows={7}
        value={draft}
      />

      <div class="character-count" id="text-editor-count">
        <span>{t("editor.count", { count, limit: maxCodePoints })}</span>
        <span>
          {fontScalePercent === null
            ? locale === "zh-TW"
              ? `原設定 ${maxFontSizePx}px / 顯示 ${effectiveFontSizePx}px`
              : `Previous setting ${maxFontSizePx}px / shown ${effectiveFontSizePx}px`
            : locale === "zh-TW"
              ? `填滿 ${fontScalePercent}% / 顯示 ${effectiveFontSizePx}px`
              : `Fill ${fontScalePercent}% / shown ${effectiveFontSizePx}px`}
        </span>
      </div>
      <div aria-live="polite" id="text-editor-warning">
        {tooLong ? (
          <p class="error-text">{t("editor.tooLong", { limit: maxCodePoints })}</p>
        ) : fitOverflow ? (
          <p class="warning-text">{t("canvas.overflow")}</p>
        ) : null}
      </div>

      <div class="button-row">
        <button class="secondary-button" onClick={onCancel} type="button">
          {t("common.cancel")}
        </button>
        <button class="primary-button" disabled={tooLong} onClick={apply} type="button">
          {t("common.apply")}
        </button>
      </div>
    </Modal>
  );
}
