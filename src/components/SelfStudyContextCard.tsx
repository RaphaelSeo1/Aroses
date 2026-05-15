"use client";

import { useState } from "react";

type Props = {
  courseId: string;
  initialContext: string;
};

/** Goals longer than this collapse behind a "Show more" toggle so the
 *  workspace header stays tight even for legacy sessions that were
 *  saved before we added the polish step. */
const LONG_GOAL_CHAR_THRESHOLD = 180;

export function SelfStudyContextCard({ courseId, initialContext }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialContext);
  const [saved, setSaved] = useState(initialContext);
  const [saving, setSaving] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  async function save() {
    if (!draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/study-context`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_context: draft.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "Could not save.");
        setSaving(false);
        return;
      }
      setSaved(draft.trim());
      setEditing(false);
    } catch {
      setError("Network error.");
    }
    setSaving(false);
  }

  /** Run the goal through the polish endpoint and save the tight rewrite.
   *  Handy for legacy goals that were saved as the user's raw paragraph
   *  before the creation form added the confirm step. */
  async function polishAndSave() {
    if (!saved.trim()) return;
    setPolishing(true);
    setError(null);
    try {
      const polishRes = await fetch("/api/self-study/polish-goal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_context: saved }),
      });
      const polishBody = await polishRes.json().catch(() => ({}));
      if (!polishRes.ok || typeof polishBody.summary !== "string") {
        setError(
          typeof polishBody.error === "string"
            ? polishBody.error
            : "Couldn't summarise — try editing manually."
        );
        return;
      }
      const summary = polishBody.summary.trim();
      const saveRes = await fetch(`/api/courses/${courseId}/study-context`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_context: summary }),
      });
      if (!saveRes.ok) {
        const b = await saveRes.json().catch(() => ({}));
        setError(typeof b.error === "string" ? b.error : "Could not save.");
        return;
      }
      setSaved(summary);
      setDraft(summary);
      setExpanded(false);
    } catch {
      setError("Network error.");
    } finally {
      setPolishing(false);
    }
  }

  const isLong = saved.length > LONG_GOAL_CHAR_THRESHOLD;

  return (
    <div className="rounded-2xl border border-indigo-200/70 bg-indigo-50/60 px-4 py-3 dark:border-indigo-900/40 dark:bg-indigo-950/30">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-base">🎯</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
            Your study goal
          </p>

          {editing ? (
            <div className="mt-2 space-y-2">
              <textarea
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={4000}
                autoFocus
                className="w-full resize-none rounded-xl border border-indigo-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 dark:border-indigo-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
              {error && (
                <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !draft.trim()}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(saved);
                    setEditing(false);
                    setError(null);
                  }}
                  className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="group relative mt-1">
              <div className="flex items-start gap-2">
                <p
                  className={`flex-1 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 ${
                    isLong && !expanded ? "line-clamp-2" : ""
                  }`}
                >
                  {saved}
                </p>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  title="Edit your study goal"
                  className="shrink-0 rounded-lg p-1 text-zinc-400 opacity-0 transition hover:bg-indigo-100 hover:text-indigo-600 group-hover:opacity-100 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-400"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-3.5 w-3.5"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                {isLong ? (
                  <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                  >
                    {expanded ? "Show less" : "Show full goal"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void polishAndSave()}
                  disabled={polishing}
                  className="text-xs font-medium text-indigo-600 hover:underline disabled:opacity-50 dark:text-indigo-400"
                  title="Rewrite this as a short, typo-free one-liner"
                >
                  {polishing ? "Polishing…" : "✨ Polish goal"}
                </button>
                {error ? (
                  <span className="text-xs text-red-600 dark:text-red-400">
                    {error}
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
