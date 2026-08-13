import type { JSX } from "preact";
import type { DragEvent } from "preact/compat";
import { useEffect, useRef, useState } from "preact/hooks";

import { codePointLength } from "../domain/defaults";
import type { BoardPageV2, Locale } from "../domain/types";
import { getTranslator } from "../i18n";
import { Icon } from "./Icon";

export interface PageManagerProps {
  pages: BoardPageV2[];
  activePageId: string;
  locale: Locale;
  maxPages: number;
  onAdd: () => void;
  onDuplicate: (pageId: string, name: string) => void;
  onRename: (pageId: string, name: string) => void;
  onMove: (pageId: string, toIndex: number) => void;
  onDelete: (pageId: string) => void;
  onSelect: (pageId: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}

const PAGE_NAME_LIMIT = 60;

interface PointerDragState {
  pageId: string;
  pointerId: number;
  sourceIndex: number;
  targetIndex: number;
}

function truncateCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

function duplicateName(name: string, locale: Locale): string {
  const suffix = locale === "zh-TW" ? " 副本" : " copy";
  return `${truncateCodePoints(name, PAGE_NAME_LIMIT - codePointLength(suffix))}${suffix}`;
}

function safelySetPointerCapture(target: HTMLButtonElement, pointerId: number): void {
  if (typeof target.setPointerCapture !== "function") return;
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Pointer capture is an enhancement. Continue dragging if a browser rejects it.
  }
}

