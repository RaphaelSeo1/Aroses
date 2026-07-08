import Link from "next/link";

/** Minimal home-screen entry to the notes library — no previews, just a link. */
export function HomeNotesEntryLink({
  label,
  hint,
}: {
  label: string;
  hint: string;
}) {
  return (
    <Link
      href="/notes"
      className="group block overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/95 p-4 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/80 dark:ring-zinc-700/30 dark:hover:border-violet-800"
    >
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 ring-1 ring-violet-200/70 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900/50">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            <path d="M8 7h8M8 11h6" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {label}
          </p>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {hint}
          </p>
        </div>
        <span
          className="shrink-0 text-lg text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-violet-600 dark:text-zinc-600 dark:group-hover:text-violet-400"
          aria-hidden
        >
          →
        </span>
      </div>
    </Link>
  );
}
