import Link from "next/link";

export type NoteDocCardData = {
  key: string;
  href: string;
  title: string;
  subtitle?: string | null;
  preview?: string | null;
  dateLabel: string;
  isLive?: boolean;
  chip?: { label: string; tone: "live" | "paused" | "done" | "failed" };
};

const CHIP_TONES: Record<string, string> = {
  live: "bg-rose-500 text-white",
  paused: "bg-amber-500 text-white",
  done: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  failed: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

/** Google Docs–style note thumbnail — preview pane + title footer. */
export function NoteDocCard({ card }: { card: NoteDocCardData }) {
  return (
    <Link
      href={card.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-800"
    >
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
    </Link>
  );
}

export function NotesDocGrid({ cards }: { cards: NoteDocCardData[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {cards.map((c) => (
        <NoteDocCard key={c.key} card={c} />
      ))}
    </div>
  );
}
