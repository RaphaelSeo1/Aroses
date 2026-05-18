"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { TutorSessionSummary } from "@/types/tutor-session";

/**
 * Sessions library list. Client component for client-side filter
 * toggles (search, mode-tag chips) — server hydrates the initial
 * sessions list and we filter in-memory for a snappy UX. If the
 * library grows past ~100 sessions we'll add server-side filtering.
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

export function SessionsList({
  sessions,
}: {
  sessions: TutorSessionSummary[];
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const hay = `${s.title} ${s.topic} ${s.recapPreview ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [query, sessions]);

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
      <div className="mb-4 flex items-center gap-2">
        <input
          type="search"
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-full border border-zinc-200 bg-white/80 px-4 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
        />
      </div>
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
