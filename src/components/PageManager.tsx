import type { DragEvent } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

import { codePointLength } from "../domain/defaults";
import type { BoardPageV1, Locale } from "../domain/types";
import { getTranslator } from "../i18n";
import { Icon } from "./Icon";

export interface PageManagerProps {
  pages: BoardPageV1[];
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

function truncateCodePoints(value: string, limit: number): string {
  return Array.from(value).slice(0, limit).join("");
}

function duplicateName(name: string, locale: Locale): string {
  const suffix = locale === "zh-TW" ? " 副本" : " copy";
  return `${truncateCodePoints(name, PAGE_NAME_LIMIT - codePointLength(suffix))}${suffix}`;
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
  const [renamingPageId, setRenamingPageId] = useState<string | null>(null);
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

  const handleDrop = (event: DragEvent<HTMLButtonElement>, toIndex: number) => {
    event.preventDefault();
    if (draggedPageId) onMove(draggedPageId, toIndex);
    setDraggedPageId(null);
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

      <ul class="page-list" aria-label={t("pages.title")}>
        {pages.map((page, index) => (
          <li key={page.id}>
            <button
              aria-current={page.id === activePageId ? "page" : undefined}
              class={`page-row ${page.id === activePageId ? "is-active" : ""}`}
              draggable
              onClick={() => onSelect(page.id)}
              onDragEnd={() => setDraggedPageId(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => {
                setDraggedPageId(page.id);
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", page.id);
                }
              }}
              onDrop={(event) => handleDrop(event, index)}
              type="button"
            >
              <span class="page-index">{index + 1}</span>
              <span class="page-name">{page.name}</span>
              <span aria-hidden="true" class="menu-value">
                {page.id === activePageId ? (locale === "zh-TW" ? "目前" : "Current") : ""}
              </span>
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
