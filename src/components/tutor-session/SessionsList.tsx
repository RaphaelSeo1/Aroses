"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
  TutorSessionModeTag,
  TutorSessionSummary,
} from "@/types/tutor-session";

/**
 * Sessions library list. Client component for client-side filter
 * toggles (search, mode-tag chips, sort dropdown) — server hydrates
 * the initial sessions list and we filter in-memory for a snappy
 * UX. If the library grows past ~100 sessions we'll add server-side
 * filtering.
 *
 * Controls:
 *   - Search input (matches title, topic, recap preview)
 *   - Mode-tag chips (single-select; null = "All")
 *   - Sort dropdown:
 *       newest (default), oldest, longest, shortest
 */

function formatRelativeDate(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const m = Math.round(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const MODE_EMOJI: Record<string, string> = {
  exam_prep: "⚡",
  homework_help: "📝",
  concept_review: "🧠",
  quiz_me: "🎯",
  exploring: "🌱",
};

const MODE_LABELS: Record<TutorSessionModeTag, string> = {
  exam_prep: "Exam prep",
  homework_help: "Homework",
  concept_review: "Concepts",
  quiz_me: "Quiz me",
  exploring: "Exploring",
};

type SortKey = "newest" | "oldest" | "longest" | "shortest";

export function SessionsList({
  sessions,
}: {
  sessions: TutorSessionSummary[];
}) {
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<TutorSessionModeTag | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest");

  // Which mode tags actually appear in the user's library — used to
  // only show chips that have at least one matching session, so the
  // filter row doesn't include empty toggles.
  const availableModes = useMemo<TutorSessionModeTag[]>(() => {
    const set = new Set<TutorSessionModeTag>();
    for (const s of sessions) {
      if (s.modeTag) set.add(s.modeTag);
    }
    return Array.from(set);
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = sessions;
    if (q) {
      list = list.filter((s) => {
        const hay = `${s.title} ${s.topic} ${s.recapPreview ?? ""}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (modeFilter) {
      list = list.filter((s) => s.modeTag === modeFilter);
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "oldest":
          return (
            Date.parse(a.startedAt) - Date.parse(b.startedAt)
          );
        case "longest":
          return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
        case "shortest":
          return (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
        case "newest":
        default:
          return (
            Date.parse(b.startedAt) - Date.parse(a.startedAt)
          );
      }
    });
    return sorted;
  }, [modeFilter, query, sessions, sortKey]);

  if (sessions.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-200 bg-white/95 p-10 text-center shadow-sm">
        <p className="text-base font-semibold text-zinc-800">
          No tutor sessions yet
        </p>
        <p className="mt-2 text-sm text-zinc-600">
          Start your first session and Rose will help you work through anything.
        </p>
        <Link
          href="/tutor-session"
          className="mt-5 inline-flex items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow"
        >
          Start a tutor session
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200 sm:flex-1"
        />
        <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <span className="uppercase tracking-wider">Sort</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="rounded-full border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-700 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="longest">Longest</option>
            <option value="shortest">Shortest</option>
          </select>
        </label>
      </div>

      {availableModes.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setModeFilter(null)}
            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
              modeFilter === null
                ? "border-violet-400 bg-violet-100 text-violet-900"
                : "border-zinc-200 bg-white/80 text-zinc-600 hover:border-violet-300 hover:bg-violet-50"
            }`}
          >
            All
          </button>
          {availableModes.map((m) => {
            const active = modeFilter === m;
            return (
              <button
                key={m}
                type="button"
                onClick={() => setModeFilter(active ? null : m)}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                  active
                    ? "border-violet-400 bg-violet-100 text-violet-900"
                    : "border-zinc-200 bg-white/80 text-zinc-600 hover:border-violet-300 hover:bg-violet-50"
                }`}
              >
                <span aria-hidden>{MODE_EMOJI[m] ?? "💬"}</span>
                {MODE_LABELS[m]}
              </button>
            );
          })}
        </div>
      ) : null}

      {filtered.length === 0 && (query || modeFilter) ? (
        <p className="rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm text-zinc-500">
          No sessions match your filters.
        </p>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {filtered.map((s) => {
          const isActive = s.status === "active";
          const target = isActive
            ? `/tutor-session/active/${s.id}`
            : `/tutor-session/recap/${s.id}`;
          const emoji = s.modeTag ? MODE_EMOJI[s.modeTag] ?? "💬" : "💬";
          return (
            <li key={s.id}>
              <Link
                href={target}
                className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
                      {emoji}{" "}
                      {s.modeTag
                        ? s.modeTag.replace(/_/g, " ")
                        : "Open session"}
                    </p>
                    <h3 className="mt-1 truncate text-base font-semibold text-zinc-900 group-hover:text-violet-800">
                      {s.title}
                    </h3>
                  </div>
                  {isActive ? (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                      Active
                    </span>
                  ) : null}
                </div>
                {s.recapPreview ? (
                  <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-zinc-600">
                    {s.recapPreview}
                  </p>
                ) : s.recapStatus === "generating" ? (
                  <p className="mt-2 text-sm italic text-violet-700">
                    Generating recap…
                  </p>
                ) : s.recapStatus === "failed" ? (
                  <p className="mt-2 text-sm italic text-rose-700">
                    Recap didn&apos;t generate — click to retry.
                  </p>
                ) : (
                  <p className="mt-2 text-sm italic text-zinc-400">
                    {isActive
                      ? "In progress."
                      : "(no recap — session was very short)"}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{formatRelativeDate(s.startedAt)}</span>
                  {s.durationSeconds && s.durationSeconds > 0 ? (
                    <span>{Math.round(s.durationSeconds / 60)} min</span>
                  ) : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
