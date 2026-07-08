import Link from "next/link";
import type { HomeNotePreviewItem } from "@/lib/load-home-notes-preview";

const SOURCE_ICON: Record<HomeNotePreviewItem["source"], string> = {
  live: "⏺",
  tutor: "💬",
  course: "📓",
  lesson: "✎",
};

function formatOpened(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function NoteDocCard({ item }: { item: HomeNotePreviewItem }) {
  const isLive =
    item.source === "live" &&
    (item.status === "recording" || item.status === "paused");

  return (
    <Link
      href={item.href}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-violet-800"
    >
      {/* Mini document preview — Google Docs thumbnail feel */}
      <div className="relative aspect-[4/3] overflow-hidden border-b border-zinc-100 bg-[#fafafa] p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        {item.preview ? (
          <div className="pointer-events-none select-none space-y-1.5 opacity-90">
            <div className="h-1.5 w-2/3 rounded-sm bg-zinc-300/80 dark:bg-zinc-600/60" />
            <div className="h-1 w-full rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <div className="h-1 w-[92%] rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <div className="h-1 w-[85%] rounded-sm bg-zinc-200/90 dark:bg-zinc-700/50" />
            <p className="mt-1 line-clamp-4 text-[9px] leading-[1.35] text-zinc-500 dark:text-zinc-400">
              {item.preview}
            </p>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-[10px] italic text-zinc-400 dark:text-zinc-600">
              No written notes yet
            </p>
          </div>
        )}
        {isLive ? (
          <span className="absolute right-2 top-2 rounded-full bg-rose-500 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
            Live
          </span>
        ) : null}
      </div>

      {/* Footer — title + opened date */}
      <div className="flex min-h-[3.25rem] flex-col justify-center gap-0.5 px-2.5 py-2">
        <div className="flex items-start gap-1.5">
          <span className="mt-0.5 shrink-0 text-[11px]" aria-hidden>
            {SOURCE_ICON[item.source]}
          </span>
          <p className="line-clamp-2 text-[11px] font-semibold leading-snug text-zinc-800 dark:text-zinc-100">
            {item.title}
          </p>
        </div>
        {item.subtitle ? (
          <p className="truncate pl-4 text-[10px] text-zinc-500 dark:text-zinc-500">
            {item.subtitle}
          </p>
        ) : null}
        <p className="pl-4 text-[10px] text-zinc-400 dark:text-zinc-600">
          {formatOpened(item.updatedAt)}
        </p>
      </div>
    </Link>
  );
}

/**
 * Google Docs–style recent-notes grid for the home sidebar (and mobile strip).
 */
export function HomeNotesPreview({
  items,
  viewAllHref = "/notes",
  viewAllLabel = "View all notes",
  title = "Recent notes",
  emptyHint = "Notes from live lectures, tutor sessions, and courses will show up here.",
  layout = "grid",
}: {
  items: HomeNotePreviewItem[];
  viewAllHref?: string;
  viewAllLabel?: string;
  title?: string;
  emptyHint?: string;
  layout?: "grid" | "scroll";
}) {
  if (items.length === 0) {
    return (
      <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </p>
          <Link
            href={viewAllHref}
            className="text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
          >
            {viewAllLabel}
          </Link>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {emptyHint}
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-5 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          {title}
        </p>
        <Link
          href={viewAllHref}
          className="shrink-0 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
        >
          {viewAllLabel} →
        </Link>
      </div>

      {layout === "grid" ? (
        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((item) => (
            <NoteDocCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="-mx-1 mt-4 flex gap-3 overflow-x-auto px-1 pb-1 snap-x snap-mandatory">
          {items.map((item) => (
            <div key={item.id} className="w-[9.5rem] shrink-0 snap-start">
              <NoteDocCard item={item} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
