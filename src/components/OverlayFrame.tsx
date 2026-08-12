import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

import type { ToolbarEdge } from "../domain/types";

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "[contenteditable=true]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface OverlayFrameProps {
  edge: ToolbarEdge;
  offsetRatio: number;
  labelledBy: string;
  onClose: () => void;
  children: ComponentChildren;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !element.hidden &&
      element.getAttribute("aria-hidden") !== "true" &&
      !element.closest("[inert]"),
  );
}

export function OverlayFrame({
  edge,
  offsetRatio,
  labelledBy,
  onClose,
  children,
}: OverlayFrameProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    document.activeElement as HTMLElement | null,
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previouslyFocused = previouslyFocusedRef.current;

    const initialFocus =
      dialog.querySelector<HTMLElement>("[autofocus]") ??
      getFocusableElements(dialog)[0] ??
      dialog;
    initialFocus.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent) => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (event.key === "Escape") {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      const previouslyFocused = previouslyFocusedRef.current;
      requestAnimationFrame(() => {
        if (previouslyFocused?.isConnected) previouslyFocused.focus();
      });
      onCloseRef.current();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!dialog.contains(active)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const boundedOffset = Number.isFinite(offsetRatio)
    ? Math.min(1, Math.max(0, offsetRatio))
    : 0.5;

  return (
    <>
      <div
        aria-hidden="true"
        class="panel-scrim"
        onClick={() => onCloseRef.current()}
      />
      <div
        aria-labelledby={labelledBy}
        aria-modal="true"
        class={`tool-panel-wrap edge-${edge}`}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        style={`--toolbar-offset: ${boundedOffset}`}
        tabIndex={-1}
      >
        {children}
      </div>
    </>
  );
}
