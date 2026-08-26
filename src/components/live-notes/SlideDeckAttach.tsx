"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";

const ACCEPT =
  ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function SlideDeckAttach({
  sessionId,
  fileName,
  pageCount,
  onChange,
  compact = false,
  disabled = false,
}: {
  sessionId: string;
  fileName: string | null;
  pageCount: number;
  onChange: (next: { fileName: string | null; pageCount: number }) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"uploading" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ready = Boolean(fileName) && pageCount > 0;

  const pick = () => {
    if (disabled || busy) return;
    inputRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const kind = detectIngestFormat(file.name, file.type);
    if (kind !== "pdf" && kind !== "slides") {
      setError("Upload a PDF or PowerPoint (.pptx).");
      return;
    }
    if (file.name.toLowerCase().endsWith(".ppt")) {
      setError("Save as .pptx or export a PDF, then upload again.");
      return;
    }
    if (file.size > MAX_INGEST_DOCUMENT_BYTES) {
      const maxMb = Math.round(MAX_INGEST_DOCUMENT_BYTES / (1024 * 1024));
      setError(`That file is too large (max ${maxMb}MB).`);
      return;
    }

    setBusy("uploading");
    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("Sign in again, then retry the upload.");
        return;
      }
      const pathInfo = ingestStoragePathForFile(user.id, file);
      if (!pathInfo) {
        setError("Upload a PDF or PowerPoint (.pptx).");
        return;
      }
      const { error: upErr } = await supabase.storage
        .from(STUDY_PDF_INGEST_BUCKET)
        .upload(pathInfo.storagePath, file, {
          contentType: pathInfo.contentType,
          cacheControl: "3600",
          upsert: false,
        });
      if (upErr) {
        setError(
          describePdfIngestUploadFailure(
            typeof upErr.message === "string" ? upErr.message : String(upErr)
          )
        );
        return;
      }

      const res = await fetch(`/api/live-notes/${sessionId}/slides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: pathInfo.storagePath,
          fileName: file.name,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        fileName?: string;
        pageCount?: number;
      };
      if (!res.ok) {
        await supabase.storage
          .from(STUDY_PDF_INGEST_BUCKET)
          .remove([pathInfo.storagePath])
          .catch(() => {});
        setError(body.error || "Could not read those slides.");
        return;
      }
      onChange({
        fileName: body.fileName ?? file.name,
        pageCount: typeof body.pageCount === "number" ? body.pageCount : 0,
      });
    } catch {
      setError("Could not upload the slides. Check your connection and retry.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    if (disabled || busy) return;
    setBusy("removing");
    setError(null);
    try {
      const res = await fetch(`/api/live-notes/${sessionId}/slides`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Could not remove the slides.");
        return;
      }
      onChange({ fileName: null, pageCount: 0 });
    } catch {
      setError("Could not remove the slides.");
    } finally {
      setBusy(null);
    }
  };

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={pick}
          disabled={disabled || busy !== null}
          title={
            ready
              ? `${fileName} — ${pageCount} slide${pageCount === 1 ? "" : "s"}. Click to replace.`
              : "Upload lecture slides so notes can match speech to the deck"
          }
          className="max-w-[11rem] truncate rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {busy === "uploading"
            ? "Reading slides…"
            : ready
              ? `${pageCount} slide${pageCount === 1 ? "" : "s"}`
              : "Add slides"}
        </button>
        {error ? (
          <p className="max-w-[10rem] truncate text-[10px] text-rose-600 dark:text-rose-300" title={error}>
            {error}
          </p>
        ) : null}
        {ready ? (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={disabled || busy !== null}
            className="rounded-full px-1.5 py-1 text-xs text-zinc-400 hover:text-rose-600 disabled:opacity-60"
            title="Remove uploaded slides"
          >
            ×
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-100">
        Lecture slides (optional)
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
        PDF or PowerPoint. Rose drafts notes from the deck, then edits them as
        the lecturer talks — dropping wrong slide claims and adding what was
        actually said.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pick}
          disabled={disabled || busy !== null}
          className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 disabled:opacity-60 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700"
        >
          {busy === "uploading"
            ? "Uploading…"
            : ready
              ? "Replace slides"
              : "Upload slides"}
        </button>
        {ready ? (
          <>
            <span className="min-w-0 truncate text-xs text-zinc-600 dark:text-zinc-300">
              {fileName} · {pageCount} slide{pageCount === 1 ? "" : "s"} ready
            </span>
            <button
              type="button"
              onClick={() => void remove()}
              disabled={disabled || busy !== null}
              className="text-xs font-medium text-zinc-500 hover:text-rose-600 disabled:opacity-60"
            >
              {busy === "removing" ? "Removing…" : "Remove"}
            </button>
          </>
        ) : null}
      </div>
      {error ? (
        <p className="mt-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
