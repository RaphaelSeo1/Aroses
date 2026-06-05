"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Props = {
  courseId: string;
  initialTitle: string;
  /** Visual size of the title text. Defaults to `3xl` to match the
   *  workspace header. Pass `2xl` for tighter contexts. */
  size?: "2xl" | "3xl";
  /** Tailwind ring/border accent for the active edit input. */
  accent?: "brand" | "indigo";
  readOnly?: boolean;
};

/**
 * Inline-editable course title for the workspace header. Hover reveals a
 * pencil icon; clicking it swaps the h1 for an input with save/cancel.
 * The title is persisted via PATCH /api/courses/[courseId] — the same
 * endpoint used by the dashboard list rename, so changes stay in sync.
 */
export function EditableCourseTitle({
  courseId,
  initialTitle,
  size = "3xl",
  accent = "indigo",
  readOnly = false,
}: Props) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      // Focus + select the existing text so the user can type to replace
      // or arrow-key to tweak — whichever feels natural.
      const t = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => clearTimeout(t);
    }
  }, [editing]);

  const headingSize = size === "2xl" ? "text-2xl" : "text-3xl";
  const ringColor =
    accent === "indigo"
      ? "ring-indigo-500 focus:border-indigo-500"
      : "ring-brand focus:border-brand";
  const hoverIcon =
    accent === "indigo"
      ? "hover:bg-indigo-100 hover:text-indigo-600 dark:hover:bg-indigo-900/40 dark:hover:text-indigo-400"
      : "hover:bg-brand/10 hover:text-brand dark:hover:bg-brand/20 dark:hover:text-brand-soft";

  async function save() {
    const next = draft.trim();
    if (next.length < 2) {
      setError("Title needs at least 2 characters.");
      return;
    }
    if (next === title) {
      // No-op rename; just close the editor.
      setEditing(false);
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not save.");
        setSaving(false);
        return;
      }
      setTitle(next);
      setEditing(false);
      // Refresh server data so other server-rendered references (sidebars,
      // dashboard counts) pick up the new title on the next navigation.
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    }
    setSaving(false);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void save();
              } else if (e.key === "Escape") {
                setDraft(title);
                setEditing(false);
                setError(null);
              }
            }}
            maxLength={120}
            className={`min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-1.5 ${headingSize} font-semibold tracking-tight text-zinc-900 outline-none ${ringColor} focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100`}
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-sm disabled:opacity-50 ${
              accent === "indigo"
                ? "bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                : "bg-brand hover:bg-brand-hover"
            }`}
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(title);
              setEditing(false);
              setError(null);
            }}
            disabled={saving}
            className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
          >
            Cancel
          </button>
        </div>
        {error ? (
          <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}
      </div>
    );
  }

  if (readOnly) {
    return (
      <h1
        className={`${headingSize} font-semibold tracking-tight text-zinc-900 dark:text-zinc-50`}
      >
        {title}
      </h1>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <h1
        className={`${headingSize} font-semibold tracking-tight text-zinc-900 dark:text-zinc-50`}
      >
        {title}
      </h1>
      <button
        type="button"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        title="Rename course"
        aria-label="Rename course"
        className={`shrink-0 rounded-lg p-1.5 text-zinc-400 opacity-0 transition group-hover:opacity-100 focus:opacity-100 ${hoverIcon}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
        </svg>
      </button>
    </div>
  );
}
