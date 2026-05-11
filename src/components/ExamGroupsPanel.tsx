"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Link from "next/link";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { CourseUploadForm } from "@/components/CourseUploadForm";
import { displayMaterialSectionLabel } from "@/lib/study-material-display-name";

export type ExamGroupRow = {
  id: string;
  name: string;
  sort_order: number;
};

export type MaterialRow = {
  id: string;
  file_name: string;
  created_at: string;
  exam_group_id: string;
  sort_order: number;
};

function DragHandleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M8 6h8M8 12h8M8 18h8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SortableMaterialRow({
  material: m,
  courseId,
  busy,
  editing,
  renameDraft,
  setRenameDraft,
  onSaveRename,
  onCancelRename,
  onBeginRename,
  onDelete,
  dragDisabled,
}: {
  material: MaterialRow;
  courseId: string;
  busy: boolean;
  editing: boolean;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  onSaveRename: (e: React.FormEvent, materialId: string) => void | Promise<void>;
  onCancelRename: () => void;
  onBeginRename: (m: MaterialRow) => void;
  onDelete: (m: MaterialRow) => void | Promise<void>;
  dragDisabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: m.id,
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.55 : undefined,
    position: "relative" as const,
    zIndex: isDragging ? 2 : undefined,
  };

  if (editing) {
    return (
      <li ref={setNodeRef} style={style} className="bg-white dark:bg-zinc-950">
        <div className="px-5 py-4">
          <form
            onSubmit={(e) => void onSaveRename(e, m.id)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`rename-m-${m.id}`}>
                Upload name
              </label>
              <input
                id={`rename-m-${m.id}`}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                autoFocus
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelRename}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </li>
    );
  }

  return (
    <li ref={setNodeRef} style={style} className="bg-white dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-sm sm:flex-nowrap sm:gap-3 sm:px-5 sm:py-4">
        {!dragDisabled ? (
          <button
            type="button"
            className="touch-none rounded-lg p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 active:cursor-grabbing dark:hover:bg-zinc-900 dark:hover:text-zinc-300 cursor-grab disabled:cursor-not-allowed disabled:opacity-40"
            aria-label="Drag to reorder"
            {...attributes}
            {...listeners}
          >
            <DragHandleIcon />
          </button>
        ) : (
          <span className="w-10 shrink-0 sm:w-9" aria-hidden />
        )}
        <Link
          href={`/dashboard/courses/${courseId}/study?material=${m.id}`}
          className="min-w-0 flex-1 truncate font-medium text-brand hover:underline dark:text-brand-soft"
        >
          {displayMaterialSectionLabel(m.file_name)}
        </Link>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {new Date(m.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 pl-10 sm:ml-0 sm:w-auto sm:pl-0">
          <Link
            href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(m.id)}`}
            className="rounded-full border border-brand/45 bg-brand-blush/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-blush dark:border-brand-border/45 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand-blush/25"
          >
            Edit
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => onBeginRename(m)}
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete(m)}
            className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function PlainMaterialRow(
  props: Omit<Parameters<typeof SortableMaterialRow>[0], "dragDisabled"> & {
    showGripPlaceholder?: boolean;
  }
) {
  const {
    material: m,
    courseId,
    busy,
    editing,
    renameDraft,
    setRenameDraft,
    onSaveRename,
    onCancelRename,
    onBeginRename,
    onDelete,
    showGripPlaceholder = false,
  } = props;

  if (editing) {
    return (
      <li className="bg-white dark:bg-zinc-950">
        <div className="px-5 py-4">
          <form
            onSubmit={(e) => void onSaveRename(e, m.id)}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <div className="min-w-0 flex-1">
              <label className="sr-only" htmlFor={`rename-m-${m.id}`}>
                Upload name
              </label>
              <input
                id={`rename-m-${m.id}`}
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                autoFocus
              />
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="submit"
                disabled={busy}
                className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
              >
                Save
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelRename}
                className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </li>
    );
  }

  if (showGripPlaceholder) {
    return (
      <li className="bg-white dark:bg-zinc-950">
        <div className="flex flex-wrap items-center gap-2 px-3 py-3 text-sm sm:flex-nowrap sm:gap-3 sm:px-5 sm:py-4">
          <span
            className="touch-none rounded-lg p-2 text-zinc-400 dark:text-zinc-500"
            aria-hidden
          >
            <DragHandleIcon />
          </span>
          <Link
            href={`/dashboard/courses/${courseId}/study?material=${m.id}`}
            className="min-w-0 flex-1 truncate font-medium text-brand hover:underline dark:text-brand-soft"
          >
            {displayMaterialSectionLabel(m.file_name)}
          </Link>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {new Date(m.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          </span>
          <div className="flex w-full shrink-0 flex-wrap items-center gap-2 pl-10 sm:ml-0 sm:w-auto sm:pl-0">
            <Link
              href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(m.id)}`}
              className="rounded-full border border-brand/45 bg-brand-blush/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-blush dark:border-brand-border/45 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand-blush/25"
            >
              Edit
            </Link>
            <button
              type="button"
              disabled={busy}
              onClick={() => onBeginRename(m)}
              className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Rename
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void onDelete(m)}
              className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Delete
            </button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="bg-white dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm sm:flex-nowrap">
        <Link
          href={`/dashboard/courses/${courseId}/study?material=${m.id}`}
          className="min-w-0 flex-1 truncate font-medium text-brand hover:underline dark:text-brand-soft"
        >
          {displayMaterialSectionLabel(m.file_name)}
        </Link>
        <span className="shrink-0 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {new Date(m.created_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          <Link
            href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(m.id)}`}
            className="rounded-full border border-brand/45 bg-brand-blush/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-blush dark:border-brand-border/45 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand-blush/25"
          >
            Edit
          </Link>
          <button
            type="button"
            disabled={busy}
            onClick={() => onBeginRename(m)}
            className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Rename
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void onDelete(m)}
            className="rounded-full border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function MaterialBuildsList({
  courseId,
  materials,
  reorderBusy,
  materialBusyId,
  editingMaterialId,
  renameDraft,
  setRenameDraft,
  sensors,
  onDragEnd,
  saveRenameMaterial,
  cancelRenameMaterial,
  beginRenameMaterial,
  deleteMaterial,
}: {
  courseId: string;
  materials: MaterialRow[];
  reorderBusy: boolean;
  materialBusyId: string | null;
  editingMaterialId: string | null;
  renameDraft: string;
  setRenameDraft: (v: string) => void;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  saveRenameMaterial: (e: React.FormEvent, materialId: string) => void | Promise<void>;
  cancelRenameMaterial: () => void;
  beginRenameMaterial: (m: MaterialRow) => void;
  deleteMaterial: (m: MaterialRow) => void | Promise<void>;
}) {
  const ulClass =
    "mt-3 divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950";

  const sortable = materials.length > 1;
  /** Avoid SSR + @dnd-kit hydration mismatch (unstable a11y ids like aria-describedby). */
  const [dndMounted, setDndMounted] = useState(false);
  useEffect(() => {
    setDndMounted(true);
  }, []);
  const dndContextId = useId();

  const rows = materials.map((m) => {
    const busy = materialBusyId === m.id || reorderBusy;
    const editing = editingMaterialId === m.id;
    const dragDisabled = busy || editing || !sortable;

    if (!sortable) {
      return (
        <PlainMaterialRow
          key={m.id}
          material={m}
          courseId={courseId}
          busy={busy}
          editing={editing}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          onSaveRename={saveRenameMaterial}
          onCancelRename={cancelRenameMaterial}
          onBeginRename={beginRenameMaterial}
          onDelete={deleteMaterial}
        />
      );
    }

    if (!dndMounted) {
      return (
        <PlainMaterialRow
          key={m.id}
          material={m}
          courseId={courseId}
          busy={busy}
          editing={editing}
          renameDraft={renameDraft}
          setRenameDraft={setRenameDraft}
          onSaveRename={saveRenameMaterial}
          onCancelRename={cancelRenameMaterial}
          onBeginRename={beginRenameMaterial}
          onDelete={deleteMaterial}
          showGripPlaceholder={!editing}
        />
      );
    }

    return (
      <SortableMaterialRow
        key={m.id}
        material={m}
        courseId={courseId}
        busy={busy}
        editing={editing}
        renameDraft={renameDraft}
        setRenameDraft={setRenameDraft}
        onSaveRename={saveRenameMaterial}
        onCancelRename={cancelRenameMaterial}
        onBeginRename={beginRenameMaterial}
        onDelete={deleteMaterial}
        dragDisabled={dragDisabled}
      />
    );
  });

  if (!sortable) {
    return <ul className={ulClass}>{rows}</ul>;
  }

  if (!dndMounted) {
    return <ul className={ulClass}>{rows}</ul>;
  }

  return (
    <DndContext
      id={dndContextId}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext
        items={materials.map((m) => m.id)}
        strategy={verticalListSortingStrategy}
      >
        <ul className={ulClass}>{rows}</ul>
      </SortableContext>
    </DndContext>
  );
}

export function ExamGroupsPanel({
  courseId,
  groups,
  materials,
  initialSectionId,
}: {
  courseId: string;
  groups: ExamGroupRow[];
  materials: MaterialRow[];
  /** When set (e.g. from `?section=` after PDF upload redirect), selects that section tab. */
  initialSectionId?: string;
}) {
  const router = useRouter();
  const [activeId, setActiveId] = useState(() => {
    if (
      initialSectionId &&
      groups.some((g) => g.id === initialSectionId)
    ) {
      return initialSectionId;
    }
    return groups[0]?.id ?? "";
  });
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(
    null
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [materialBusyId, setMaterialBusyId] = useState<string | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [autoRenameBusy, setAutoRenameBusy] = useState(false);
  const [materialDeleteId, setMaterialDeleteId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    if (!groups.length) return;
    if (!groups.some((g) => g.id === activeId)) {
      setActiveId(groups[0].id);
    }
  }, [groups, activeId]);

  const materialsForActive = useMemo(() => {
    const list = materials.filter((m) => m.exam_group_id === activeId);
    return [...list].sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, [materials, activeId]);

  async function persistMaterialOrder(orderedIds: string[]) {
    setReorderBusy(true);
    setMaterialError(null);
    try {
      const res = await fetch("/api/study-materials/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          examGroupId: activeId,
          materialIds: orderedIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string" ? body.error : "Could not reorder."
        );
        setReorderBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setMaterialError("Network error.");
    }
    setReorderBusy(false);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  function handleMaterialsDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = materialsForActive.map((x) => x.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(ids, oldIndex, newIndex);
    void persistMaterialOrder(next);
  }

  async function autoRenameBuildsInGroup() {
    setAutoRenameBusy(true);
    setMaterialError(null);
    try {
      const res = await fetch("/api/study-materials/auto-rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          examGroupId: activeId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string"
            ? body.error
            : "Could not auto-rename."
        );
        setAutoRenameBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setMaterialError("Network error.");
    }
    setAutoRenameBusy(false);
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (name.length < 1) return;

    setCreateError(null);
    setCreating(true);
    try {
      const res = await fetch("/api/exam-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(
          typeof body.error === "string" ? body.error : "Could not add section."
        );
        setCreating(false);
        return;
      }
      setNewName("");
      const gid = body.groupId as string | undefined;
      if (gid) setActiveId(gid);
      router.refresh();
    } catch {
      setCreateError("Network error.");
    }
    setCreating(false);
  }

  function beginRenameMaterial(m: MaterialRow) {
    setMaterialError(null);
    setEditingMaterialId(m.id);
    setRenameDraft(displayMaterialSectionLabel(m.file_name));
  }

  function cancelRenameMaterial() {
    setEditingMaterialId(null);
  }

  async function saveRenameMaterial(e: React.FormEvent, materialId: string) {
    e.preventDefault();
    const fileName = renameDraft.trim();
    if (fileName.length < 1 || fileName.length > 240) {
      setMaterialError("Use 1–240 characters.");
      return;
    }

    setMaterialBusyId(materialId);
    setMaterialError(null);
    try {
      const res = await fetch(`/api/study-materials/${materialId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string" ? body.error : "Could not rename."
        );
        setMaterialBusyId(null);
        return;
      }
      setEditingMaterialId(null);
      router.refresh();
    } catch {
      setMaterialError("Network error.");
    }
    setMaterialBusyId(null);
  }

  function requestDeleteMaterial(m: MaterialRow) {
    setMaterialError(null);
    setMaterialDeleteId(m.id);
  }

  async function confirmDeleteMaterial() {
    const id = materialDeleteId;
    if (!id || deleteBusy) return;
    const m = materials.find((x) => x.id === id);
    if (!m) {
      setMaterialDeleteId(null);
      return;
    }

    setMaterialBusyId(m.id);
    setMaterialError(null);
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/study-materials/${m.id}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string" ? body.error : "Could not delete."
        );
        return;
      }
      setMaterialDeleteId(null);
      setEditingMaterialId(null);
      router.refresh();
    } catch {
      setMaterialError("Network error.");
    } finally {
      setDeleteBusy(false);
      setMaterialBusyId(null);
    }
  }

  if (groups.length === 0) {
    return (
      <section className="mt-12 rounded-3xl border border-amber-200/90 bg-amber-50/80 p-8 dark:border-amber-900/60 dark:bg-amber-950/40">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Step 1: Add course sections
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
          Before uploading, split your course into sections — for example{" "}
          <strong>Week 1</strong>, <strong>Unit A</strong>, or{" "}
          <strong>Midterm prep</strong>. Each PDF lives in one section so
          materials stay organized and don&apos;t get mixed together.
        </p>
        <form onSubmit={(e) => void createGroup(e)} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="first-group" className="sr-only">
              Section name
            </label>
            <input
              id="first-group"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Week 1"
              className="w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="shrink-0 rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
          >
            {creating ? "Adding…" : "Add section"}
          </button>
        </form>
        {createError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">
            {createError}
          </p>
        )}
      </section>
    );
  }

  const materialPendingDelete =
    materialDeleteId != null
      ? materials.find((x) => x.id === materialDeleteId) ?? null
      : null;

  return (
    <>
    <section className="mt-12 space-y-8">
      <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-6 shadow-lg shadow-zinc-900/5 dark:border-zinc-800 dark:bg-zinc-950/95 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              Sections & uploads
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Pick a tab, then upload PDFs for that section only. Each upload
              stays in its tab — nothing spills into another part of the course.
            </p>
          </div>
          <form
            onSubmit={(e) => void createGroup(e)}
            className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Add section (e.g. Week 2)"
              className="min-w-0 flex-1 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 sm:w-52"
            />
            <button
              type="submit"
              disabled={creating || !newName.trim()}
              className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {creating ? "…" : "Add"}
            </button>
          </form>
        </div>
        {createError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">
            {createError}
          </p>
        )}

        <div
          className="mt-6 flex gap-2 overflow-x-auto pb-1 scrollbar-thin"
          role="tablist"
        >
          {groups.map((g) => {
            const active = g.id === activeId;
            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveId(g.id)}
                className={`shrink-0 rounded-full px-5 py-2.5 text-sm font-semibold transition ${
                  active
                    ? "bg-brand text-white shadow-md shadow-red-600/25 dark:bg-brand"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {g.name}
              </button>
            );
          })}
        </div>

        <div className="mt-8 border-t border-zinc-100 pt-8 dark:border-zinc-800">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            Upload for{" "}
            <span className="text-brand dark:text-brand-soft">
              {groups.find((g) => g.id === activeId)?.name ?? "this section"}
            </span>
          </h3>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            Slides or readings for this section only.
          </p>
          <div className="mt-6">
            <CourseUploadForm courseId={courseId} examGroupId={activeId} />
          </div>
        </div>
      </div>

      {materialsForActive.length > 0 && (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Materials in this section
              </h3>
              {materialsForActive.length > 1 ? (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Drag the handle to reorder.
                </p>
              ) : null}
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  Auto-rename
                </span>{" "}
                sets each filename from the generated course title for that PDF
                (from your slides&apos; text). If two match, we add{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  (2)
                </span>
                ,{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  (3)
                </span>
                , …
              </p>
            </div>
            <button
              type="button"
              disabled={
                autoRenameBusy ||
                reorderBusy ||
                Boolean(materialBusyId) ||
                Boolean(editingMaterialId)
              }
              onClick={() => void autoRenameBuildsInGroup()}
              className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              {autoRenameBusy ? "Renaming…" : "Auto-rename"}
            </button>
          </div>
          {materialError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {materialError}
            </p>
          )}
          <MaterialBuildsList
            courseId={courseId}
            materials={materialsForActive}
            reorderBusy={reorderBusy}
            materialBusyId={materialBusyId}
            editingMaterialId={editingMaterialId}
            renameDraft={renameDraft}
            setRenameDraft={setRenameDraft}
            sensors={sensors}
            onDragEnd={handleMaterialsDragEnd}
            saveRenameMaterial={saveRenameMaterial}
            cancelRenameMaterial={cancelRenameMaterial}
            beginRenameMaterial={beginRenameMaterial}
            deleteMaterial={requestDeleteMaterial}
          />
        </div>
      )}
    </section>
    <ConfirmDialog
      open={materialPendingDelete != null}
      title="Delete this upload?"
      cancelLabel="Cancel"
      confirmLabel="Delete"
      confirmBusy={deleteBusy}
      onCancel={() => {
        if (!deleteBusy) setMaterialDeleteId(null);
      }}
      onConfirm={confirmDeleteMaterial}
    >
      <p>
        Are you sure you want to delete{" "}
        <span className="font-semibold text-zinc-900 dark:text-zinc-100">
          {materialPendingDelete
            ? displayMaterialSectionLabel(materialPendingDelete.file_name)
            : "this upload"}
        </span>
        ? This removes the generated lessons and quizzes for this upload.
      </p>
    </ConfirmDialog>
    </>
  );
}
