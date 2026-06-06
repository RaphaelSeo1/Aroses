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
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CourseUploadForm } from "@/components/CourseUploadForm";
import type { CourseOutputLanguage } from "@/lib/course-output-language";
import {
  displayMaterialSectionLabel,
  suggestMaterialLabelFromPayload,
} from "@/lib/study-material-display-name";

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
  /** Present on dashboard load — used for smarter rename / auto-rename on server. */
  course_payload?: unknown;
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
  showSelection,
  selected,
  selectionDisabled,
  onToggleSelect,
  readOnly = false,
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
  showSelection: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelect: (id: string) => void;
  readOnly?: boolean;
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
        {showSelection ? (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
            checked={selected}
            disabled={selectionDisabled}
            onChange={() => onToggleSelect(m.id)}
            aria-label={`Select ${displayMaterialSectionLabel(m.file_name)}`}
          />
        ) : (
          <span className="w-4 shrink-0 sm:w-4" aria-hidden />
        )}
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
            {readOnly ? "Open" : "Edit"}
          </Link>
          {!readOnly ? (
            <>
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
            </>
          ) : null}
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
    showSelection,
    selected,
    selectionDisabled,
    onToggleSelect,
    readOnly = false,
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
          {showSelection ? (
            <input
              type="checkbox"
              className="h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
              checked={selected}
              disabled={selectionDisabled}
              onChange={() => onToggleSelect(m.id)}
              aria-label={`Select ${displayMaterialSectionLabel(m.file_name)}`}
            />
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
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
              {readOnly ? "Open" : "Edit"}
            </Link>
            {!readOnly ? (
              <>
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
              </>
            ) : null}
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="bg-white dark:bg-zinc-950">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4 text-sm sm:flex-nowrap">
        {showSelection ? (
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 rounded border-zinc-300 text-brand focus:ring-brand disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
            checked={selected}
            disabled={selectionDisabled}
            onChange={() => onToggleSelect(m.id)}
            aria-label={`Select ${displayMaterialSectionLabel(m.file_name)}`}
          />
        ) : (
          <span className="w-4 shrink-0" aria-hidden />
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
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
          <Link
            href={`/dashboard/courses/${courseId}/study?material=${encodeURIComponent(m.id)}`}
            className="rounded-full border border-brand/45 bg-brand-blush/70 px-3 py-1.5 text-xs font-semibold text-brand hover:bg-brand-blush dark:border-brand-border/45 dark:bg-brand-blush/15 dark:text-brand-soft dark:hover:bg-brand-blush/25"
          >
            {readOnly ? "Open" : "Edit"}
          </Link>
          {!readOnly ? (
            <>
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
            </>
          ) : null}
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
  showSelection,
  selectedIds,
  selectionDisabled,
  onToggleSelectMaterial,
  readOnly = false,
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
  showSelection: boolean;
  selectedIds: Set<string>;
  selectionDisabled: boolean;
  onToggleSelectMaterial: (id: string) => void;
  readOnly?: boolean;
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
    const dragDisabled = readOnly || busy || editing || !sortable;
    const selected = selectedIds.has(m.id);

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
          showSelection={showSelection}
          selected={selected}
          selectionDisabled={selectionDisabled}
          onToggleSelect={onToggleSelectMaterial}
          readOnly={readOnly}
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
          showSelection={showSelection}
          selected={selected}
          selectionDisabled={selectionDisabled}
          onToggleSelect={onToggleSelectMaterial}
          readOnly={readOnly}
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
        showSelection={showSelection}
        selected={selected}
        selectionDisabled={selectionDisabled}
        onToggleSelect={onToggleSelectMaterial}
        readOnly={readOnly}
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

export type FailedJobRow = {
  id: string;
  original_file_name: string | null;
  exam_group_id: string | null;
  error_message: string | null;
};

export function ExamGroupsPanel({
  courseId,
  groups,
  materials,
  failedJobs = [],
  initialSectionId,
  isSelfStudy = false,
  defaultOutputLanguage,
  readOnly = false,
}: {
  courseId: string;
  groups: ExamGroupRow[];
  materials: MaterialRow[];
  failedJobs?: FailedJobRow[];
  /** When set (e.g. from `?section=` after PDF upload redirect), selects that section tab. */
  initialSectionId?: string;
  /** Expands the per-upload goal block by default in the upload form so the
   *  learner remembers to write a fresh goal for each lecture. */
  isSelfStudy?: boolean;
  defaultOutputLanguage?: CourseOutputLanguage;
  /** View-only collaborators: hide uploads and content mutations. */
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [dismissedJobIds, setDismissedJobIds] = useState<Set<string>>(() => new Set());

  async function dismissFailedJob(jobId: string) {
    setDismissedJobIds((prev) => new Set([...prev, jobId]));
    try {
      const res = await fetch(`/api/process-pdf/jobs/${jobId}/dismiss`, { method: "DELETE" });
      if (!res.ok) {
        // If the server rejected the dismiss (e.g. status changed), force a full
        // page reload so the banner reflects the true server state.
        router.refresh();
      }
    } catch {
      // Best-effort — already hidden locally; stale banner will clear on next refresh
    }
  }
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
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [groupRenameDraft, setGroupRenameDraft] = useState("");
  const [groupRenameBusy, setGroupRenameBusy] = useState(false);
  const [groupRenameError, setGroupRenameError] = useState<string | null>(null);
  const groupRenameInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteGroupId, setPendingDeleteGroupId] = useState<string | null>(
    null
  );
  const [deleteGroupBusy, setDeleteGroupBusy] = useState(false);
  const [deleteGroupError, setDeleteGroupError] = useState<string | null>(null);
  const [editingMaterialId, setEditingMaterialId] = useState<string | null>(
    null
  );
  const [renameDraft, setRenameDraft] = useState("");
  const [materialBusyId, setMaterialBusyId] = useState<string | null>(null);
  const [materialError, setMaterialError] = useState<string | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  // Optimistic local order: groupId → ordered material IDs (cleared on server refresh)
  const [localOrderByGroup, setLocalOrderByGroup] = useState<Record<string, string[]>>({});
  const [autoRenameBusy, setAutoRenameBusy] = useState(false);
  const [deletePendingIds, setDeletePendingIds] = useState<string[] | null>(
    null
  );
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(
    () => new Set()
  );
  const selectAllInSectionRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!groups.length) return;
    if (!groups.some((g) => g.id === activeId)) {
      setActiveId(groups[0].id);
    }
  }, [groups, activeId]);

  const materialsForActive = useMemo(() => {
    const list = materials.filter((m) => m.exam_group_id === activeId);
    const localOrder = localOrderByGroup[activeId];
    if (localOrder) {
      // Apply optimistic order
      const byId = Object.fromEntries(list.map((m) => [m.id, m]));
      const ordered = localOrder.map((id) => byId[id]).filter(Boolean) as MaterialRow[];
      // Append any items not in localOrder (newly added)
      const inOrder = new Set(localOrder);
      for (const m of list) if (!inOrder.has(m.id)) ordered.push(m);
      return ordered;
    }
    return [...list].sort((a, b) => {
      const ao = a.sort_order ?? 0;
      const bo = b.sort_order ?? 0;
      if (ao !== bo) return ao - bo;
      return (
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, [materials, activeId, localOrderByGroup]);

  useEffect(() => {
    setSelectedMaterialIds(new Set());
  }, [activeId]);

  const selectedInSectionCount = useMemo(() => {
    let n = 0;
    for (const m of materialsForActive) {
      if (selectedMaterialIds.has(m.id)) n += 1;
    }
    return n;
  }, [materialsForActive, selectedMaterialIds]);

  const allInSectionSelected =
    materialsForActive.length > 0 &&
    selectedInSectionCount === materialsForActive.length;

  useEffect(() => {
    const el = selectAllInSectionRef.current;
    if (!el) return;
    el.indeterminate =
      selectedInSectionCount > 0 && !allInSectionSelected;
  }, [selectedInSectionCount, allInSectionSelected]);

  const selectionDisabled =
    autoRenameBusy ||
    Boolean(materialBusyId) ||
    Boolean(editingMaterialId) ||
    deleteBusy;
  const showRowSelection = editingMaterialId == null;

  const pendingDeleteRows = useMemo(() => {
    if (!deletePendingIds?.length) return [];
    return deletePendingIds
      .map((id) => materials.find((x) => x.id === id))
      .filter((x): x is MaterialRow => Boolean(x));
  }, [deletePendingIds, materials]);

  async function persistMaterialOrder(orderedIds: string[], groupId: string) {
    // Apply optimistic order instantly — no waiting for server
    setLocalOrderByGroup((prev) => ({ ...prev, [groupId]: orderedIds }));
    setMaterialError(null);
    try {
      const res = await fetch("/api/study-materials/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          examGroupId: groupId,
          materialIds: orderedIds,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string" ? body.error : "Could not reorder."
        );
        // Revert optimistic update on error
        setLocalOrderByGroup((prev) => {
          const next = { ...prev };
          delete next[groupId];
          return next;
        });
        return;
      }
      // Clear local override now that server is in sync
      setLocalOrderByGroup((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
      router.refresh();
    } catch {
      setMaterialError("Network error.");
      setLocalOrderByGroup((prev) => {
        const next = { ...prev };
        delete next[groupId];
        return next;
      });
    }
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
    void persistMaterialOrder(next, activeId);
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

  function beginRenameGroup(g: ExamGroupRow) {
    setGroupRenameError(null);
    setRenamingGroupId(g.id);
    setGroupRenameDraft(g.name);
    setTimeout(() => groupRenameInputRef.current?.select(), 0);
  }

  function cancelRenameGroup() {
    setRenamingGroupId(null);
    setGroupRenameDraft("");
    setGroupRenameError(null);
  }

  async function saveRenameGroup(e: React.FormEvent, groupId: string) {
    e.preventDefault();
    const name = groupRenameDraft.trim();
    if (name.length < 1 || name.length > 120) {
      setGroupRenameError("Name must be 1–120 characters.");
      return;
    }
    setGroupRenameBusy(true);
    setGroupRenameError(null);
    try {
      const res = await fetch(`/api/exam-groups/${groupId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGroupRenameError(
          typeof body.error === "string" ? body.error : "Could not rename."
        );
        setGroupRenameBusy(false);
        return;
      }
      setRenamingGroupId(null);
      router.refresh();
    } catch {
      setGroupRenameError("Network error.");
    }
    setGroupRenameBusy(false);
  }

  function beginDeleteGroup(groupId: string) {
    setDeleteGroupError(null);
    setPendingDeleteGroupId(groupId);
  }

  function cancelDeleteGroup() {
    if (deleteGroupBusy) return;
    setPendingDeleteGroupId(null);
    setDeleteGroupError(null);
  }

  async function confirmDeleteGroup() {
    if (!pendingDeleteGroupId || deleteGroupBusy) return;
    const groupId = pendingDeleteGroupId;
    setDeleteGroupBusy(true);
    setDeleteGroupError(null);
    try {
      const res = await fetch(`/api/exam-groups/${groupId}`, {
        method: "DELETE",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteGroupError(
          typeof body.error === "string"
            ? body.error
            : "Could not delete section."
        );
        setDeleteGroupBusy(false);
        return;
      }
      // Move focus to the next available section before refresh so the UI
      // doesn't blink on a dead activeId.
      if (groupId === activeId) {
        const fallback = groups.find((g) => g.id !== groupId);
        if (fallback) setActiveId(fallback.id);
      }
      setPendingDeleteGroupId(null);
      router.refresh();
    } catch {
      setDeleteGroupError("Network error.");
    }
    setDeleteGroupBusy(false);
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
    const suggested = suggestMaterialLabelFromPayload(m.course_payload);
    setRenameDraft(
      suggested ?? displayMaterialSectionLabel(m.file_name)
    );
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

  function toggleSelectMaterial(id: string) {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllInSection() {
    const ids = materialsForActive.map((m) => m.id);
    setSelectedMaterialIds((prev) => {
      const allSelected =
        ids.length > 0 && ids.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }

  function clearRowSelection() {
    setSelectedMaterialIds(new Set());
  }

  function requestDeleteMaterial(m: MaterialRow) {
    setMaterialError(null);
    setDeletePendingIds([m.id]);
  }

  function requestDeleteSelected() {
    if (selectedInSectionCount < 1) return;
    const ids = materialsForActive
      .filter((m) => selectedMaterialIds.has(m.id))
      .map((m) => m.id);
    if (ids.length < 1) return;
    setMaterialError(null);
    setDeletePendingIds(ids);
  }

  async function confirmDeleteMaterial() {
    const ids = deletePendingIds;
    if (!ids?.length || deleteBusy) return;

    setMaterialError(null);
    setDeleteBusy(true);
    setMaterialBusyId(ids[0] ?? null);
    try {
      const res = await fetch("/api/study-materials/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, materialIds: ids }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMaterialError(
          typeof body.error === "string" ? body.error : "Could not delete."
        );
        return;
      }
      setDeletePendingIds(null);
      setEditingMaterialId(null);
      setSelectedMaterialIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      router.refresh();
    } catch {
      setMaterialError("Network error.");
    } finally {
      setDeleteBusy(false);
      setMaterialBusyId(null);
    }
  }

  if (groups.length === 0) {
    if (readOnly) {
      return (
        <section className="mt-12 rounded-3xl border border-zinc-200/90 bg-zinc-50/80 p-8 dark:border-zinc-800 dark:bg-zinc-950/40">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This course has no sections yet.
          </p>
        </section>
      );
    }
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
          className="mt-6 flex flex-wrap gap-2 pb-1"
          role="tablist"
        >
          {groups.map((g) => {
            const active = g.id === activeId;
            const renaming = renamingGroupId === g.id;

            if (renaming) {
              return (
                <form
                  key={g.id}
                  onSubmit={(e) => void saveRenameGroup(e, g.id)}
                  className="flex items-center gap-1"
                >
                  <input
                    ref={groupRenameInputRef}
                    value={groupRenameDraft}
                    onChange={(e) => setGroupRenameDraft(e.target.value)}
                    disabled={groupRenameBusy}
                    onKeyDown={(e) => { if (e.key === "Escape") cancelRenameGroup(); }}
                    className="w-36 rounded-full border border-brand bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-brand/30 dark:border-brand-border dark:bg-zinc-900 dark:text-zinc-100"
                    autoFocus
                  />
                  <button
                    type="submit"
                    disabled={groupRenameBusy}
                    className="rounded-full bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:opacity-50"
                  >
                    {groupRenameBusy ? "…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={groupRenameBusy}
                    onClick={cancelRenameGroup}
                    className="rounded-full border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </form>
              );
            }

            if (active) {
              // Render the whole pill as one rounded container so the rename
              // and delete actions feel embedded inside the tab instead of
              // floating beside it (which previously caused asymmetric
              // spacing — `pl-5 pr-3` text + icons beside it).
              return (
                <div
                  key={g.id}
                  className="group/tab inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand py-1 pl-4 pr-1 text-white shadow-md shadow-red-600/25 dark:bg-brand"
                  role="tab"
                  aria-selected
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(g.id)}
                    className="px-1 py-1.5 text-sm font-semibold"
                  >
                    {g.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => beginRenameGroup(g)}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition hover:bg-white/20 hover:text-white"
                    aria-label={`Rename ${g.name}`}
                    title="Rename section"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                      <path d="M11.013 2.513a1.75 1.75 0 0 1 2.475 2.474L6.226 12.25a2.75 2.75 0 0 1-.892.592l-2.585.95a.5.5 0 0 1-.634-.634l.95-2.585a2.75 2.75 0 0 1 .592-.892l7.356-7.168Z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => beginDeleteGroup(g.id)}
                    disabled={groups.length <= 1}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-white/80 transition hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white/80"
                    aria-label={`Delete ${g.name}`}
                    title={
                      groups.length <= 1
                        ? "Add another section before deleting this one"
                        : "Delete section"
                    }
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M6.5 1.75a.75.75 0 0 1 .75-.75h1.5a.75.75 0 0 1 .75.75V2.5h3.25a.75.75 0 0 1 0 1.5H13l-.59 9.44A2.25 2.25 0 0 1 10.165 15.5H5.835a2.25 2.25 0 0 1-2.246-2.06L3 4h-.25a.75.75 0 0 1 0-1.5H6.5V1.75ZM4.504 4l.58 9.29a.75.75 0 0 0 .749.71h4.334a.75.75 0 0 0 .748-.71L11.496 4h-6.992ZM7 6.25a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 7 6.25Zm2.75.75a.75.75 0 0 0-1.5 0v4.5a.75.75 0 0 0 1.5 0v-4.5Z" />
                    </svg>
                  </button>
                </div>
              );
            }

            return (
              <button
                key={g.id}
                type="button"
                role="tab"
                aria-selected={false}
                onClick={() => setActiveId(g.id)}
                className="shrink-0 rounded-full bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {g.name}
              </button>
            );
          })}
        </div>
        {deleteGroupError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            {deleteGroupError}
          </p>
        )}
        {groupRenameError && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{groupRenameError}</p>
        )}

        {/* Failed jobs for the active section */}
        {failedJobs.filter((j) => j.exam_group_id === activeId && !dismissedJobIds.has(j.id)).length > 0 && (
          <div className="mt-6 space-y-2">
            {failedJobs
              .filter((j) => j.exam_group_id === activeId && !dismissedJobIds.has(j.id))
              .map((j) => (
                <div
                  key={j.id}
                  className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-900/60 dark:bg-red-950/40"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400">
                    <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
                  </svg>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                      {j.original_file_name ?? "A PDF"} failed to process
                    </p>
                    <p className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                      {j.error_message ?? "An error occurred during extraction."}{" "}
                      Re-upload this file below to try again.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void dismissFailedJob(j.id)}
                    className="ml-auto shrink-0 rounded-lg p-1 text-red-400 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40 dark:hover:text-red-200"
                    aria-label="Dismiss"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                    </svg>
                  </button>
                </div>
              ))}
          </div>
        )}

        {!readOnly ? (
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
              <CourseUploadForm
                courseId={courseId}
                examGroupId={activeId}
                isSelfStudy={isSelfStudy}
                defaultOutputLanguage={defaultOutputLanguage}
              />
            </div>
          </div>
        ) : null}
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
                picks a short name from your generated study (module and lesson
                titles first, then the course title or description). Duplicate
                names get{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  (2)
                </span>
                ,{" "}
                <span className="font-medium text-zinc-600 dark:text-zinc-300">
                  (3)
                </span>
                , … Use checkboxes to delete several uploads at once.
              </p>
            </div>
            {!readOnly ? (
              <button
                type="button"
                disabled={
                  autoRenameBusy ||
                  reorderBusy ||
                  Boolean(materialBusyId) ||
                  Boolean(editingMaterialId) ||
                  deleteBusy
                }
                onClick={() => void autoRenameBuildsInGroup()}
                className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                {autoRenameBusy ? "Renaming…" : "Auto-rename"}
              </button>
            ) : null}
          </div>
          {materialError && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">
              {materialError}
            </p>
          )}
          {materialsForActive.length > 0 && showRowSelection ? (
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
              <label className="inline-flex cursor-pointer items-center gap-2 font-medium text-zinc-700 dark:text-zinc-200">
                <input
                  ref={selectAllInSectionRef}
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300 text-brand focus:ring-brand disabled:opacity-40 dark:border-zinc-600 dark:bg-zinc-900"
                  checked={allInSectionSelected}
                  disabled={selectionDisabled}
                  onChange={toggleSelectAllInSection}
                  aria-label="Select all materials in this section"
                />
                Select all
              </label>
              {selectedInSectionCount > 0 ? (
                <>
                  <span className="text-zinc-500">
                    {selectedInSectionCount} selected
                  </span>
                  <button
                    type="button"
                    disabled={selectionDisabled}
                    onClick={clearRowSelection}
                    className="font-semibold text-brand hover:underline disabled:opacity-40 dark:text-brand-soft"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    disabled={selectionDisabled}
                    onClick={() => requestDeleteSelected()}
                    className="font-semibold text-red-700 hover:underline disabled:opacity-40 dark:text-red-400"
                  >
                    Delete selected…
                  </button>
                </>
              ) : null}
            </div>
          ) : null}
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
            showSelection={readOnly ? false : showRowSelection}
            selectedIds={selectedMaterialIds}
            selectionDisabled={selectionDisabled}
            onToggleSelectMaterial={toggleSelectMaterial}
            readOnly={readOnly}
          />
        </div>
      )}
    </section>
    <ConfirmDialog
      open={Boolean(deletePendingIds?.length)}
      title={
        deletePendingIds && deletePendingIds.length > 1
          ? `Delete ${deletePendingIds.length} uploads?`
          : "Delete this upload?"
      }
      cancelLabel="Cancel"
      confirmLabel="Delete"
      confirmBusy={deleteBusy}
      onCancel={() => {
        if (!deleteBusy) setDeletePendingIds(null);
      }}
      onConfirm={confirmDeleteMaterial}
    >
      {pendingDeleteRows.length === 1 ? (
        <p>
          Are you sure you want to delete{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {displayMaterialSectionLabel(pendingDeleteRows[0].file_name)}
          </span>
          ? This removes the generated lessons and quizzes for this upload.
        </p>
      ) : (
        <>
          <p>
            This removes the generated lessons and quizzes for these uploads
            ({deletePendingIds?.length ?? 0} total):
          </p>
          <ul className="mt-2 max-h-44 list-disc space-y-1 overflow-y-auto pl-5 text-zinc-800 dark:text-zinc-200">
            {pendingDeleteRows.slice(0, 20).map((row) => (
              <li key={row.id}>
                {displayMaterialSectionLabel(row.file_name)}
              </li>
            ))}
          </ul>
          {pendingDeleteRows.length > 20 ? (
            <p className="mt-2 text-xs text-zinc-500">
              …and {pendingDeleteRows.length - 20} more (all will be deleted).
            </p>
          ) : null}
          {pendingDeleteRows.length === 0 && (deletePendingIds?.length ?? 0) > 0 ? (
            <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
              Could not load names for this list; the selected uploads will still
              be removed if you confirm.
            </p>
          ) : null}
        </>
      )}
    </ConfirmDialog>
    <ConfirmDialog
      open={Boolean(pendingDeleteGroupId)}
      title="Delete this section?"
      cancelLabel="Cancel"
      confirmLabel="Delete section"
      confirmBusy={deleteGroupBusy}
      onCancel={cancelDeleteGroup}
      onConfirm={confirmDeleteGroup}
    >
      {(() => {
        const target = groups.find((g) => g.id === pendingDeleteGroupId);
        const materialsInGroup = pendingDeleteGroupId
          ? materials.filter((m) => m.exam_group_id === pendingDeleteGroupId)
              .length
          : 0;
        return (
          <>
            <p>
              Are you sure you want to delete{" "}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                {target?.name ?? "this section"}
              </span>
              ?
            </p>
            {materialsInGroup > 0 ? (
              <p className="mt-2 text-amber-800 dark:text-amber-200">
                This will also permanently delete{" "}
                <span className="font-semibold">
                  {materialsInGroup}{" "}
                  upload{materialsInGroup === 1 ? "" : "s"}
                </span>{" "}
                in this section along with their generated lessons and quizzes.
                This cannot be undone.
              </p>
            ) : (
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                There are no uploads in this section, so nothing else is removed.
              </p>
            )}
          </>
        );
      })()}
    </ConfirmDialog>
    </>
  );
}
