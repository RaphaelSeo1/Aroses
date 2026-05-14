"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
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
  density = "comfortable",
}: {
  courses: DashboardCourse[];
  viewerUserId: string;
  /** Wraps list area; default top margin `mt-12`. */
  className?: string;
  density?: "comfortable" | "compact";
}) {
  const router = useRouter();
  const [courses, setCourses] = useState(initialCourses);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  // Drag-and-drop
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  // Live preview order while dragging
  const previewCourses = useMemo(() => {
    if (dragFrom === null || dragOver === null || dragFrom === dragOver) return courses;
    const next = [...courses];
    const [removed] = next.splice(dragFrom, 1);
    next.splice(dragOver, 0, removed);
    return next;
  }, [courses, dragFrom, dragOver]);

  const draggedId = dragFrom !== null ? courses[dragFrom]?.id : null;

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
        body: JSON.stringify({ title, description: draftDescription.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(typeof body.error === "string" ? body.error : "Could not save.");
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
      `Delete "${title}"? All uploads, sections, and progress for this course will be removed. This cannot be undone.`
    );
    if (!ok) return;
    setBusyId(courseId);
    setListError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(typeof body.error === "string" ? body.error : "Could not delete.");
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

  async function saveOrder(orderedIds: string[]) {
    setBusyId("__reorder__");
    setListError(null);
    try {
      const res = await fetch("/api/courses/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseIds: orderedIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(typeof body.error === "string" ? body.error : "Could not reorder.");
      } else {
        router.refresh();
      }
    } catch {
      setListError("Network error.");
    }
    setBusyId(null);
  }

  function handleDragStart(index: number) {
    setDragFrom(index);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    if (dragFrom !== null && dragOver !== index) setDragOver(index);
  }

  function handleDrop(toIndex: number) {
    if (dragFrom === null || dragFrom === toIndex) {
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const next = [...courses];
    const [removed] = next.splice(dragFrom, 1);
    next.splice(toIndex, 0, removed);
    setCourses(next);
    setDragFrom(null);
    setDragOver(null);
    void saveOrder(next.map((c) => c.id));
  }

  function handleDragEnd() {
    setDragFrom(null);
    setDragOver(null);
  }

  return (
    <div className={`space-y-4 ${className ?? "mt-12"}`}>
      {listError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {listError}
        </p>
      )}
      <ul
        className={
          density === "compact"
            ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3"
        }
      >
        {previewCourses.map((c, index) => (
          <CourseCard
            key={c.id}
            course={c}
            index={index}
            density={density}
            viewerUserId={viewerUserId}
            busy={busyId === c.id || busyId === "__reorder__"}
            editingId={editingId}
            draftTitle={draftTitle}
            draftDescription={draftDescription}
            setDraftTitle={setDraftTitle}
            setDraftDescription={setDraftDescription}
            onStartEdit={startEdit}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onRemove={removeCourse}
            isDragging={c.id === draggedId}
            onDragStart={() => handleDragStart(courses.indexOf(c))}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </ul>
    </div>
  );
}

function CourseCard({
  course: c,
  density,
  viewerUserId,
  busy,
  editingId,
  draftTitle,
  draftDescription,
  setDraftTitle,
  setDraftDescription,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onRemove,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  course: DashboardCourse;
  index: number;
  density: "comfortable" | "compact";
  viewerUserId: string;
  busy: boolean;
  editingId: string | null;
  draftTitle: string;
  draftDescription: string;
  setDraftTitle: (v: string) => void;
  setDraftDescription: (v: string) => void;
  onStartEdit: (c: DashboardCourse) => void;
  onSaveEdit: (id: string) => void;
  onCancelEdit: () => void;
  onRemove: (id: string, title: string) => void;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isEditing = editingId === c.id;
  const canManage = c.user_id === viewerUserId;

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [menuOpen]);

  return (
    <li
      draggable={canManage && !isEditing}
      onDragStart={canManage ? onDragStart : undefined}
      onDragOver={canManage ? onDragOver : undefined}
      onDrop={canManage ? onDrop : undefined}
      onDragEnd={canManage ? onDragEnd : undefined}
      className={[
        "transition-[opacity,transform] duration-200",
        isDragging ? "opacity-40 scale-95" : "opacity-100 scale-100",
      ].join(" ")}
    >
      <div
        className={[
          "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/95 shadow-md shadow-zinc-900/[0.04] ring-1 ring-white/40 transition-[box-shadow,transform,border-color] duration-300 hover:-translate-y-0.5 hover:border-brand-border hover:shadow-xl hover:shadow-red-900/[0.07] motion-reduce:hover:translate-y-0 dark:border-zinc-800 dark:bg-zinc-950/95 dark:ring-zinc-700/30 dark:hover:border-brand-border/50",
          density === "compact" ? "pt-6" : "pt-7",
        ].join(" ")}
      >
        <div
          className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-red-500 to-brand-soft opacity-90"
          aria-hidden
        />

        {/* drag handle + ⋯ menu */}
        {canManage && !isEditing && (
          <div className="absolute right-2 top-3.5 z-10 flex items-center gap-0.5">
            {/* grip handle */}
            <span
              className="flex h-7 w-6 cursor-grab items-center justify-center rounded-md text-zinc-300 transition hover:bg-zinc-100 hover:text-zinc-500 active:cursor-grabbing dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
              aria-hidden
            >
              <svg viewBox="0 0 10 16" fill="currentColor" className="h-3.5 w-3.5">
                <circle cx="2.5" cy="2" r="1.5" />
                <circle cx="7.5" cy="2" r="1.5" />
                <circle cx="2.5" cy="7" r="1.5" />
                <circle cx="7.5" cy="7" r="1.5" />
                <circle cx="2.5" cy="12" r="1.5" />
                <circle cx="7.5" cy="12" r="1.5" />
              </svg>
            </span>

            {/* ⋯ dropdown */}
            <div ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((p) => !p)}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                aria-label="Course options"
              >
                <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <circle cx="4" cy="10" r="1.5" />
                  <circle cx="10" cy="10" r="1.5" />
                  <circle cx="16" cy="10" r="1.5" />
                </svg>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-8 w-48 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      onStartEdit(c);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-zinc-400">
                      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
                    </svg>
                    Edit title &amp; description
                  </button>
                  <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove(c.id, c.title);
                    }}
                    className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0">
                      <path
                        fillRule="evenodd"
                        d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 3.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Delete course
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

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
            <label className="sr-only" htmlFor={`edit-desc-${c.id}`}>
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
                onClick={() => onSaveEdit(c.id)}
                className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
              >
                Save
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelEdit}
                className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`flex flex-1 flex-col gap-2 pt-0 ${density === "compact" ? "px-5 pb-6" : "px-6 pb-7"}`}
          >
            <div className="flex flex-wrap items-center gap-2 pr-16">
              <Link
                href={`/dashboard/courses/${c.id}`}
                className={
                  density === "compact"
                    ? "text-base font-semibold tracking-tight text-zinc-900 transition group-hover:text-brand dark:text-zinc-50 dark:group-hover:text-brand-soft"
                    : "text-lg font-semibold tracking-tight text-zinc-900 transition group-hover:text-brand dark:text-zinc-50 dark:group-hover:text-brand-soft"
                }
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
              <p className="text-sm italic text-zinc-500">No description</p>
            )}
            <Link
              href={`/dashboard/courses/${c.id}`}
              className={
                density === "compact"
                  ? "mt-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/25 bg-brand-blush/70 px-3.5 py-1.5 text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-white dark:border-brand-border/40 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand dark:hover:text-white"
                  : "mt-4 inline-flex w-fit items-center gap-1.5 rounded-full border border-brand/25 bg-brand-blush/70 px-4 py-2 text-sm font-semibold text-brand transition hover:border-brand hover:bg-brand hover:text-white dark:border-brand-border/40 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand dark:hover:text-white"
              }
            >
              Open course
              <span aria-hidden className="transition group-hover:translate-x-0.5">
                →
              </span>
            </Link>
          </div>
        )}
      </div>
    </li>
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
