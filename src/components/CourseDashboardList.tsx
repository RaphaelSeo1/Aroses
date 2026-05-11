"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { StudyingCourse } from "@/lib/load-dashboard-courses";

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
  className,
}: {
  courses: DashboardCourse[];
  viewerUserId: string;
  /** Wraps list area; default top margin `mt-12`. */
  className?: string;
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
      `Delete “${title}”? All uploads, sections, and progress for this course will be removed. This cannot be undone.`
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
    <div className={`space-y-4 ${className ?? "mt-12"}`}>
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
              <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 pt-7 shadow-md shadow-zinc-900/[0.04] ring-1 ring-white/40 transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-brand-border hover:shadow-xl hover:shadow-red-900/[0.07] motion-reduce:hover:translate-y-0 dark:border-zinc-800 dark:bg-zinc-950/95 dark:ring-zinc-700/30 dark:hover:border-brand-border/50">
                <div
                  className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-red-500 to-brand-soft opacity-90"
                  aria-hidden
                />
                {isEditing ? (
                  <div className="flex flex-1 flex-col gap-3 px-6 pb-6">
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
                    <div
                      className={`flex flex-1 flex-col gap-2 px-6 pt-0 ${canManage ? "pb-1" : "pb-6"}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/courses/${c.id}`}
                          className="text-lg font-semibold tracking-tight text-zinc-900 underline-offset-2 transition group-hover:text-brand dark:text-zinc-50 dark:group-hover:text-brand-soft"
                        >
                          {c.title}
                        </Link>
                        {c.is_public ? (
                          <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
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
                        className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/25 bg-brand-blush/70 px-4 py-2 text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-white dark:border-brand-border/40 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand dark:hover:text-white"
                      >
                        Open course
                        <span aria-hidden className="transition group-hover:translate-x-0.5">
                          →
                        </span>
                      </Link>
                    </div>

                    {canManage ? (
                      <div className="mx-6 mb-6 mt-5 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
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

export function StudyingCoursesSection({
  courses,
}: {
  courses: StudyingCourse[];
}) {
  if (courses.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start gap-4">
        <span
          className="mt-1 hidden h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-emerald-600 to-teal-400 sm:block"
          aria-hidden
        />
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
            Continue learning
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Community courses you&apos;ve started — resume on Explore (read-only;
            you don&apos;t manage these).
          </p>
        </div>
      </div>
      <ul className="grid gap-5 sm:grid-cols-2">
        {courses.map((c) => (
          <li key={c.id}>
            <div className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-emerald-200/70 bg-gradient-to-b from-emerald-50/90 to-white/95 pt-7 shadow-md shadow-emerald-900/[0.06] ring-1 ring-emerald-100/80 transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-900/10 motion-reduce:hover:translate-y-0 dark:border-emerald-900/45 dark:from-emerald-950/40 dark:to-zinc-950/95 dark:ring-emerald-900/30 dark:hover:border-emerald-700/60">
              <div
                className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-600 via-teal-500 to-emerald-400"
                aria-hidden
              />
              <span className="px-6 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-800 dark:text-emerald-300">
                From Explore
              </span>
              <Link
                href={`/explore/${c.id}`}
                className="mt-3 px-6 text-lg font-semibold tracking-tight text-zinc-900 underline-offset-2 transition group-hover:text-emerald-800 dark:text-zinc-50 dark:group-hover:text-emerald-300"
              >
                {c.title}
              </Link>
              {c.description ? (
                <p className="mt-2 line-clamp-3 px-6 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {c.description}
                </p>
              ) : (
                <p className="mt-2 px-6 text-sm italic text-zinc-500 dark:text-zinc-500">
                  No description
                </p>
              )}
              <div className="mt-auto flex flex-wrap gap-3 px-6 pb-6 pt-4">
                <Link
                  href={`/explore/${c.id}/study`}
                  className="inline-flex items-center gap-1 rounded-full border border-brand/30 bg-white/90 px-4 py-2 text-sm font-semibold text-brand shadow-sm transition hover:border-brand hover:bg-brand hover:text-white dark:border-brand-border/40 dark:bg-zinc-900/80 dark:text-brand-soft dark:hover:bg-brand dark:hover:text-white"
                >
                  Continue studying
                  <span aria-hidden>→</span>
                </Link>
                <Link
                  href={`/explore/${c.id}`}
                  className="inline-flex items-center rounded-full px-3 py-2 text-sm font-medium text-zinc-600 transition hover:bg-emerald-100/80 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-emerald-950/50 dark:hover:text-zinc-100"
                >
                  Outline
                </Link>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
