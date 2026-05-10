"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

export type ExploreCourseCard = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  user_id: string;
};

type ExploreFilter = "all" | "featured" | "popular" | "rated";

const CARD_GRADIENTS = [
  "from-rose-500/[0.22] via-orange-400/[0.14] to-amber-200/[0.08] dark:from-rose-600/[0.35] dark:via-red-950/[0.65] dark:to-zinc-950",
  "from-red-600/[0.2] via-rose-400/[0.12] to-orange-300/[0.07] dark:from-red-700/[0.32] dark:via-rose-950/[0.6] dark:to-zinc-950",
  "from-amber-500/[0.18] via-rose-500/[0.14] to-red-900/[0.06] dark:from-amber-600/[0.22] dark:via-rose-950/[0.55] dark:to-zinc-950",
  "from-orange-500/[0.2] via-red-500/[0.1] to-yellow-200/[0.06] dark:from-orange-600/[0.26] dark:via-red-950/[0.58] dark:to-zinc-950",
  "from-rose-600/[0.18] via-fuchsia-500/[0.08] to-orange-400/[0.08] dark:from-fuchsia-700/[0.2] dark:via-rose-950/[0.55] dark:to-zinc-950",
  "from-red-500/[0.16] via-amber-400/[0.14] to-rose-300/[0.08] dark:from-red-600/[0.28] dark:via-zinc-900 dark:to-zinc-950",
] as const;

function gradientIndex(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 997;
  return Math.abs(h) % CARD_GRADIENTS.length;
}

function sortNewestFirst(list: ExploreCourseCard[]) {
  return [...list].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

function applyFilter(
  courses: ExploreCourseCard[],
  filter: ExploreFilter
): ExploreCourseCard[] {
  switch (filter) {
    case "all":
      return sortNewestFirst(courses);
    case "featured":
      return sortNewestFirst(courses).slice(0, 6);
    case "popular": {
      const descLen = (s: string | null) => (s?.trim().length ?? 0);
      return [...courses].sort((a, b) => {
        const d = descLen(b.description) - descLen(a.description);
        if (d !== 0) return d;
        return (
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      });
    }
    case "rated":
      return [...courses].sort((a, b) => a.title.localeCompare(b.title));
    default:
      return sortNewestFirst(courses);
  }
}

const SIDEBAR: {
  id: ExploreFilter;
  label: string;
  hint: string;
}[] = [
  { id: "all", label: "All courses", hint: "Newest listings first" },
  { id: "featured", label: "Featured", hint: "Fresh spotlight picks" },
  {
    id: "popular",
    label: "Popular",
    hint: "Richer descriptions first",
  },
  {
    id: "rated",
    label: "Top rated",
    hint: "A–Z until star ratings ship",
  },
];

export function ExploreCoursesBoard({
  courses,
  currentUserId,
}: {
  courses: ExploreCourseCard[];
  currentUserId?: string;
}) {
  const [filter, setFilter] = useState<ExploreFilter>("all");

  const visible = useMemo(
    () => applyFilter(courses, filter),
    [courses, filter]
  );

  return (
    <div className="mt-10 flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">
      <div className="order-2 min-w-0 flex-1 lg:order-1">
        {visible.length === 0 ? (
          <p className="rounded-2xl border border-zinc-200/90 bg-white/80 px-5 py-8 text-center text-sm text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/80 dark:text-zinc-400">
            No courses match this view yet.
          </p>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((c) => {
              const gi = gradientIndex(c.id);
              const g = CARD_GRADIENTS[gi];
              return (
                <li key={c.id}>
                  <Link
                    href={`/explore/${c.id}`}
                    className={`group relative flex min-h-[158px] flex-col overflow-hidden rounded-2xl border border-white/40 bg-gradient-to-br ${g} p-5 shadow-sm ring-1 ring-zinc-900/[0.04] transition hover:-translate-y-0.5 hover:shadow-md hover:ring-brand/20 dark:border-zinc-700/50 dark:ring-white/[0.06] dark:hover:ring-brand-soft/25`}
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 bg-gradient-to-t from-white/50 via-transparent to-transparent opacity-90 dark:from-zinc-950/60"
                    />
                    <div className="relative flex flex-1 flex-col">
                      <div className="flex flex-wrap items-start gap-2">
                        <h2 className="line-clamp-2 flex-1 text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
                          {c.title}
                        </h2>
                        {currentUserId && currentUserId === c.user_id ? (
                          <span className="shrink-0 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand dark:bg-zinc-900/90 dark:text-brand-soft">
                            Yours
                          </span>
                        ) : null}
                      </div>
                      {c.description ? (
                        <p className="mt-2 line-clamp-3 flex-1 text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                          {c.description}
                        </p>
                      ) : (
                        <p className="mt-2 flex-1 text-xs italic text-zinc-600 dark:text-zinc-500">
                          No description
                        </p>
                      )}
                      <p className="mt-3 text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                        Listed{" "}
                        {new Date(c.created_at).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="order-1 w-full shrink-0 lg:order-2 lg:sticky lg:top-24 lg:w-72 lg:self-start">
        <div className="rounded-2xl border border-zinc-200/90 bg-white/90 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Browse
          </p>
          <nav className="mt-3 flex flex-col gap-1" aria-label="Explore filters">
            {SIDEBAR.map((item) => {
              const active = filter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={`rounded-xl px-3 py-2.5 text-left transition ${
                    active
                      ? "bg-brand/10 text-brand dark:bg-brand/15 dark:text-brand-soft"
                      : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="block text-sm font-semibold">
                    {item.label}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
                    {item.hint}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </aside>
    </div>
  );
}
