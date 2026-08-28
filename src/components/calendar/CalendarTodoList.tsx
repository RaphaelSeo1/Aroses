"use client";

import { useState, type DragEvent, type FormEvent } from "react";
import { alertDialog, confirmDialog, promptDialog } from "@/components/AppDialogs";
import { CalendarItemRow } from "@/components/calendar/CalendarItemRow";
import { CALENDAR_DND_TYPE } from "@/lib/calendar/grid";
import { CALENDAR_SECTIONS_MAX, groupTodosBySection } from "@/lib/calendar/sections";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { CalendarItem, CalendarTodoSection } from "@/types/calendar";

export function CalendarTodoList({
  items,
  sections,
  loading,
  error,
  onAdd,
  onToggle,
  onDelete,
  onOpen,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  onMoveToSection,
}: {
  items: CalendarItem[];
  sections: CalendarTodoSection[];
  loading?: boolean;
  error?: string | null;
  onAdd: (title: string, sectionId: string | null) => Promise<void>;
  onToggle: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onOpen: (item: CalendarItem) => void;
  onAddSection: (title: string) => Promise<unknown>;
  onRenameSection: (id: string, title: string) => Promise<unknown>;
  onDeleteSection: (id: string) => Promise<unknown>;
  onMoveToSection: (itemId: string, sectionId: string | null) => void;
}) {
  const t = useT();
  const [showDone, setShowDone] = useState(false);
  const [sectionBusy, setSectionBusy] = useState(false);

  const open = items.filter((i) => !i.completedAt);
  const done = items.filter((i) => i.completedAt);
  const grouped = groupTodosBySection(open, sections);
  const sectioned = sections.length > 0;

  const createSection = async () => {
    if (sectionBusy || sections.length >= CALENDAR_SECTIONS_MAX) return;
    const title = await promptDialog({
      title: t.calendar.addSection,
      label: t.calendar.sectionName,
      placeholder: t.calendar.sectionNamePlaceholder,
      defaultValue: t.calendar.newSectionDefault,
    });
    if (!title?.trim()) return;
    setSectionBusy(true);
    try {
      await onAddSection(title.trim());
    } catch (e) {
      await alertDialog({
        title: t.calendar.saveError,
        body: e instanceof Error ? e.message : t.calendar.saveError,
      });
    } finally {
      setSectionBusy(false);
    }
  };

  const renameSection = async (section: CalendarTodoSection) => {
    const title = await promptDialog({
      title: t.calendar.renameSection,
      label: t.calendar.sectionName,
      placeholder: t.calendar.sectionNamePlaceholder,
      defaultValue: section.title,
    });
    if (!title?.trim() || title.trim() === section.title) return;
    try {
      await onRenameSection(section.id, title.trim());
    } catch (e) {
      await alertDialog({
        title: t.calendar.saveError,
        body: e instanceof Error ? e.message : t.calendar.saveError,
      });
    }
  };

  const deleteSection = async (section: CalendarTodoSection) => {
    const ok = await confirmDialog({
      title: t.calendar.deleteSection,
      body: t.calendar.deleteSectionConfirm,
      tone: "danger",
      confirmLabel: t.calendar.delete,
    });
    if (!ok) return;
    try {
      await onDeleteSection(section.id);
    } catch (e) {
      await alertDialog({
        title: t.calendar.deleteError,
        body: e instanceof Error ? e.message : t.calendar.deleteError,
      });
    }
  };

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.04] dark:border-zinc-800 dark:bg-zinc-950/80">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {t.calendar.todosTitle}
          </p>
          <p className="mt-0.5 text-xs text-zinc-400">{t.calendar.todosHint}</p>
        </div>
        <button
          type="button"
          onClick={() => void createSection()}
          disabled={sectionBusy || sections.length >= CALENDAR_SECTIONS_MAX}
          className="shrink-0 rounded-full border border-zinc-200 px-3 py-1.5 text-[12px] font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {t.calendar.addSection}
        </button>
      </div>

      {loading ? (
        <p className="mt-3 py-3 text-sm text-zinc-400">{t.common.loading}</p>
      ) : error ? (
        <p className="mt-3 py-3 text-sm text-red-600">{error}</p>
      ) : sectioned ? (
        <div className="mt-3 space-y-4">
          {grouped.map((group) => (
            <TodoSectionBlock
              key={group.section?.id ?? "inbox"}
              title={group.section?.title ?? t.calendar.todosInbox}
              items={group.items}
              emptyLabel={t.calendar.emptySection}
              canManage={Boolean(group.section)}
              onRename={
                group.section
                  ? () => void renameSection(group.section!)
                  : undefined
              }
              onDelete={
                group.section
                  ? () => void deleteSection(group.section!)
                  : undefined
              }
              onAdd={(title) => onAdd(title, group.section?.id ?? null)}
              onToggle={onToggle}
              onDeleteItem={onDelete}
              onOpen={onOpen}
              onDropItem={(itemId) =>
                onMoveToSection(itemId, group.section?.id ?? null)
              }
              renameLabel={t.calendar.renameSection}
              deleteLabel={t.calendar.delete}
            />
          ))}
        </div>
      ) : (
        <FlatTodoList
          items={open}
          emptyLabel={t.calendar.emptyTodos}
          onAdd={(title) => onAdd(title, null)}
          onToggle={onToggle}
          onDelete={onDelete}
          onOpen={onOpen}
        />
      )}

      {done.length > 0 ? (
        <div className="mt-3 border-t border-zinc-100 pt-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={() => setShowDone((v) => !v)}
            className="text-[12px] font-semibold text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          >
            {showDone
              ? t.calendar.hideCompleted
              : `${t.calendar.showCompleted} (${done.length})`}
          </button>
          {showDone
            ? done.map((item) => (
                <CalendarItemRow
                  key={item.id}
                  item={item}
                  showDate={Boolean(item.startsAt)}
                  onToggle={() => onToggle(item)}
                  onDelete={() => onDelete(item)}
                  onOpen={() => onOpen(item)}
                />
              ))
            : null}
        </div>
      ) : null}
    </section>
  );
}

