"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export type DismissStudyCourseTarget = {
  courseId: string;
  title: string;
  isExploreLearner?: boolean;
};

export function useDismissStudyCourse(opts?: {
  onDismissed?: (courseId: string) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<DismissStudyCourseTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestDismiss = useCallback((target: DismissStudyCourseTarget) => {
    setError(null);
    setPending(target);
  }, []);

  const confirmDismiss = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/study-courses/${pending.courseId}/dismiss`,
        { method: "POST" }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Could not remove this course."
        );
        return;
      }
      opts?.onDismissed?.(pending.courseId);
      setPending(null);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }, [opts, pending, router]);

  const dismissDialog = (
    <ConfirmDialog
      open={pending !== null}
      title="Remove from study list?"
      cancelLabel="Cancel"
      confirmLabel="Remove"
      confirmBusy={busy}
      onCancel={() => {
        if (!busy) setPending(null);
      }}
      onConfirm={() => void confirmDismiss()}
    >
      {pending ? (
        <>
          <strong className="font-semibold text-zinc-900 dark:text-zinc-50">
            {pending.title}
          </strong>{" "}
          will disappear from Continue studying and your progress tiles. Your
          quiz scores and checkpoints are saved
          {pending.isExploreLearner
            ? " — you can open it again from Explore."
            : " — you can open it again from your workspace."}
        </>
      ) : null}
    </ConfirmDialog>
  );

  return { requestDismiss, dismissDialog, error };
}
