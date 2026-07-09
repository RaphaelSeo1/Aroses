"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { sectionAcceptsNoteDrop as sectionAcceptsNoteDropFn } from "@/lib/notes/hub-layout";
import {
  isCustomSection,
  type NoteDocCardData,
  type NoteHubSection,
  noteDragId,
  sectionDragId,
  dropTargetId,
} from "@/lib/notes/hub-types";

const SECTION_META: Record<string, { icon: string; emptyLabel: string }> = {
  standalone: { icon: "📝", emptyLabel: "No notes yet" },
  live: { icon: "🎙️", emptyLabel: "No live lectures" },
  tutor: { icon: "💬", emptyLabel: "No tutor sessions" },
  course: { icon: "📚", emptyLabel: "No course notes" },
};

const CUSTOM_SECTION_META = {
  icon: "📁",
  emptyLabel: "No notes in this section",
};

function DragHandleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h8M8 12h8M8 18h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

export function SectionMoreMenu({
  section,
  onRename,
  onDelete,
  align = "right",
}: {
  section: NoteHubSection;
  onRename: () => void;
  onDelete: () => void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-black/5 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-300"
        aria-label={`Options for ${section.title}`}
        aria-expanded={open}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          className={`absolute top-full z-30 mt-1 min-w-[10rem] overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onRename();
            }}
            className="flex w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="flex w-full px-3 py-2 text-left text-sm text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            Delete section
          </button>
        </div>
      ) : null}
    </div>
  );
}

function NoteListItem({
  card,
  manageMode,
  selected,
  onToggleSelect,
  draggableNotes,
}: {
  card: NoteDocCardData;
  manageMode: boolean;
  selected: boolean;
  onToggleSelect?: () => void;
  draggableNotes?: boolean;
}) {
  const canDrag =
    draggableNotes &&
    !manageMode &&
    card.ref?.kind === "standalone" &&
    card.deletable !== false;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: noteDragId(card.key),
    data: { type: "note", cardKey: card.key },
    disabled: !canDrag,
  });

  const style = canDrag
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.45 : undefined,
      }
    : undefined;

  const titleBlock = (
    <>
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">
        {card.title}
      </span>
      {card.isLive ? (
        <span className="shrink-0 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
          Live
        </span>
      ) : card.chip ? (
        <span className="shrink-0 text-[10px] font-medium text-zinc-400">
          {card.chip.label}
        </span>
      ) : null}
    </>
  );

  if (manageMode && card.deletable !== false && onToggleSelect) {
    return (
      <button
        type="button"
        onClick={onToggleSelect}
        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
          selected
            ? "bg-violet-100 text-violet-900 dark:bg-violet-950/50 dark:text-violet-200"
            : "hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
        }`}
      >
        <span
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] ${
            selected
              ? "border-violet-600 bg-violet-600 text-white"
              : "border-zinc-300 bg-white dark:border-zinc-600 dark:bg-zinc-900"
          }`}
        >
          {selected ? "✓" : ""}
        </span>
        {titleBlock}
      </button>
    );
  }

  if (canDrag) {
    return (
      <div ref={setNodeRef} style={style} className="flex items-center gap-1">
        <span
          {...listeners}
          {...attributes}
          className="flex shrink-0 cursor-grab touch-none px-1 text-zinc-300 active:cursor-grabbing dark:text-zinc-600"
          aria-label="Drag to move note"
        >
          <DragHandleIcon />
        </span>
        <Link
          href={card.href}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-2.5 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
        >
          {titleBlock}
        </Link>
      </div>
    );
  }

  return (
    <Link
      href={card.href}
      className="flex items-center gap-2 rounded-lg px-2.5 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
    >
      {titleBlock}
    </Link>
  );
}

function SortableSectionRow({
  section,
  meta,
  isActive,
  isOpen,
  count,
  onSectionSelect,
  onToggleExpanded,
  onRenameSection,
  onDeleteSection,
  manageMode,
  selectedKeys,
  onToggleSelect,
  draggableNotes,
  noteDropDisabled,
  sortDisabled,
}: {
  section: NoteHubSection;
  meta: { icon: string; emptyLabel: string };
  isActive: boolean;
  isOpen: boolean;
  count: number;
  onSectionSelect: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onRenameSection?: (section: NoteHubSection) => void;
  onDeleteSection?: (section: NoteHubSection) => void;
  manageMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  draggableNotes?: boolean;
  noteDropDisabled?: boolean;
  sortDisabled?: boolean;
}) {
  const acceptsNotes = sectionAcceptsNoteDropFn(section);
  const custom = isCustomSection(section);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sectionDragId(section.id),
    data: { type: "section", sectionId: section.id },
    disabled: sortDisabled,
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropTargetId(section.id),
    data: { type: "drop-target", sectionId: section.id },
    disabled: !acceptsNotes || noteDropDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    zIndex: isDragging ? 2 : undefined,
    position: "relative" as const,
  };

  const setRefs = (node: HTMLLIElement | null) => {
    setNodeRef(node);
  };

  return (
    <li ref={setRefs} style={style}>
      <div
        ref={acceptsNotes && !noteDropDisabled ? setDropRef : undefined}
        className={`relative ${isOver && acceptsNotes && !noteDropDisabled ? "rounded-xl ring-2 ring-violet-400 dark:ring-violet-500" : ""}`}
      >
        <div
          className={`group flex items-center gap-0.5 rounded-xl transition ${
            isActive
              ? "bg-violet-50 dark:bg-violet-950/40"
              : "hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
          }`}
        >
          {!sortDisabled ? (
            <button
              type="button"
              {...listeners}
              {...attributes}
              className="ml-1 flex h-8 w-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-zinc-300 hover:bg-black/5 hover:text-zinc-500 active:cursor-grabbing dark:text-zinc-600 dark:hover:text-zinc-400"
              aria-label={`Drag to reorder ${section.title}`}
              onClick={(e) => e.stopPropagation()}
            >
              <DragHandleIcon />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onSectionSelect(section.id);
              if (!isOpen) onToggleExpanded(section.id);
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-2 text-left text-sm ${
              isActive
                ? "font-semibold text-violet-900 dark:text-violet-200"
                : "font-medium text-zinc-700 dark:text-zinc-300"
            }`}
            aria-expanded={isOpen}
          >
            <span className="text-base leading-none" aria-hidden>
              {meta.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{section.title}</span>
            <span
              className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                isActive
                  ? "bg-violet-200/80 text-violet-800 dark:bg-violet-900/60 dark:text-violet-200"
                  : "bg-zinc-200/80 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              {count}
            </span>
          </button>

          {custom && onRenameSection && onDeleteSection ? (
            <SectionMoreMenu
              section={section}
              onRename={() => onRenameSection(section)}
              onDelete={() => onDeleteSection(section)}
            />
          ) : null}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpanded(section.id);
            }}
            className={`mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-zinc-400 transition hover:bg-black/5 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-300 ${
              isOpen ? "rotate-180" : ""
            }`}
            aria-label={isOpen ? "Collapse section" : "Expand section"}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
              <path
                d="M3 4.5L6 7.5L9 4.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {isOpen ? (
        <ul className="mb-2 ml-2 mt-0.5 space-y-0.5 border-l border-zinc-200 pl-2 dark:border-zinc-800">
          {count === 0 ? (
            <li className="px-2.5 py-2 text-xs italic text-zinc-400 dark:text-zinc-600">
              {meta.emptyLabel}
            </li>
          ) : (
            section.cards.map((card) => (
              <li key={card.key}>
                <NoteListItem
                  card={card}
                  manageMode={Boolean(manageMode)}
                  selected={selectedKeys?.has(card.key) ?? false}
                  onToggleSelect={
                    onToggleSelect ? () => onToggleSelect(card.key) : undefined
                  }
                  draggableNotes={draggableNotes}
                />
              </li>
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

export function NotesHubSidebar({
  sections,
  activeSectionId,
  onSectionSelect,
  manageMode,
  selectedKeys,
  onToggleSelect,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  addingSection,
  draggableNotes,
  dragKind,
}: {
  sections: NoteHubSection[];
  activeSectionId: string;
  onSectionSelect: (id: string) => void;
  manageMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  onAddSection?: () => void;
  onRenameSection?: (section: NoteHubSection) => void;
  onDeleteSection?: (section: NoteHubSection) => void;
  addingSection?: boolean;
  draggableNotes?: boolean;
  dragKind?: "note" | "section" | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const active = sections.find((s) => s.id === activeSectionId);
    if (active) initial.add(active.id);
    else if (sections[0]) initial.add(sections[0].id);
    return initial;
  });

  useEffect(() => {
    setExpanded((prev) => {
      if (prev.has(activeSectionId)) return prev;
      const next = new Set(prev);
      next.add(activeSectionId);
      return next;
    });
  }, [activeSectionId]);

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const sortableIds = sections.map((s) => sectionDragId(s.id));
  const noteDropDisabled = dragKind === "section";
  const sortDisabled = sections.length < 2;

  return (
    <nav
      className="w-full shrink-0 md:w-56 lg:w-60"
      aria-label="Notes sections"
    >
      <p className="mb-2 hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 md:block">
        Sections
      </p>
      {draggableNotes && !sortDisabled ? (
        <p className="mb-2 hidden text-[10px] leading-relaxed text-zinc-400 md:block">
          Drag ≡ to reorder any section · drag notes onto My notes or a folder
        </p>
      ) : null}
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {sections.map((section) => {
            const meta = isCustomSection(section)
              ? CUSTOM_SECTION_META
              : (SECTION_META[section.id] ?? {
                  icon: "📄",
                  emptyLabel: "Nothing here",
                });
            return (
              <SortableSectionRow
                key={section.id}
                section={section}
                meta={meta}
                isActive={section.id === activeSectionId}
                isOpen={expanded.has(section.id)}
                count={section.cards.length}
                onSectionSelect={onSectionSelect}
                onToggleExpanded={toggleExpanded}
                onRenameSection={onRenameSection}
                onDeleteSection={onDeleteSection}
                manageMode={manageMode}
                selectedKeys={selectedKeys}
                onToggleSelect={onToggleSelect}
                draggableNotes={draggableNotes}
                noteDropDisabled={noteDropDisabled}
                sortDisabled={sortDisabled}
              />
            );
          })}
        </ul>
      </SortableContext>

      {onAddSection ? (
        <button
          type="button"
          onClick={onAddSection}
          disabled={addingSection}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-600 transition hover:border-violet-300 hover:bg-violet-50/50 hover:text-violet-700 disabled:opacity-60 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-violet-800 dark:hover:bg-violet-950/30 dark:hover:text-violet-300"
        >
          {addingSection ? "Adding…" : "+ Add section"}
        </button>
      ) : null}
    </nav>
  );
}

export function getSectionSortableIds(sections: NoteHubSection[]): string[] {
  return sections.map((s) => sectionDragId(s.id));
}
