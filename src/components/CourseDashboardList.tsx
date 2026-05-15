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
  /** Conversational / private self-study flow — never mixed into the public grid. */
  is_self_study?: boolean;
};

type DashboardSection = "explore" | "private" | "self";

function isExploreListed(c: DashboardCourse): boolean {
  return Boolean(c.is_public) && !Boolean(c.is_self_study);
}

function isSelfStudyCourse(c: DashboardCourse): boolean {
  return Boolean(c.is_self_study);
}

function isPrivateDraft(c: DashboardCourse): boolean {
  return !isSelfStudyCourse(c) && !isExploreListed(c);
}

function sectionPredicate(section: DashboardSection): (c: DashboardCourse) => boolean {
  switch (section) {
    case "explore":
      return isExploreListed;
    case "self":
      return isSelfStudyCourse;
    case "private":
      return isPrivateDraft;
    default:
      return () => false;
  }
}

function mergeSectionOrder(
  full: DashboardCourse[],
  section: DashboardSection,
  newSectionOrder: DashboardCourse[]
): DashboardCourse[] {
  const pred = sectionPredicate(section);
  const slots: number[] = [];
  full.forEach((c, i) => {
    if (pred(c)) slots.push(i);
  });
  if (slots.length !== newSectionOrder.length) return full;
  const out = [...full];
  slots.forEach((idx, j) => {
    out[idx] = newSectionOrder[j]!;
  });
  return out;
}

