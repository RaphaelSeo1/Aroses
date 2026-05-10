"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export type DashboardCourse = {
  id: string;
  title: string;
  description: string | null;
  /** Creator — must match the signed-in user for dashboard management actions. */
  user_id: string;
  /** Listed on /explore when true (requires DB migration 007). */
  is_public?: boolean;
};

export function CourseDashboardList({
  courses: initialCourses,
  viewerUserId,
}: {
  courses: DashboardCourse[];
  viewerUserId: string;
}) {
  const router = useRouter();
  const [courses, setCourses] = useState(initialCourses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    setCourses(initialCourses);
  }, [initialCourses]);

  function startEdit(c: DashboardCourse) {
    setListError(null);
    setEditingId(c.id);
    setDraftTitle(c.title);
    setDraftDescription(c.description ?? "");
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit(courseId: string) {
    const title = draftTitle.trim();
    if (title.length < 2) {
      setListError("Title must be at least 2 characters.");
      return;
    }

    setBusyId(courseId);
    setListError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description: draftDescription.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(
          typeof body.error === "string" ? body.error : "Could not save."
        );
        setBusyId(null);
        return;
      }
      setEditingId(null);
      router.refresh();
    } catch {
      setListError("Network error.");
    }
    setBusyId(null);
  }

  async function removeCourse(courseId: string, title: string) {
    const ok = window.confirm(
      `Delete “${title}”? All uploads, exam groups, and progress for this course will be removed. This cannot be undone.`
    );
    if (!ok) return;

    setBusyId(courseId);
    setListError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(
          typeof body.error === "string" ? body.error : "Could not delete."
        );
        setBusyId(null);
        return;
      }
      if (editingId === courseId) setEditingId(null);
      router.refresh();
    } catch {
      setListError("Network error.");
    }
    setBusyId(null);
  }

  async function reorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const ids = courses.map((c) => c.id);
    const next = [...ids];
    const [removed] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, removed);

    setBusyId("__reorder__");
    setListError(null);
    try {
      const res = await fetch("/api/courses/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(
          typeof body.error === "string" ? body.error : "Could not reorder."
        );
        setBusyId(null);
        return;
      }
      router.refresh();
    } catch {
      setListError("Network error.");
    }
    setBusyId(null);
  }

  return (
    <div className="mt-12 space-y-4">
      {listError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {listError}
        </p>
      )}
      <ul className="grid gap-5 sm:grid-cols-2">
        {courses.map((c, index) => {
          const isEditing = editingId === c.id;
          const busy = busyId === c.id || busyId === "__reorder__";
          const canManage = c.user_id === viewerUserId;

          return (
            <li key={c.id}>
              <div className="flex h-full flex-col rounded-2xl border border-zinc-200/90 bg-white/95 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/95">
                {isEditing ? (
                  <div className="flex flex-1 flex-col gap-3">
                    <label className="sr-only" htmlFor={`edit-title-${c.id}`}>
                      Title
                    </label>
                    <input
                      id={`edit-title-${c.id}`}
                      value={draftTitle}
                      onChange={(e) => setDraftTitle(e.target.value)}
                      className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-base font-semibold text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                    />
                    <label
                      className="sr-only"
                      htmlFor={`edit-desc-${c.id}`}
                    >
                      Description
                    </label>
                    <textarea
                      id={`edit-desc-${c.id}`}
                      value={draftDescription}
                      onChange={(e) => setDraftDescription(e.target.value)}
                      rows={3}
                      className="resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                      placeholder="Description (optional)"
                    />
                    <div className="mt-auto flex flex-wrap gap-2 pt-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void saveEdit(c.id)}
                        className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={cancelEdit}
                        className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/courses/${c.id}`}
                          className="text-lg font-semibold text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-50"
                        >
                          {c.title}
                        </Link>
                        {c.is_public ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
                            On Explore
                          </span>
                        ) : null}
                      </div>
                      {c.description ? (
                        <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                          {c.description}
                        </p>
                      ) : (
                        <p className="text-sm italic text-zinc-500">
                          No description
                        </p>
                      )}
                      <Link
                        href={`/dashboard/courses/${c.id}`}
                        className="mt-3 inline-flex items-center text-sm font-semibold text-brand dark:text-brand-soft"
                      >
                        Open course →
                      </Link>
                    </div>

                    {canManage ? (
                      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                          Order
                        </span>
                        <button
                          type="button"
                          disabled={busy || index === 0}
                          onClick={() => void reorder(index, index - 1)}
                          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          title="Move up"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          disabled={busy || index >= courses.length - 1}
                          onClick={() => void reorder(index, index + 1)}
                          className="rounded-lg border border-zinc-200 px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                          title="Move down"
                        >
                          ↓
                        </button>
                        <span className="mx-1 h-4 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEdit(c)}
                          className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void removeCourse(c.id, c.title)}
                          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
