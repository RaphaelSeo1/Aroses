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
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
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
  return (
    <ItemMoreMenu
      ariaLabel={`Options for ${section.title}`}
      align={align}
      items={[
        { label: "Rename", onSelect: onRename },
        { label: "Delete section", onSelect: onDelete, tone: "danger" },
      ]}
    />
  );
}

function ItemMoreMenu({
  ariaLabel,
  items,
  align = "right",
}: {
  ariaLabel: string;
  items: Array<{
    label: string;
    onSelect?: () => void;
    tone?: "danger";
    children?: Array<{ label: string; onSelect: () => void }>;
  }>;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setOpenSub(null);
      }
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
          setOpenSub(null);
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-black/5 hover:text-zinc-600 dark:hover:bg-white/5 dark:hover:text-zinc-300"
        aria-label={ariaLabel}
        aria-expanded={open}
      >
        <MoreIcon />
      </button>
      {open ? (
        <div
          className={`absolute top-full z-30 mt-1 min-w-[11rem] overflow-visible rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {items.map((item) =>
            item.children?.length ? (
              <div key={item.label} className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenSub((cur) =>
                      cur === item.label ? null : item.label
                    );
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <span>{item.label}</span>
                  <span className="text-zinc-400" aria-hidden>
                    ›
                  </span>
                </button>
                {openSub === item.label ? (
                  <div
                    className={`absolute top-0 z-40 max-h-64 min-w-[11rem] overflow-auto rounded-xl border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
                      align === "right"
                        ? "right-full mr-1"
                        : "left-full ml-1"
                    }`}
                  >
                    {item.children.map((child) => (
                      <button
                        key={child.label}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(false);
                          setOpenSub(null);
                          child.onSelect();
                        }}
                        className="flex w-full px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                      >
                        {child.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                key={item.label}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  setOpenSub(null);
                  item.onSelect?.();
                }}
                className={`flex w-full px-3 py-2 text-left text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                  item.tone === "danger"
                    ? "text-rose-600 dark:text-rose-400 dark:hover:bg-rose-950/40"
                    : "text-zinc-700 dark:text-zinc-200"
                }`}
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}

function noteCanRename(card: NoteDocCardData): boolean {
  const kind = card.ref?.kind;
  return kind === "standalone" || kind === "live" || kind === "tutor";
}

export type NoteMoveTarget = { id: string | null; label: string };

export function NoteActionsMenu({
  card,
  onRename,
  onDelete,
  onMove,
  moveTargets,
  onMoveToNewSection,
  align = "right",
}: {
  card: NoteDocCardData;
  onRename?: (card: NoteDocCardData) => void;
  onDelete?: (card: NoteDocCardData) => void;
  onMove?: (card: NoteDocCardData, sectionId: string | null) => void;
  moveTargets?: NoteMoveTarget[];
  onMoveToNewSection?: (card: NoteDocCardData) => void;
  align?: "left" | "right";
}) {
  if (card.deletable === false) return null;
  const canMove =
    Boolean(card.ref) &&
    Boolean(onMove) &&
    Boolean(moveTargets?.length || onMoveToNewSection);

  const items = [
    ...(onRename && noteCanRename(card)
      ? [{ label: "Rename", onSelect: () => onRename(card) }]
      : []),
    ...(canMove
      ? [
          {
            label: "Move to",
            children: [
              ...(moveTargets ?? []).map((t) => ({
                label: t.label,
                onSelect: () => onMove?.(card, t.id),
              })),
              ...(onMoveToNewSection
                ? [
                    {
                      label: "+ New section…",
                      onSelect: () => onMoveToNewSection(card),
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            label: "Delete",
            onSelect: () => onDelete(card),
            tone: "danger" as const,
          },
        ]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <ItemMoreMenu
      ariaLabel={`Options for ${card.title}`}
      align={align}
      items={items}
    />
  );
}

function NoteListItem({
  card,
  sectionId,
  manageMode,
  selected,
  onToggleSelect,
  draggableNotes,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
  moveTargets,
  onMoveToNewSection,
}: {
  card: NoteDocCardData;
  sectionId: string;
  manageMode: boolean;
  selected: boolean;
  onToggleSelect?: () => void;
  draggableNotes?: boolean;
  onRenameNote?: (card: NoteDocCardData) => void;
  onDeleteNote?: (card: NoteDocCardData) => void;
  onMoveNote?: (card: NoteDocCardData, sectionId: string | null) => void;
  moveTargets?: NoteMoveTarget[];
  onMoveToNewSection?: (card: NoteDocCardData) => void;
}) {
  const canDrag =
    draggableNotes &&
    !manageMode &&
    Boolean(card.ref) &&
    card.deletable !== false;

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: noteDragId(card.key, sectionId),
    data: { type: "note", cardKey: card.key },
    disabled: !canDrag,
  });

  // Keep the row in place — DragOverlay shows the floating chip.
  const style = canDrag && isDragging ? { opacity: 0.4 } : undefined;

  const moreMenu =
    !manageMode ? (
      <NoteActionsMenu
        card={card}
        onRename={onRenameNote}
        onDelete={onDeleteNote}
        onMove={onMoveNote}
        moveTargets={moveTargets}
        onMoveToNewSection={onMoveToNewSection}
      />
    ) : null;

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
      <div ref={setNodeRef} style={style} className="group flex items-center gap-0.5">
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
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg py-2 pr-1 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
        >
          {titleBlock}
        </Link>
        {moreMenu}
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-0.5">
      <Link
        href={card.href}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-800/80"
      >
        {titleBlock}
      </Link>
      {moreMenu}
    </div>
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
  onChangeSectionEmoji,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
  moveTargets,
  onMoveToNewSection,
  manageMode,
  selectedKeys,
  onToggleSelect,
  draggableNotes,
  noteDropDisabled,
  sortDisabled,
  moveReady,
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
  onChangeSectionEmoji?: (section: NoteHubSection, emoji: string) => void;
  onRenameNote?: (card: NoteDocCardData) => void;
  onDeleteNote?: (card: NoteDocCardData) => void;
  onMoveNote?: (card: NoteDocCardData, sectionId: string | null) => void;
  moveTargets?: NoteMoveTarget[];
  onMoveToNewSection?: (card: NoteDocCardData) => void;
  manageMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  draggableNotes?: boolean;
  noteDropDisabled?: boolean;
  sortDisabled?: boolean;
  /** Select mode with notes ready to move — highlight droppable folders. */
  moveReady?: boolean;
}) {
  const acceptsNotes = sectionAcceptsNoteDropFn(section);
  const custom = isCustomSection(section);
  // List notes under every section so Move lives on the sidebar ⋮ menu.
  const showNoteList = true;
  const showAsMoveTarget = false;

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
        className={`relative ${
          isOver && acceptsNotes && !noteDropDisabled
            ? "rounded-xl ring-2 ring-violet-400 dark:ring-violet-500"
            : showAsMoveTarget
              ? "rounded-xl ring-1 ring-violet-300/80 dark:ring-violet-700/80"
              : ""
        }`}
      >
        <div
          className={`group flex items-center gap-0.5 rounded-xl transition ${
            isActive
              ? "bg-violet-50 dark:bg-violet-950/40"
              : showAsMoveTarget
                ? "bg-violet-50/70 hover:bg-violet-100 dark:bg-violet-950/30 dark:hover:bg-violet-950/50"
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
              if (showNoteList && !isOpen) onToggleExpanded(section.id);
            }}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-2 text-left text-sm ${
              isActive
                ? "font-semibold text-violet-900 dark:text-violet-200"
                : "font-medium text-zinc-700 dark:text-zinc-300"
            }`}
            aria-expanded={showNoteList ? isOpen : undefined}
            title={
              showAsMoveTarget
                ? `Move selected notes to ${section.title}`
                : undefined
            }
          >
            {onChangeSectionEmoji ? (
              <span
                className="shrink-0"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <EmojiPickerButton
                  value={meta.icon}
                  size="sm"
                  ariaLabel={`Choose emoji for ${section.title}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base leading-none transition hover:bg-black/5 dark:hover:bg-white/5"
                  onChange={(emoji) => onChangeSectionEmoji(section, emoji)}
                />
              </span>
            ) : (
              <span className="text-base leading-none" aria-hidden>
                {meta.icon}
              </span>
            )}
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

          {showNoteList ? (
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
          ) : (
            <span className="mr-1 w-7 shrink-0" aria-hidden />
          )}
        </div>
      </div>

      {showNoteList && isOpen ? (
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
                  sectionId={section.id}
                  manageMode={Boolean(manageMode)}
                  selected={selectedKeys?.has(card.key) ?? false}
                  onToggleSelect={
                    onToggleSelect ? () => onToggleSelect(card.key) : undefined
                  }
                  draggableNotes={draggableNotes}
                  onRenameNote={onRenameNote}
                  onDeleteNote={onDeleteNote}
                  onMoveNote={onMoveNote}
                  moveTargets={moveTargets}
                  onMoveToNewSection={onMoveToNewSection}
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
  onChangeSectionEmoji,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
  moveTargets,
  onMoveToNewSection,
  addingSection,
  draggableNotes,
  dragKind,
  moveReady,
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
  onChangeSectionEmoji?: (section: NoteHubSection, emoji: string) => void;
  onRenameNote?: (card: NoteDocCardData) => void;
  onDeleteNote?: (card: NoteDocCardData) => void;
  onMoveNote?: (card: NoteDocCardData, sectionId: string | null) => void;
  moveTargets?: NoteMoveTarget[];
  onMoveToNewSection?: (card: NoteDocCardData) => void;
  addingSection?: boolean;
  draggableNotes?: boolean;
  dragKind?: "note" | "section" | null;
  moveReady?: boolean;
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
      {moveReady ? (
        <p className="mb-2 text-[10px] leading-relaxed text-violet-600 dark:text-violet-300">
          Click My notes or a folder to move the selected notes
        </p>
      ) : draggableNotes && !sortDisabled ? (
        <p className="mb-2 hidden text-[10px] leading-relaxed text-zinc-400 md:block">
          Drag ≡ to reorder · open a section and use ⋮ → Move to
        </p>
      ) : null}
      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1">
          {sections.map((section) => {
            const defaults = SECTION_META[section.id];
            const meta = isCustomSection(section)
              ? {
                  icon:
                    typeof section.emoji === "string" && section.emoji.trim()
                      ? section.emoji.trim()
                      : CUSTOM_SECTION_META.icon,
                  emptyLabel: CUSTOM_SECTION_META.emptyLabel,
                }
              : {
                  icon:
                    typeof section.emoji === "string" && section.emoji.trim()
                      ? section.emoji.trim()
                      : (defaults?.icon ?? "📄"),
                  emptyLabel: defaults?.emptyLabel ?? "Nothing here",
                };
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
                onChangeSectionEmoji={onChangeSectionEmoji}
                onRenameNote={onRenameNote}
                onDeleteNote={onDeleteNote}
                onMoveNote={onMoveNote}
                moveTargets={moveTargets}
                onMoveToNewSection={onMoveToNewSection}
                manageMode={manageMode}
                selectedKeys={selectedKeys}
                onToggleSelect={onToggleSelect}
                draggableNotes={draggableNotes}
                noteDropDisabled={noteDropDisabled}
                sortDisabled={sortDisabled}
                moveReady={moveReady}
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