function reorderLocal<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [removed] = next.splice(from, 1);
  next.splice(to, 0, removed!);
  return next;
}

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
  const [pendingDelete, setPendingDelete] = useState<{
    id: string;
    title: string;
  } | null>(null);

  const [dragSection, setDragSection] = useState<DashboardSection | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const exploreCourses = useMemo(
    () => courses.filter(isExploreListed),
    [courses]
  );
  const privateCourses = useMemo(
    () => courses.filter(isPrivateDraft),
    [courses]
  );
  const selfStudyCourses = useMemo(
    () => courses.filter(isSelfStudyCourse),
    [courses]
  );

  const previewExplore = useMemo(() => {
    if (
      dragSection !== "explore" ||
      dragFrom === null ||
      dragOver === null ||
      dragFrom === dragOver
    ) {
      return exploreCourses;
    }
    return reorderLocal(exploreCourses, dragFrom, dragOver);
  }, [exploreCourses, dragSection, dragFrom, dragOver]);

  const previewPrivate = useMemo(() => {
    if (
      dragSection !== "private" ||
      dragFrom === null ||
      dragOver === null ||
      dragFrom === dragOver
    ) {
      return privateCourses;
    }
    return reorderLocal(privateCourses, dragFrom, dragOver);
  }, [privateCourses, dragSection, dragFrom, dragOver]);

  const previewSelfStudy = useMemo(() => {
    if (
      dragSection !== "self" ||
      dragFrom === null ||
      dragOver === null ||
      dragFrom === dragOver
    ) {
      return selfStudyCourses;
    }
    return reorderLocal(selfStudyCourses, dragFrom, dragOver);
  }, [selfStudyCourses, dragSection, dragFrom, dragOver]);

  const draggedId =
    dragFrom !== null && dragSection !== null
      ? (dragSection === "explore"
          ? exploreCourses[dragFrom]
          : dragSection === "private"
            ? privateCourses[dragFrom]
            : selfStudyCourses[dragFrom]
        )?.id
      : null;

  useEffect(() => {
    setCourses(initialCourses);
  }, [initialCourses]);

  // Esc closes the delete-confirmation modal
  useEffect(() => {
    if (!pendingDelete) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && busyId !== pendingDelete?.id) {
        setPendingDelete(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pendingDelete, busyId]);

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

  function removeCourse(courseId: string, title: string) {
    setListError(null);
    setPendingDelete({ id: courseId, title });
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const { id: courseId } = pendingDelete;
    setBusyId(courseId);
    setListError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setListError(typeof body.error === "string" ? body.error : "Could not delete.");
        setBusyId(null);
        setPendingDelete(null);
        return;
      }
      if (editingId === courseId) setEditingId(null);
      setPendingDelete(null);
      router.refresh();
    } catch {
      setListError("Network error.");
      setPendingDelete(null);
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

  function handleDragStart(section: DashboardSection, index: number) {
    setDragSection(section);
    setDragFrom(index);
  }

  function handleDragOver(
    section: DashboardSection,
    e: React.DragEvent,
    index: number
  ) {
    e.preventDefault();
    if (dragSection === section && dragFrom !== null && index !== dragOver) {
      setDragOver(index);
    }
  }

  function handleDrop(section: DashboardSection, toIndex: number) {
    if (
      dragSection !== section ||
      dragFrom === null ||
      dragFrom === toIndex
    ) {
      setDragSection(null);
      setDragFrom(null);
      setDragOver(null);
      return;
    }
    const slice =
      section === "explore"
        ? exploreCourses
        : section === "private"
          ? privateCourses
          : selfStudyCourses;
    const nextSlice = reorderLocal(slice, dragFrom, toIndex);
    const merged = mergeSectionOrder(courses, section, nextSlice);
    setCourses(merged);
    setDragSection(null);
    setDragFrom(null);
    setDragOver(null);
    void saveOrder(merged.map((c) => c.id));
  }

  function handleDragEnd() {
    setDragSection(null);
    setDragFrom(null);
    setDragOver(null);
  }

  const courseGridClass =
    density === "compact"
      ? "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
      : "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";

  return (
    <div className={`space-y-4 ${className ?? "mt-12"}`}>
      {listError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          {listError}
        </p>
      )}

      <section className="space-y-5">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="mt-1 hidden h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-brand to-red-400 sm:block"
            aria-hidden
          />
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
              Public courses
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Visible on the explore page for others to discover and use.
            </p>
          </div>
        </div>

        {previewExplore.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200/90 bg-zinc-50/40 px-5 py-8 text-center dark:border-zinc-700/80 dark:bg-zinc-900/30">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Nothing on Explore yet. When a course is ready, open it and enable
              listing so learners can find it.
            </p>
            <Link
              href="/dashboard/courses/new"
              className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline dark:text-brand-soft"
            >
              + Create a course
            </Link>
          </div>
        ) : (
          <ul className={courseGridClass}>
            {previewExplore.map((c, index) => (
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
                visualVariant="default"
                onDragStart={() => handleDragStart("explore", index)}
                onDragOver={(e) => handleDragOver("explore", e, index)}
                onDrop={() => handleDrop("explore", index)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </ul>
        )}

        {previewPrivate.length > 0 ? (
          <>
            <div className="mt-10 flex flex-wrap items-start gap-3">
              <span
                className="mt-1.5 hidden h-8 w-0.5 shrink-0 rounded-full bg-zinc-300 dark:bg-zinc-600 sm:block"
                aria-hidden
              />
              <div>
                <h4 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
                  Private courses
                </h4>
                <p className="mt-1 max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
                  Not on Explore — only you can open them from here.
                </p>
              </div>
            </div>
            <ul className={courseGridClass}>
              {previewPrivate.map((c, index) => (
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
                  visualVariant="default"
                  onDragStart={() => handleDragStart("private", index)}
                  onDragOver={(e) => handleDragOver("private", e, index)}
                  onDrop={() => handleDrop("private", index)}
                  onDragEnd={handleDragEnd}
                />
              ))}
            </ul>
          </>
        ) : null}
      </section>

      <div
        className="my-12 border-t border-zinc-200/80 dark:border-zinc-800"
        aria-hidden
      />

      <section className="space-y-5">
        <div className="flex flex-wrap items-start gap-4">
          <span
            className="mt-1 hidden h-10 w-1 shrink-0 rounded-full bg-gradient-to-b from-zinc-500 to-zinc-700 sm:block"
            aria-hidden
          />
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-2xl">
              Self study
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Private — only visible to you in your workspace.
            </p>
          </div>
        </div>

        {previewSelfStudy.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200/90 bg-zinc-50/40 px-5 py-8 text-center dark:border-zinc-700/80 dark:bg-zinc-900/30">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Start a self study session when you want a private space for your
              materials and goals — nothing here is published to Explore.
            </p>
            <Link
              href="/dashboard/courses/new?mode=public"
              className="mt-4 inline-flex text-sm font-semibold text-brand hover:underline dark:text-brand-soft"
            >
              Create a course
            </Link>
          </div>
        ) : (
          <ul className={courseGridClass}>
            {previewSelfStudy.map((c, index) => (
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
                visualVariant="selfStudy"
                onDragStart={() => handleDragStart("self", index)}
                onDragOver={(e) => handleDragOver("self", e, index)}
                onDrop={() => handleDrop("self", index)}
                onDragEnd={handleDragEnd}
              />
            ))}
          </ul>
        )}
      </section>

      {/* ─── Delete confirmation modal ─────────────────────────────────────── */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-course-title"
          onClick={(e) => {
            // Click on backdrop dismisses (but not on the modal itself)
            if (e.target === e.currentTarget && busyId !== pendingDelete.id) {
              setPendingDelete(null);
            }
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-800 dark:bg-zinc-950 sm:p-7">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
                <svg
                  className="h-5 w-5 text-red-600 dark:text-red-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M8.485 3.495c.667-1.148 2.363-1.148 3.03 0l6.28 10.795c.673 1.158-.171 2.605-1.515 2.605H3.72c-1.344 0-2.188-1.447-1.515-2.605L8.485 3.495zM10 7a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 7zm0 8.25a.95.95 0 100-1.9.95.95 0 000 1.9z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="min-w-0 flex-1">
                <h2
                  id="delete-course-title"
                  className="text-lg font-semibold text-zinc-900 dark:text-zinc-50"
                >
                  Delete this course?
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    &ldquo;{pendingDelete.title}&rdquo;
                  </span>{" "}
                  will be permanently deleted, along with all uploads, sections,
                  generated lessons, quizzes, and progress.
                </p>
                <p className="mt-2 text-sm font-medium text-red-600 dark:text-red-400">
                  This cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                disabled={busyId === pendingDelete.id}
                className="inline-flex items-center justify-center rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDelete()}
                disabled={busyId === pendingDelete.id}
                className="inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-red-700 disabled:opacity-60 dark:bg-red-500 dark:hover:bg-red-600"
              >
                {busyId === pendingDelete.id ? "Deleting…" : "Delete course"}
              </button>
            </div>
          </div>
        </div>
      )}
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
  visualVariant = "default",
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
  visualVariant?: "default" | "selfStudy";
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
          "group relative flex h-full flex-col overflow-hidden rounded-2xl border shadow-md ring-1 transition-[box-shadow,transform,border-color] duration-300 motion-reduce:hover:translate-y-0",
          visualVariant === "selfStudy"
            ? "border-violet-900/35 bg-white/95 shadow-violet-950/[0.06] ring-violet-950/15 hover:-translate-y-0.5 hover:border-violet-500/45 hover:shadow-lg hover:shadow-violet-950/10 dark:border-violet-400/20 dark:bg-zinc-950/95 dark:shadow-black/20 dark:ring-violet-400/10 dark:hover:border-violet-300/35"
            : "border-zinc-200/90 bg-white/95 shadow-zinc-900/[0.04] ring-white/40 hover:-translate-y-0.5 hover:border-brand-border hover:shadow-xl hover:shadow-red-900/[0.07] dark:border-zinc-800 dark:bg-zinc-950/95 dark:ring-zinc-700/30 dark:hover:border-brand-border/50",
          density === "compact" ? "pt-6" : "pt-7",
        ].join(" ")}
      >
        <div
          className={
            visualVariant === "selfStudy"
              ? "absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-violet-700 via-fuchsia-600 to-violet-500 opacity-85"
              : "absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand via-red-500 to-brand-soft opacity-90"
          }
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
              {isExploreListed(c) ? (
                <span className="rounded-full border border-emerald-200/80 bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-200">
                  On Explore
                </span>
              ) : visualVariant === "selfStudy" ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-zinc-300/90 bg-zinc-100/90 px-2.5 py-0.5 text-xs font-semibold text-zinc-800 shadow-sm dark:border-zinc-600 dark:bg-zinc-900/90 dark:text-zinc-200">
                  <svg
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-3 w-3 opacity-80"
                    aria-hidden
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 1a4.5 4.5 0 00-4.5 4.5V7H5a2 2 0 00-2 2v7a2 2 0 002 2h10a2 2 0 002-2V9a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Private
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