function FlatTodoList({
  items,
  emptyLabel,
  onAdd,
  onToggle,
  onDelete,
  onOpen,
}: {
  items: CalendarItem[];
  emptyLabel: string;
  onAdd: (title: string) => Promise<void>;
  onToggle: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  return (
    <>
      <TodoAddForm onAdd={onAdd} />
      <div className="mt-3 space-y-0.5">
        {items.length === 0 ? (
          <p className="py-3 text-sm text-zinc-400">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <DraggableTodo
              key={item.id}
              item={item}
              onToggle={onToggle}
              onDelete={onDelete}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </>
  );
}

function TodoSectionBlock({
  title,
  items,
  emptyLabel,
  canManage,
  onRename,
  onDelete,
  onAdd,
  onToggle,
  onDeleteItem,
  onOpen,
  onDropItem,
  renameLabel,
  deleteLabel,
}: {
  title: string;
  items: CalendarItem[];
  emptyLabel: string;
  canManage: boolean;
  onRename?: () => void;
  onDelete?: () => void;
  onAdd: (title: string) => Promise<void>;
  onToggle: (item: CalendarItem) => void;
  onDeleteItem: (item: CalendarItem) => void;
  onOpen: (item: CalendarItem) => void;
  onDropItem: (itemId: string) => void;
  renameLabel: string;
  deleteLabel: string;
}) {
  const [over, setOver] = useState(false);

  const onDragOver = (e: DragEvent) => {
    if (![...e.dataTransfer.types].includes(CALENDAR_DND_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setOver(true);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const id = e.dataTransfer.getData(CALENDAR_DND_TYPE);
    if (id) onDropItem(id);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-2xl border px-3 py-3 ${
        over
          ? "border-brand/50 bg-brand/5"
          : "border-zinc-100 dark:border-zinc-800"
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        {canManage && onRename ? (
          <button
            type="button"
            onClick={onRename}
            className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
            title={renameLabel}
          >
            {title}
          </button>
        ) : (
          <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-zinc-700 dark:text-zinc-200">
            {title}
          </p>
        )}
        {canManage && onDelete ? (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 text-[11px] font-semibold text-zinc-400 hover:text-red-600"
          >
            {deleteLabel}
          </button>
        ) : null}
      </div>
      <TodoAddForm onAdd={onAdd} compact />
      <div className="mt-2 space-y-0.5">
        {items.length === 0 ? (
          <p className="py-2 text-[12px] text-zinc-400">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <DraggableTodo
              key={item.id}
              item={item}
              onToggle={onToggle}
              onDelete={onDeleteItem}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </div>
  );
}

function TodoAddForm({
  onAdd,
  compact = false,
}: {
  onAdd: (title: string) => Promise<void>;
  compact?: boolean;
}) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAdd(title);
      setDraft("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className={`${compact ? "mt-0" : "mt-3"} flex gap-2`}
    >
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value.slice(0, 200))}
        placeholder={t.calendar.addTodoPlaceholder}
        className="min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
      />
      <button
        type="submit"
        disabled={busy || !draft.trim()}
        className="rounded-full bg-brand px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-brand-hover disabled:opacity-40"
      >
        {t.calendar.add}
      </button>
    </form>
  );
}

function DraggableTodo({
  item,
  onToggle,
  onDelete,
  onOpen,
}: {
  item: CalendarItem;
  onToggle: (item: CalendarItem) => void;
  onDelete: (item: CalendarItem) => void;
  onOpen: (item: CalendarItem) => void;
}) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(CALENDAR_DND_TYPE, item.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="cursor-grab"
    >
      <CalendarItemRow
        item={item}
        showDate={Boolean(item.startsAt)}
        onToggle={() => onToggle(item)}
        onDelete={() => onDelete(item)}
        onOpen={() => onOpen(item)}
      />
    </div>
  );
}
