"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createClient } from "@/lib/supabase/client";
import { ingestStoragePathForFile } from "@/lib/study-ingest/client-upload";
import { detectIngestFormat, MAX_INGEST_DOCUMENT_BYTES } from "@/lib/study-ingest/formats";
import { STUDY_PDF_INGEST_BUCKET } from "@/lib/study-pdf-ingest";
import { describePdfIngestUploadFailure } from "@/lib/storage-upload-errors";

const ACCEPT =
  ".pdf,.pptx,.key,.odp,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"uploading" | "removing" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  const ready = Boolean(fileName) && pageCount > 0;

  const openModal = () => {
    if (disabled || busy) return;
    setError(null);
    setOpen(true);
  };

  const closeModal = () => {
    if (busy === "uploading") return;
    setOpen(false);
    setDragOver(false);
    dragDepth.current = 0;
  };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && busy !== "uploading") {
        setOpen(false);
        setDragOver(false);
        dragDepth.current = 0;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, busy]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const kind = detectIngestFormat(file.name, file.type);
    if (kind !== "pdf" && kind !== "slides") {
      setError(
        "Use a PDF or PowerPoint (.pptx). Export Google Slides or Keynote as PDF first."
      );
      return;
    }
    if (file.name.toLowerCase().endsWith(".ppt")) {
      setError("Save as .pptx or export a PDF, then drop it here.");
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
        setError(
          "Use a PDF or PowerPoint (.pptx). Export Google Slides or Keynote as PDF first."
        );
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
      setOpen(false);
      setDragOver(false);
      dragDepth.current = 0;
    } catch {
      setError("Could not upload the slides. Check your connection and retry.");
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const takeDroppedFiles = (list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    if (files.length > 1) {
      setError("Drop one deck at a time (PDF or .pptx).");
      return;
    }
    void onFile(files[0]);
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

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={ACCEPT}
      className="sr-only"
      onChange={(e) => void onFile(e.target.files?.[0])}
    />
  );

  const modal =
    open && mounted
      ? createPortal(
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-zinc-950/55 p-4 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeModal();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="slide-upload-title"
          className="max-h-[min(90dvh,40rem)] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-950"
        >
          <div className="border-b border-rose-100 bg-gradient-to-br from-rose-50 to-white px-6 py-5 dark:border-rose-950/40 dark:from-rose-950/40 dark:to-zinc-950">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-600 dark:text-rose-400">
              Aroses · Live notes
            </p>
            <h2
              id="slide-upload-title"
              className="mt-1.5 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              {ready ? "Replace lecture slides" : "Add lecture slides"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Drop a PDF or PowerPoint here. Google Slides and Keynote work if
              you export them as PDF first. Rose drafts notes from the deck,
              then edits them as the lecture is spoken.
            </p>
          </div>

          <div className="px-6 py-5">
            <button
              type="button"
              disabled={disabled || busy !== null}
              onClick={() => inputRef.current?.click()}
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepth.current += 1;
                setDragOver(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragOver(false);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = "copy";
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dragDepth.current = 0;
                setDragOver(false);
                takeDroppedFiles(e.dataTransfer.files);
              }}
              className={`flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-all disabled:opacity-60 ${
                dragOver
                  ? "scale-[1.01] border-rose-400 bg-rose-50 shadow-lg shadow-rose-500/10 dark:border-rose-500 dark:bg-rose-950/40"
                  : "border-zinc-200 bg-zinc-50/80 hover:border-rose-300 hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/50 dark:hover:border-rose-800 dark:hover:bg-zinc-900"
              }`}
            >
              <span className="pointer-events-none text-sm font-semibold text-zinc-800 dark:text-zinc-100">
                {busy === "uploading"
                  ? "Reading slides…"
                  : dragOver
                    ? "Drop to upload"
                    : "Drag & drop your slides here"}
              </span>
              <span className="pointer-events-none mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                PDF or .pptx · up to{" "}
                {Math.round(MAX_INGEST_DOCUMENT_BYTES / (1024 * 1024))}MB
              </span>
              <span className="pointer-events-none mt-4 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-zinc-800 ring-1 ring-zinc-200 dark:bg-zinc-950 dark:text-zinc-100 dark:ring-zinc-700">
                {busy === "uploading" ? "Uploading…" : "Choose a file"}
              </span>
            </button>
            {error ? (
              <p className="mt-3 text-[13px] leading-relaxed text-rose-700 dark:text-rose-300">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-zinc-100 px-6 py-4 dark:border-zinc-800">
            <button
              type="button"
              onClick={closeModal}
              disabled={busy === "uploading"}
              className="rounded-full px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {busy === "uploading" ? "Uploading…" : "Cancel"}
            </button>
          </div>
        </div>
      </div>,
          document.body
        )
    : null;

  if (compact) {
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        {fileInput}
        <button
          type="button"
          onClick={openModal}
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
        {error && !open ? (
          <p
            className="max-w-[10rem] truncate text-[10px] text-rose-600 dark:text-rose-300"
            title={error}
          >
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
        {modal}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 px-4 py-3 dark:border-zinc-700 dark:bg-zinc-900/50">
      {fileInput}
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
          onClick={openModal}
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
      {error && !open ? (
        <p className="mt-2 text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {modal}
    </div>
  );
}
