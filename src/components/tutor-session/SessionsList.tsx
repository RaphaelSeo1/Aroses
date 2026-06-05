"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { alertDialog, confirmDialog } from "@/components/AppDialogs";
import { CombinedNotesModal } from "@/components/tutor-session/CombinedNotesModal";
import {
  parseSessionLibraryCommand,
  SESSION_LIBRARY_COMMAND_HINTS,
} from "@/lib/tutor-session/library-commands";
import type {
  TutorSessionModeTag,
  TutorSessionSummary,
} from "@/types/tutor-session";

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
  sessions: initialSessions,
}: {
  sessions: TutorSessionSummary[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialSessions);
  const [query, setQuery] = useState("");
  const [modeFilter, setModeFilter] = useState<TutorSessionModeTag | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("newest");
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [combined, setCombined] = useState<{
    markdown: string;
    sessionCount: number;
  } | null>(null);

  const availableModes = useMemo<TutorSessionModeTag[]>(() => {
    const set = new Set<TutorSessionModeTag>();
    for (const s of items) {
      if (s.modeTag) set.add(s.modeTag);
    }
    return Array.from(set);
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
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
          return Date.parse(a.startedAt) - Date.parse(b.startedAt);
        case "longest":
          return (b.durationSeconds ?? 0) - (a.durationSeconds ?? 0);
        case "shortest":
          return (a.durationSeconds ?? 0) - (b.durationSeconds ?? 0);
        case "newest":
        default:
          return Date.parse(b.startedAt) - Date.parse(a.startedAt);
      }
    });
    return sorted;
  }, [items, modeFilter, query, sortKey]);

  const selectedCount = selectedIds.size;
  const selectedSessions = useMemo(
    () => items.filter((s) => selectedIds.has(s.id)),
    [items, selectedIds]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllFiltered = useCallback(() => {
    setSelectedIds(new Set(filtered.map((s) => s.id)));
  }, [filtered]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const exitManageMode = useCallback(() => {
    setManageMode(false);
    clearSelection();
    setCommand("");
  }, [clearSelection]);

  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) {
      await alertDialog({
        title: "No sessions selected",
        body: "Turn on Manage, check the sessions you want, then try again.",
      });
      return;
    }

    const hasLive = selectedSessions.some(
      (s) => s.status === "active" || s.status === "paused"
    );
    const ok = await confirmDialog({
      title: `Delete ${selectedIds.size} session${selectedIds.size === 1 ? "" : "s"}?`,
      body: hasLive
        ? "This includes active or paused sessions — they will be permanently removed."
        : "This cannot be undone. Recaps and uploads will be deleted.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/tutor-session/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "delete",
          sessionIds: [...selectedIds],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alertDialog({
          title: "Delete failed",
          body: typeof body.error === "string" ? body.error : "Try again.",
          tone: "danger",
        });
        return;
      }
      const deleted = new Set(
        (Array.isArray(body.sessionIds) ? body.sessionIds : []) as string[]
      );
      setItems((prev) => prev.filter((s) => !deleted.has(s.id)));
      clearSelection();
      router.refresh();
    } catch {
      await alertDialog({
        title: "Delete failed",
        body: "Network error — try again.",
        tone: "danger",
      });
    } finally {
      setBusy(false);
    }
  }, [clearSelection, router, selectedIds, selectedSessions]);

  const combineSelected = useCallback(async () => {
    if (selectedIds.size < 2) {
      await alertDialog({
        title: "Pick at least two sessions",
        body: "Select multiple ended sessions with recaps to merge into one study guide.",
      });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/tutor-session/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "combine",
          sessionIds: [...selectedIds],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        await alertDialog({
          title: "Could not combine",
          body: typeof body.error === "string" ? body.error : "Try again.",
        });
        return;
      }
      if (typeof body.markdown === "string") {
        setCombined({
          markdown: body.markdown,
          sessionCount:
            typeof body.sessionCount === "number" ? body.sessionCount : selectedIds.size,
        });
      }
    } catch {
      await alertDialog({
        title: "Could not combine",
        body: "Network error — try again.",
      });
    } finally {
      setBusy(false);
    }
  }, [selectedIds]);

  const runCommand = useCallback(
    async (raw: string) => {
      const intent = parseSessionLibraryCommand(raw);
      switch (intent.type) {
        case "select_all":
          if (!manageMode) setManageMode(true);
          selectAllFiltered();
          break;
        case "clear":
          clearSelection();
          break;
        case "exit_manage":
          exitManageMode();
          break;
        case "delete":
          if (!manageMode) setManageMode(true);
          await deleteSelected();
          break;
        case "combine":
          if (!manageMode) setManageMode(true);
          await combineSelected();
          break;
        default:
          await alertDialog({
            title: "Try a command like…",
            body: SESSION_LIBRARY_COMMAND_HINTS.map((h) => `• ${h}`).join("\n"),
          });
      }
      setCommand("");
    },
    [
      clearSelection,
      combineSelected,
      deleteSelected,
      exitManageMode,
      manageMode,
      selectAllFiltered,
    ]
  );

  if (items.length === 0) {
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
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
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
        <button
          type="button"
          onClick={() => (manageMode ? exitManageMode() : setManageMode(true))}
          className={`shrink-0 rounded-full border px-4 py-2 text-sm font-semibold transition ${
            manageMode
              ? "border-violet-400 bg-violet-100 text-violet-900"
              : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-300"
          }`}
        >
          {manageMode ? "Done" : "Manage"}
        </button>
      </div>

      {manageMode ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-violet-200 bg-violet-50/80 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-violet-900">
              {selectedCount === 0
                ? "Select sessions below"
                : `${selectedCount} selected`}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={selectAllFiltered}
              className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800"
            >
              Select all shown
            </button>
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              onClick={clearSelection}
              className="rounded-full border border-violet-200 bg-white px-2.5 py-1 text-[11px] font-medium text-violet-800 disabled:opacity-50"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={busy || selectedCount === 0}
              onClick={() => void deleteSelected()}
              className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              disabled={busy || selectedCount < 2}
              onClick={() => void combineSelected()}
              className="rounded-full bg-violet-600 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              Combine notes
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runCommand(command);
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder='What would you like to do? e.g. "delete selected", "combine notes"'
              className="min-w-0 flex-1 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
              disabled={busy}
            />
            <button
              type="submit"
              disabled={busy || !command.trim()}
              className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Go
            </button>
          </form>
          <p className="text-[11px] text-violet-700/80">
            Try: {SESSION_LIBRARY_COMMAND_HINTS.join(" · ")}
          </p>
        </div>
      ) : null}

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
          const isLive = s.status === "active" || s.status === "paused";
          const target = isLive
            ? `/tutor-session/active/${s.id}`
            : `/tutor-session/recap/${s.id}`;
          const emoji = s.modeTag ? MODE_EMOJI[s.modeTag] ?? "💬" : "💬";
          const selected = selectedIds.has(s.id);

          const cardBody = (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {manageMode ? (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleSelect(s.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-violet-300 text-violet-600 focus:ring-violet-400"
                      aria-label={`Select ${s.title}`}
                    />
                  ) : null}
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
                </div>
                {s.status === "active" ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                    Active
                  </span>
                ) : s.status === "paused" ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-900">
                    Paused
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
                  {isLive
                    ? s.status === "paused"
                      ? "Paused — tap to resume."
                      : "In progress."
                    : "(no recap — session was very short)"}
                </p>
              )}
              <div className="mt-3 flex items-center justify-between text-[11px] text-zinc-500">
                <span>{formatRelativeDate(s.startedAt)}</span>
                {s.durationSeconds && s.durationSeconds > 0 ? (
                  <span>{Math.round(s.durationSeconds / 60)} min</span>
                ) : null}
              </div>
            </>
          );

          return (
            <li key={s.id}>
              {manageMode ? (
                <button
                  type="button"
                  onClick={() => toggleSelect(s.id)}
                  className={`group flex h-full w-full flex-col rounded-2xl border bg-white/95 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                    selected
                      ? "border-violet-400 ring-2 ring-violet-200"
                      : "border-zinc-200 hover:border-violet-200"
                  }`}
                >
                  {cardBody}
                </button>
              ) : (
                <Link
                  href={target}
                  className="group flex h-full flex-col rounded-2xl border border-zinc-200 bg-white/95 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-md"
                >
                  {cardBody}
                </Link>
              )}
            </li>
          );
        })}
      </ul>

      {busy ? (
        <p className="mt-4 text-center text-sm text-violet-700">Working…</p>
      ) : null}

      {combined ? (
        <CombinedNotesModal
          markdown={combined.markdown}
          sessionCount={combined.sessionCount}
          onClose={() => setCombined(null)}
        />
      ) : null}
    </div>
  );
}
