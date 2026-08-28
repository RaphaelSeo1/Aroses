"use client";

import { useRef, useState } from "react";

export function TranscriptReviewPanel({
  jobId,
  initialTranscript,
  onConfirmed,
}: {
  jobId: string;
  initialTranscript: string;
  onConfirmed?: () => void;
}) {
  const [text, setText] = useState(initialTranscript);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalRef = useRef(initialTranscript);

  async function confirm() {
    if (text.trim().length < 80) {
      setError("Transcript is too short — add more text or upload written materials.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const edited = text !== originalRef.current;
      const res = await fetch(
        `/api/process-pdf/jobs/${jobId}/confirm-transcript`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(edited ? { transcript: text } : {}),
        }
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not continue build.");
        return;
      }
      onConfirmed?.();
    } catch {
      setError("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-brand-border/60 bg-brand-blush/30 p-5 dark:border-brand-border/40 dark:bg-brand-blush/10">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Review transcript
      </h3>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Fix mistakes in the notes, transcript, or slides we will use to
        build your course. Names, jargon, and formulas are worth
        double-checking.
      </p>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
        rows={14}
        className="mt-3 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 font-mono text-xs leading-relaxed text-zinc-900 outline-none ring-brand focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
      />
      {error ? (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void confirm()}
        className="mt-4 inline-flex rounded-full bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60 dark:bg-brand dark:hover:bg-brand-soft"
      >
        {busy ? "Continuing…" : "Looks good — build my course"}
      </button>
    </div>
  );
}
