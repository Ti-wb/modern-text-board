import { useEffect, useState } from "preact/hooks";

import type { FontFamily, FontWeight } from "../domain/types";
import { isWebFontFamily } from "./catalog";
import { ensureWebFontReady, isWebFontReady } from "./runtime";

export function useFontRevision({
  fontFamily,
  fontWeight,
  onError,
  text,
}: {
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  onError?: () => void;
  text: string;
}): { ready: boolean; revision: number } {
  const [revision, setRevision] = useState(0);
  const readinessKey = `${fontFamily}:${fontWeight}:${text}`;
  const webFont = isWebFontFamily(fontFamily);
  const [readyKey, setReadyKey] = useState<string | null>(() =>
    webFont && isWebFontReady(fontFamily, fontWeight, text)
      ? readinessKey
      : null,
  );

  useEffect(() => {
    if (!webFont) return;
    if (isWebFontReady(fontFamily, fontWeight, text)) {
      setReadyKey(readinessKey);
      return;
    }
    let active = true;
    void ensureWebFontReady(fontFamily, fontWeight, text).then(
      () => {
        if (active) {
          setReadyKey(readinessKey);
          setRevision((current) => current + 1);
        }
      },
      () => {
        if (active) onError?.();
      },
    );
    return () => {
      active = false;
    };
  }, [fontFamily, fontWeight, onError, readinessKey, text, webFont]);

  return {
    ready:
      !webFont ||
      readyKey === readinessKey ||
      isWebFontReady(fontFamily, fontWeight, text),
    revision,
  };
}