function safelyReleasePointerCapture(target: HTMLButtonElement, pointerId: number): void {
  if (typeof target.releasePointerCapture !== "function") return;
  try {
    if (typeof target.hasPointerCapture !== "function" || target.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
  } catch {
    // The pointer can already be released after cancellation or platform gesture handling.
  }
}

export function PageManager({
  pages,
  activePageId,
  locale,
  maxPages,
  onAdd,
  onDuplicate,
  onRename,
  onMove,
  onDelete,
  onSelect,
  onPrevious,
  onNext,
  onClose,
}: PageManagerProps) {
  const [draggedPageId, setDraggedPageId] = useState<string | null>(null);
  const [dragTargetIndex, setDragTargetIndex] = useState<number | null>(null);
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const pointerDragRef = useRef<PointerDragState | null>(null);
  const activePage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const activeIndex = pages.findIndex((page) => page.id === activePage?.id);
  const [renameDraft, setRenameDraft] = useState(activePage?.name ?? "");
  const t = getTranslator(locale);
  const atLimit = pages.length >= maxPages;
  const renameLength = codePointLength(renameDraft);
  const renameInvalid = renameDraft.trim().length === 0 || renameLength > PAGE_NAME_LIMIT;

  useEffect(() => {
    if (renamingPageId !== activePage?.id) {
      setRenamingPageId(null);
      setRenameDraft(activePage?.name ?? "");
    }
  }, [activePage?.id, activePage?.name, renamingPageId]);

  const beginRename = () => {
    if (!activePage) return;
    setRenameDraft(activePage.name);
    setRenamingPageId(activePage.id);
  };

  const applyRename = () => {
    if (!activePage || renameInvalid) return;
    onRename(activePage.id, renameDraft);
    setRenamingPageId(null);
  };

  const clearPointerDrag = () => {
    pointerDragRef.current = null;
    setDraggedPageId(null);
    setDragTargetIndex(null);
  };

  const targetIndexAt = (clientY: number, fallback: number): number => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-page-index]");
    if (!items?.length) return fallback;

    let closestIndex = fallback;
    let closestDistance = Number.POSITIVE_INFINITY;
    items.forEach((item) => {
      const index = Number.parseInt(item.dataset.pageIndex ?? "", 10);
      if (!Number.isFinite(index)) return;
      const bounds = item.getBoundingClientRect();
      const distance = Math.abs(clientY - (bounds.top + bounds.height / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    return closestIndex;
  };

  const startPointerDrag = (
    event: JSX.TargetedPointerEvent<HTMLButtonElement>,
    pageId: string,
    sourceIndex: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    safelySetPointerCapture(event.currentTarget, event.pointerId);
    pointerDragRef.current = {
      pageId,
      pointerId: event.pointerId,
      sourceIndex,
      targetIndex: sourceIndex,
    };
    setDraggedPageId(pageId);
    setDragTargetIndex(sourceIndex);
  };

  const movePointerDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const targetIndex = targetIndexAt(event.clientY, drag.targetIndex);
    if (targetIndex === drag.targetIndex) return;
    pointerDragRef.current = { ...drag, targetIndex };
    setDragTargetIndex(targetIndex);
  };

  const finishPointerDrag = (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    setDraggedPageId(null);
    setDragTargetIndex(null);
    safelyReleasePointerCapture(event.currentTarget, event.pointerId);
    if (drag.targetIndex !== drag.sourceIndex) onMove(drag.pageId, drag.targetIndex);
  };

  const handleDrop = (event: DragEvent<HTMLLIElement>, toIndex: number) => {
    event.preventDefault();
    if (draggedPageId) onMove(draggedPageId, toIndex);
    setDraggedPageId(null);
    setDragTargetIndex(null);
  };

  return (
    <section aria-labelledby="pages-panel-title" class="tool-panel wide">
      <div class="page-panel-header">
        <div>
          <h2 class="panel-title" id="pages-panel-title">{t("pages.title")}</h2>
          <span class="menu-value">
            {t("pages.pageCount", { current: activeIndex + 1, total: pages.length })}
          </span>
        </div>
        <div class="page-navigation">
          <button
            aria-label={t("common.previous")}
            class="icon-button"
            disabled={activeIndex <= 0}
            onClick={onPrevious}
            title={t("common.previous")}
            type="button"
          >
            <Icon name="arrow-left" />
          </button>
          <button
            aria-label={t("common.next")}
            class="icon-button"
            disabled={activeIndex < 0 || activeIndex >= pages.length - 1}
            onClick={onNext}
            title={t("common.next")}
            type="button"
          >
            <Icon name="arrow-right" />
          </button>
          <button class="panel-close" onClick={onClose} type="button">
            {t("common.close")}
          </button>
        </div>
      </div>

      <ul class="page-list" aria-label={t("pages.title")} ref={listRef}>
        {pages.map((page, index) => (
          <li
            class={`page-list-item ${draggedPageId === page.id ? "is-pointer-dragging" : ""} ${dragTargetIndex === index ? "is-drag-target" : ""}`}
            data-page-index={index}
            key={page.id}
            onDragOver={(event) => {
              event.preventDefault();
              setDragTargetIndex(index);
            }}
            onDrop={(event) => handleDrop(event, index)}
            style={{
              alignItems: "center",
              display: "grid",
              gap: "4px",
              gridTemplateColumns: "minmax(0, 1fr) 44px",
            }}
          >
            <button
              aria-current={page.id === activePageId ? "page" : undefined}
              class={`page-row page-select-button ${page.id === activePageId ? "is-active" : ""}`}
              draggable
              onClick={() => onSelect(page.id)}
              onDragEnd={() => {
                setDraggedPageId(null);
                setDragTargetIndex(null);
              }}
              onDragStart={(event) => {
                setDraggedPageId(page.id);
                setDragTargetIndex(index);
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", page.id);
                }
              }}
              type="button"
            >
              <span class="page-index">{index + 1}</span>
              <span class="page-name">{page.name}</span>
              <span aria-hidden="true" class="menu-value">
                {page.id === activePageId ? (locale === "zh-TW" ? "目前" : "Current") : ""}
              </span>
            </button>
            <button
              aria-label={locale === "zh-TW" ? `拖曳排序 ${page.name}` : `Drag to reorder ${page.name}`}
              class="icon-button page-drag-handle"
              onClick={(event) => event.preventDefault()}
              onLostPointerCapture={() => {
                if (pointerDragRef.current?.pageId === page.id) clearPointerDrag();
              }}
              onPointerCancel={clearPointerDrag}
              onPointerDown={(event) => startPointerDrag(event, page.id, index)}
              onPointerMove={movePointerDrag}
              onPointerUp={finishPointerDrag}
              style={{
                height: "44px",
                minHeight: "44px",
                minWidth: "44px",
                padding: 0,
                touchAction: "none",
                width: "44px",
              }}
              title={locale === "zh-TW" ? "拖曳排序" : "Drag to reorder"}
              type="button"
            >
              <Icon name="grip" />
            </button>
          </li>
        ))}
      </ul>

      {activePage ? (
        <>
          <div class="panel-divider" />
          {renamingPageId === activePage.id ? (
            <div>
              <label class="section-label" for="page-rename-input">{t("pages.rename")}</label>
              <input
                aria-describedby="page-rename-count"
                aria-invalid={renameInvalid ? "true" : undefined}
                class="text-input"
                id="page-rename-input"
                maxLength={PAGE_NAME_LIMIT * 2}
                onInput={(event) => setRenameDraft(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applyRename();
                  } else if (event.key === "Escape") {
                    event.stopPropagation();
                    setRenamingPageId(null);
                  }
                }}
                value={renameDraft}
              />
              <div class="character-count" id="page-rename-count">
                <span>{activePage.name}</span>
                <span>{renameLength} / {PAGE_NAME_LIMIT}</span>
              </div>
              {renameInvalid ? (
                <p class="error-text">
                  {locale === "zh-TW" ? "頁名需為 1 到 60 個字元" : "Page names must be 1 to 60 characters"}
                </p>
              ) : null}
              <div class="button-row">
                <button class="secondary-button" onClick={() => setRenamingPageId(null)} type="button">
                  {t("common.cancel")}
                </button>
                <button class="primary-button" disabled={renameInvalid} onClick={applyRename} type="button">
                  {t("common.apply")}
                </button>
              </div>
            </div>
          ) : (
            <div class="button-row">
              <button class="secondary-button" onClick={beginRename} type="button">
                {t("pages.rename")}
              </button>
              <button
                class="secondary-button"
                disabled={atLimit}
                onClick={() => onDuplicate(activePage.id, duplicateName(activePage.name, locale))}
                type="button"
              >
                <Icon name="copy" />
                <span>{t("common.duplicate")}</span>
              </button>
              <button
                class="secondary-button"
                disabled={activeIndex <= 0}
                onClick={() => onMove(activePage.id, activeIndex - 1)}
                type="button"
              >
                {t("common.moveUp")}
              </button>
              <button
                class="secondary-button"
                disabled={activeIndex >= pages.length - 1}
                onClick={() => onMove(activePage.id, activeIndex + 1)}
                type="button"
              >
                {t("common.moveDown")}
              </button>
              <button
                class="danger-button"
                disabled={pages.length <= 1}
                onClick={() => onDelete(activePage.id)}
                type="button"
              >
                {t("common.delete")}
              </button>
            </div>
          )}
        </>
      ) : null}

      <button class="primary-button" disabled={atLimit} onClick={onAdd} type="button">
        {t("pages.add")}
      </button>
      {atLimit ? <p class="warning-text">{t("pages.maxReached", { limit: maxPages })}</p> : null}
      {pages.length <= 1 ? <p class="field-help">{t("pages.cannotDeleteLast")}</p> : null}
    </section>
  );
}
