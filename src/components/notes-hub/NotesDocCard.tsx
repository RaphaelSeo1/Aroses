import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { NoteActionsMenu } from "@/components/notes-hub/NotesHubSidebar";
import type { NoteDocCardData } from "@/lib/notes/hub-types";
import { noteDragId } from "@/lib/notes/hub-types";

const CHIP_TONES: Record<string, string> = {
  live: "bg-rose-500 text-white",
  paused: "bg-amber-500 text-white",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function CardInner({ card }: { card: NoteDocCardData }) {
  return (
    <>
      <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden border-b border-zinc-100 bg-[#fafafa] p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        {card.preview ? (
          <div className="pointer-events-none absolute inset-3 select-none space-y-1.5 overflow-hidden opacity-90">
            <div className="h-1.5 w-2/3 rounded-sm bg-zinc-300/80 dark:bg-zinc-600/60" />
            <div className="h-1 w-full rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <div className="h-1 w-[92%] rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <div className="h-1 w-[85%] rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <p className="mt-1 line-clamp-4 text-[9px] leading-[1.35] text-zinc-500 dark:text-zinc-400">
              {card.preview}
            </p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[10px] italic text-zinc-400 dark:text-zinc-600">
              No written notes yet
            </p>
          </div>
        )}
        {card.isLive ? (
          <span className="absolute right-2 top-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            Live
          </span>
        ) : card.chip ? (
          <span
            className={`absolute right-2 top-2 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${CHIP_TONES[card.chip.tone]}`}
          >
            {card.chip.label}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-0.5 px-2.5 py-2 pr-9">
        <p className="truncate text-[11px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
          {card.title}
        </p>
        <p className="truncate text-[10px] leading-4 text-zinc-500 dark:text-zinc-500">
          {card.subtitle || "\u00a0"}
        </p>
        <p className="truncate text-[10px] leading-4 text-zinc-400 dark:text-zinc-600">
          {card.dateLabel || "\u00a0"}
        </p>
      </div>
    </>
  );
}

const cardShell =
  "group flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm transition dark:border-zinc-700 dark:bg-zinc-950";

/** Google Docs–style note thumbnail — preview pane + title footer. */
export function NoteDocCard({
  card,
  manageMode = false,
  selected = false,
  onToggleSelect,
  draggableNotes = false,
  onRenameNote,
  onDeleteNote,
}: {
  card: NoteDocCardData;
  manageMode?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
  draggableNotes?: boolean;
  onRenameNote?: (card: NoteDocCardData) => void;
  onDeleteNote?: (card: NoteDocCardData) => void;
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
    isDragging,
  } = useDraggable({
    id: noteDragId(card.key, "grid"),
    data: { type: "note", cardKey: card.key },
    disabled: !canDrag,
  });

  // Keep the card in place — DragOverlay shows the floating chip.
  const dragStyle = canDrag && isDragging ? { opacity: 0.45 } : undefined;

  const dragHandle = canDrag ? (
    <button
      type="button"
      {...listeners}
      {...attributes}
      className="absolute left-2 top-2 z-10 flex h-6 w-6 cursor-grab touch-none items-center justify-center rounded-md bg-white/90 text-zinc-400 shadow-sm ring-1 ring-zinc-200 hover:text-zinc-600 active:cursor-grabbing dark:bg-zinc-900/90 dark:ring-zinc-700"
      aria-label="Drag to move note"
      onClick={(e) => e.preventDefault()}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M8 6h8M8 12h8M8 18h8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </button>
  ) : null;
  if (manageMode && card.deletable !== false && onToggleSelect) {
    return (
      <button
        type="button"
        onClick={onToggleSelect}
        className={`${cardShell} text-left hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:hover:border-violet-800 ${
          selected
            ? "border-violet-400 ring-2 ring-violet-400/40"
            : "border-zinc-200/90"
        }`}
      >
        <div className="relative flex h-full flex-col">
          {selected ? (
            <span className="absolute left-2 top-2 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">
              ✓
            </span>
          ) : (
            <span className="absolute left-2 top-2 z-10 h-5 w-5 rounded-full border-2 border-zinc-300 bg-white/90 dark:border-zinc-600 dark:bg-zinc-900/90" />
          )}
          <CardInner card={card} />
        </div>
      </button>
    );
  }

  if (manageMode && card.deletable === false) {
    return (
      <div
        className={`${cardShell} cursor-not-allowed opacity-60`}
        title="This note cannot be deleted from here"
      >
        <CardInner card={card} />
      </div>
    );
  }

  return (
    <div
      ref={canDrag ? setNodeRef : undefined}
      style={dragStyle}
      className="group relative h-full"
    >
      <Link
        href={card.href}
        className={`${cardShell} hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:hover:border-violet-800`}
      >
        {dragHandle}
        <CardInner card={card} />
      </Link>
      {!manageMode && (onRenameNote || onDeleteNote) ? (
        <div
          className="absolute bottom-2 right-1 z-10 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          onClick={(e) => e.preventDefault()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <NoteActionsMenu
            card={card}
            onRename={onRenameNote}
            onDelete={onDeleteNote}
          />
        </div>
      ) : null}
    </div>
  );
}

export function NotesDocGrid({
  cards,
  manageMode,
  selectedKeys,
  onToggleSelect,
  draggableNotes,
  onRenameNote,
  onDeleteNote,
}: {
  cards: NoteDocCardData[];
  manageMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  draggableNotes?: boolean;
  onRenameNote?: (card: NoteDocCardData) => void;
  onDeleteNote?: (card: NoteDocCardData) => void;
}) {
  return (
    <div className="grid grid-cols-2 items-stretch gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {cards.map((c) => (
        <NoteDocCard
          key={c.key}
          card={c}
          manageMode={manageMode}
          selected={selectedKeys?.has(c.key)}
          onToggleSelect={
            onToggleSelect ? () => onToggleSelect(c.key) : undefined
          }
          draggableNotes={draggableNotes}
          onRenameNote={onRenameNote}
          onDeleteNote={onDeleteNote}
        />
      ))}
    </div>
  );
}
