import Link from "next/link";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
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
      <div className="relative aspect-[4/3] overflow-hidden border-b border-zinc-100 bg-[#fafafa] p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        {card.preview ? (
          <div className="pointer-events-none select-none space-y-1.5 opacity-90">
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

      <div className="flex min-h-[3.5rem] flex-col justify-center gap-0.5 px-2.5 py-2.5">
        <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
          {card.title}
        </p>
        {card.subtitle ? (
          <p className="truncate text-[10px] text-zinc-500 dark:text-zinc-500">
            {card.subtitle}
          </p>
        ) : null}
        <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
          {card.dateLabel}
        </p>
      </div>
    </>
  );
}

const cardShell =
  "group flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm transition dark:border-zinc-700 dark:bg-zinc-950";

/** Google Docs–style note thumbnail — preview pane + title footer. */
export function NoteDocCard({
  card,
  manageMode = false,
  selected = false,
  onToggleSelect,
  draggableNotes = false,
}: {
  card: NoteDocCardData;
  manageMode?: boolean;
  selected?: boolean;
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

  const dragStyle = canDrag
    ? {
        transform: CSS.Translate.toString(transform),
        opacity: isDragging ? 0.5 : undefined,
        zIndex: isDragging ? 2 : undefined,
      }
    : undefined;

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
        <div className="relative">
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
    <div ref={canDrag ? setNodeRef : undefined} style={dragStyle}>
      <Link
        href={card.href}
        className={`${cardShell} hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:hover:border-violet-800`}
      >
        {dragHandle}
        <CardInner card={card} />
      </Link>
    </div>
  );
}

export function NotesDocGrid({
  cards,
  manageMode,
  selectedKeys,
  onToggleSelect,
  draggableNotes,
}: {
  cards: NoteDocCardData[];
  manageMode?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (key: string) => void;
  draggableNotes?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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
        />
      ))}
    </div>
  );
}
