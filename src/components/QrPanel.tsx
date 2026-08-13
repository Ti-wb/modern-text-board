import { useEffect, useState } from "preact/hooks";

import { LIMITS, utf8ByteLength } from "../domain/defaults";
import type { Locale } from "../domain/types";
import { Icon } from "./Icon";

export interface QrPanelProps {
  locale: Locale;
  enabled: boolean;
  payload: string | null;
  onEnabledChange: (enabled: boolean) => void;
  onPayloadChange: (payload: string) => void;
  onClose: () => void;
}

const COPY = {
  "zh-TW": {
    title: "QR Code",
    close: "關閉",
    enabled: "顯示 QR Code",
    help: "內容只會在這台裝置產生，不會上傳。QR 內容可獨立於白板文字編輯。",
    payload: "QR 內容",
    placeholder: "輸入網址、文字或其他內容",
    empty: "請先輸入內容，空白內容不會產生 QR Code。",
    tooLong: "內容超過 512 UTF-8 bytes，請縮短後再試。",
    bytes: "bytes"
  },
  en: {
    title: "QR Code",
    close: "Close",
    enabled: "Show QR Code",
    help: "Generated only on this device. QR content can be edited independently from board text.",
    payload: "QR content",
    placeholder: "Enter a URL, text, or any other content",
    empty: "Enter some content first. An empty QR code is not generated.",
    tooLong: "Content exceeds 512 UTF-8 bytes. Shorten it to continue.",
    bytes: "bytes"
  }
} as const;

export function QrPanel({
  locale,
  enabled,
  payload,
  onEnabledChange,
  onPayloadChange,
  onClose
}: QrPanelProps) {
  const copy = COPY[locale];
  const [draft, setDraft] = useState(payload ?? "");
  const [enableAttempted, setEnableAttempted] = useState(false);
  const bytes = utf8ByteLength(draft);
  const tooLong = bytes > LIMITS.maxQrPayloadBytes;

  useEffect(() => {
    setDraft((current) => current === "" ? (payload ?? "") : current);
  }, [payload]);

  const commit = () => {
    if (!tooLong && draft.length > 0) onPayloadChange(draft);
  };

  return (
    <section class="tool-panel wide" aria-labelledby="qr-panel-title">
      <header class="panel-header">
        <h2 class="panel-title" id="qr-panel-title">{copy.title}</h2>
        <button class="panel-close" type="button" onClick={onClose}>{copy.close}</button>
      </header>
      <div class="setting-row">
        <span class="menu-label"><Icon name="qr" />{copy.enabled}</span>
        <button
          aria-checked={enabled}
          aria-label={copy.enabled}
          class={`switch ${enabled ? "is-on" : ""}`}
          role="switch"
          type="button"
          onClick={() => {
            if (enabled) {
              onEnabledChange(false);
              return;
            }
            if (draft.length === 0 || tooLong) {
              setEnableAttempted(true);
              return;
            }
            onPayloadChange(draft);
            onEnabledChange(true);
            setEnableAttempted(false);
          }}
        />
      </div>
      <p class="field-help">{copy.help}</p>
      <label class="section-label" for="qr-payload">{copy.payload}</label>
      <textarea
        class="textarea-input"
        id="qr-payload"
        placeholder={copy.placeholder}
        rows={5}
        value={draft}
        onBlur={commit}
        onInput={(event) => setDraft(event.currentTarget.value)}
      />
      <div class="character-count">
        <span>{draft.length === 0 ? copy.empty : ""}</span>
        <span class={tooLong ? "error-text" : ""}>{bytes}/{LIMITS.maxQrPayloadBytes} {copy.bytes}</span>
      </div>
      {enableAttempted && draft.length === 0 ? <p class="error-text" role="alert">{copy.empty}</p> : null}
      {tooLong ? <p class="error-text" role="alert">{copy.tooLong}</p> : null}
      <div class="button-row">
        <button class="primary-button" disabled={tooLong || draft.length === 0} type="button" onClick={commit}>
          {locale === "zh-TW" ? "套用" : "Apply"}
        </button>
      </div>
    </section>
  );
}
