"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";

export type DeletedReviewMaterial = {
  materialId: string;
  fileName: string;
  courseId: string | null;
  courseTitle: string | null;
  deletedAt: string;
};

/**
 * Collapsible “Deleted” area on Review — restore or permanently purge
 * soft-deleted module and notes-focus review decks.
 */
export function ReviewDeletedMaterials({
  refreshKey = 0,
  onRestored,
}: {
  /** Bump after a soft-delete so the list reloads. */
  refreshKey?: number;
  onRestored?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [materials, setMaterials] = useState<DeletedReviewMaterial[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingPurge, setPendingPurge] =
    useState<DeletedReviewMaterial | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/study-materials/deleted");
      if (!res.ok) throw new Error(`deleted ${res.status}`);
      const json = (await res.json()) as {
        materials?: DeletedReviewMaterial[];
      };
      const next = json.materials ?? [];
      setMaterials(next);
      if (next.length > 0 && refreshKey > 0) {
        setOpen(true);
      }
    } catch {
      setError(t.review.deletedLoadError);
      setMaterials([]);
    } finally {
      setLoading(false);
    }
  }, [refreshKey, t.review.deletedLoadError]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const restore = useCallback(
    async (material: DeletedReviewMaterial) => {
      setBusyId(material.materialId);
      setError(null);
      try {
        const res = await fetch("/api/study-materials/deleted", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "restore",
            materialIds: [material.materialId],
          }),
        });
        if (!res.ok) {
          setError(t.review.deletedRestoreError);
          return;
        }
        setMaterials((prev) =>
          prev.filter((m) => m.materialId !== material.materialId)
        );
        onRestored?.();
      } catch {
        setError(t.review.deletedRestoreError);
      } finally {
        setBusyId(null);
      }
    },
    [onRestored, t.review.deletedRestoreError]
  );

  const confirmPurge = useCallback(async () => {
    if (!pendingPurge) return;
    const material = pendingPurge;
    setBusyId(material.materialId);
    setError(null);
    try {
      const res = await fetch("/api/study-materials/deleted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "purge",
          materialIds: [material.materialId],
        }),
      });
      if (!res.ok) {
        setError(t.review.deletedPurgeError);
        return;
      }
      setMaterials((prev) =>
        prev.filter((m) => m.materialId !== material.materialId)
      );
      setPendingPurge(null);
    } catch {
      setError(t.review.deletedPurgeError);
    } finally {
      setBusyId(null);
    }
  }, [pendingPurge, t.review.deletedPurgeError]);

  const count = materials.length;
  const heading =
    count === 0
      ? t.review.deletedHeading
      : count === 1
        ? t.review.deletedHeadingOne
        : tf(t.review.deletedHeadingCount, { count });

  return (
    <section className="space-y-2 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 text-left"
        aria-expanded={open}
      >
        <h3 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {heading}
        </h3>
        <span className="text-xs font-medium text-zinc-500 dark:text-zinc-500">
          {open ? t.review.deletedCollapse : t.review.deletedExpand}
        </span>
      </button>

      {open ? (
        <div className="space-y-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {t.review.deletedHint}
          </p>

          {error ? (
            <p className="text-xs font-medium text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t.review.deletedLoading}
            </p>
          ) : count === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t.review.deletedEmpty}
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
              {materials.map((m) => {
                const busy = busyId === m.materialId;
                const title = m.courseTitle?.trim() || m.fileName;
                const subtitle =
                  m.courseTitle && m.fileName !== m.courseTitle
                    ? m.fileName
                    : null;
                return (
                  <li
                    key={m.materialId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {title}
                      </p>
                      {subtitle ? (
                        <p className="truncate text-xs text-zinc-500 dark:text-zinc-500">
                          {subtitle}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void restore(m)}
                        className="text-xs font-medium text-brand hover:text-brand-hover disabled:opacity-40 dark:text-brand-soft"
                      >
                        {t.review.deletedRestore}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setPendingPurge(m)}
                        className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {t.review.deletedPurge}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingPurge != null}
        title={t.review.deletedPurgeTitle}
        confirmLabel={t.review.deletedPurge}
        confirmBusy={busyId != null && pendingPurge != null}
        onCancel={() => {
          if (busyId == null) setPendingPurge(null);
        }}
        onConfirm={() => void confirmPurge()}
      >
        {t.review.deletedPurgeWarning}
      </ConfirmDialog>
    </section>
  );
}
