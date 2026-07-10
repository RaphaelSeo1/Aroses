"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * Home "Record a lecture" card — creates a standalone note and starts
 * Live Notes capture (same path as Notes hub → Record lecture).
 */
export function HomeRecordLectureCard() {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const createRes = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Live lecture" }),
      });
      const createData = (await createRes.json().catch(() => ({}))) as {
        noteId?: string;
        error?: string;
      };
      if (!createRes.ok || !createData.noteId) {
        setError(createData.error || "Could not create a note.");
        setBusy(false);
        return;
      }

      const recordRes = await fetch(
        `/api/notes/${createData.noteId}/record`,
        { method: "POST" }
      );
      const recordData = (await recordRes.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!recordRes.ok || !recordData.redirect) {
        setError(recordData.error || "Could not start recording.");
        setBusy(false);
        router.push(`/notes/doc/${createData.noteId}`);
        return;
      }
      router.push(recordData.redirect);
    } catch {
      setError("Could not start recording. Check your connection.");
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy}
      className="group relative flex h-full w-full flex-col justify-between overflow-hidden rounded-2xl border border-zinc-200/90 bg-gradient-to-br from-rose-50/50 via-white to-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-md disabled:opacity-70 dark:border-zinc-800 dark:from-rose-950/20 dark:via-zinc-950 dark:to-zinc-950 dark:hover:border-rose-800"
    >
      <div className="relative">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-rose-100 text-rose-700 ring-1 ring-rose-200/70 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900/50">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" x2="12" y1="19" y2="22" />
          </svg>
        </span>
        <h3 className="mt-3 text-base font-semibold text-zinc-900 dark:text-zinc-50">
          {t.dashboard.recordLectureTitle}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {t.dashboard.recordLectureDesc}
        </p>
        {error ? (
          <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
        ) : null}
      </div>
      <div className="relative mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-rose-700 transition group-hover:gap-2 dark:text-rose-300">
        {busy ? t.dashboard.recordLectureStarting : t.dashboard.recordLectureCta}
        {!busy ? <span aria-hidden>→</span> : null}
      </div>
    </button>
  );
}
