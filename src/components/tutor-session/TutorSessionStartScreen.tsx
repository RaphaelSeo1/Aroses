"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { TutorSessionModeTag } from "@/types/tutor-session";
import { detectIngestFormat, INGEST_ACCEPT_ATTRIBUTE } from "@/lib/study-ingest/formats";
import {
  TUTOR_SESSION_MAX_FILES,
  TUTOR_SESSION_MAX_TOTAL_BYTES,
} from "@/lib/tutor-session/extract-upload";

/**
 * Start screen for Tutor Sessions.
 *
 * Three optional inputs:
 *   - Free-text topic ("walk me through SN2 mechanisms")
 *   - Reference file uploads (PDF / images / text)
 *   - Mode-tag chip (exam_prep / homework_help / concept_review /
 *     quiz_me / exploring)
 *
 * All optional. The student can hit "Skip and just start talking"
 * to launch with no context at all.
 *
 * Submit posts a multipart form to /api/tutor-session/start. The
 * server creates the session, summarizes uploads via Claude (vision
 * for images), and returns the session id. We then route to
 * `/tutor-session/active/[id]`.
 */

type ModeChip = {
  id: TutorSessionModeTag;
  label: string;
  description: string;
  emoji: string;
};

const MODE_CHIPS: ModeChip[] = [
  {
    id: "exam_prep",
    label: "Exam prep",
    description: "Fast, focused, drill-style",
    emoji: "⚡",
  },
  {
    id: "homework_help",
    label: "Homework help",
    description: "Walk through problems step by step",
    emoji: "📝",
  },
  {
    id: "concept_review",
    label: "Concept review",
    description: "Build deep understanding",
    emoji: "🧠",
  },
  {
    id: "quiz_me",
    label: "Quiz me",
    description: "Active testing, escalating difficulty",
    emoji: "🎯",
  },
  {
    id: "exploring",
    label: "Just exploring",
    description: "Open conversation, follow my lead",
    emoji: "🌱",
  },
];

export function TutorSessionStartScreen() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [topic, setTopic] = useState("");
  const [modeTag, setModeTag] = useState<TutorSessionModeTag | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // 1-second-incrementing status messages while the server is
  // summarizing uploads + minting the session — gives a sense of
  // progress instead of an indefinite spinner.
  const [progressNote, setProgressNote] = useState<string>("");
  // Drag-and-drop overlay state. Tracks the entry/leave counter so
  // crossing nested children doesn't flicker the overlay (every
  // dragenter on a child fires bubbling — we keep a depth count).
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  const canSubmit = useMemo(() => {
    if (submitting) return false;
    // Always allow — even an empty submit is "Skip and just start talking".
    return true;
  }, [submitting]);

  // Core attach helper — used by the picker, the drop handler, and
  // the paste handler. Filters by MIME / extension so we only ever
  // try to upload files the server knows how to extract (PDFs,
  // images, plain/markdown text). Caps size + count, dedupes.
  const acceptFiles = useCallback((incoming: File[]) => {
    if (incoming.length === 0) return;
    setError(null);
    setFiles((prev) => {
      const next = [...prev];
      let rejectedUnsupported: string | null = null;
      for (const f of incoming) {
        const kind = detectIngestFormat(f.name, f.type);
        if (!kind) {
          rejectedUnsupported = f.name;
          continue;
        }
        if (kind === "audio" || kind === "video") {
          rejectedUnsupported = f.name;
          setError(
            `"${f.name}" is audio/video — use course upload for recordings. Tutor sessions accept documents and images.`
          );
          continue;
        }
        if (next.length >= TUTOR_SESSION_MAX_FILES) {
          setError(`Up to ${TUTOR_SESSION_MAX_FILES} files at a time.`);
          break;
        }
        const nextTotal =
          next.reduce((s, x) => s + x.size, 0) + f.size;
        if (nextTotal > TUTOR_SESSION_MAX_TOTAL_BYTES) {
          setError("Combined upload exceeds 200MB.");
          break;
        }
        if (
          !next.find(
            (existing) => existing.name === f.name && existing.size === f.size
          )
        ) {
          next.push(f);
        }
      }
      if (rejectedUnsupported && next.length === prev.length) {
        setError(
          `"${rejectedUnsupported}" isn't supported for tutor sessions (try PDF, Word, slides, images, or text).`
        );
      }
      return next;
    });
  }, []);

  const addFiles = useCallback(
    (picked: FileList | null) => {
      if (!picked || picked.length === 0) return;
      const arr: File[] = [];
      for (let i = 0; i < picked.length; i += 1) {
        const f = picked.item(i);
        if (f) arr.push(f);
      }
      acceptFiles(arr);
    },
    [acceptFiles]
  );

  // ----- drag-and-drop -----
  // Depth-counter pattern handles the dragenter/dragleave bubble
  // dance so the overlay doesn't flash off when crossing nested
  // children (the textarea, chip row, etc).
  const onDragEnter = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);
  const onDragLeave = useCallback(() => {
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);
  const onDragOver = useCallback((e: React.DragEvent) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    // Required so the browser allows the drop. dropEffect = "copy"
    // is what shows the green "+" cursor on macOS / Win.
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragOver(false);
      const dropped = Array.from(e.dataTransfer?.files ?? []);
      if (dropped.length > 0) acceptFiles(dropped);
    },
    [acceptFiles]
  );

  // ----- paste from clipboard -----
  // Capture clipboard images (cmd+shift+4 screenshot → cmd+v).
  // Pasted entries arrive without a filename, so we synthesize one
  // like "screenshot-2026-05-18-11-14-23.png" to keep the UI
  // recognizable and the server happy.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const picked: File[] = [];
      for (let i = 0; i < items.length; i += 1) {
        const item = items[i];
        if (item.kind !== "file") continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        // Re-wrap to give it a stable, descriptive name when the
        // clipboard provided "image.png" (which is what most OSes
        // do for screenshots).
        const isAnonScreenshot =
          /^image\.(png|jpe?g|gif|webp)$/i.test(blob.name) || !blob.name;
        if (isAnonScreenshot && blob.type.startsWith("image/")) {
          const ext = blob.type.split("/")[1] || "png";
          const ts = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19);
          picked.push(
            new File([blob], `screenshot-${ts}.${ext}`, { type: blob.type })
          );
        } else {
          picked.push(blob);
        }
      }
      if (picked.length > 0) {
        // Don't preventDefault for pasted TEXT (so cmd+v in the
        // textarea still drops the typed topic in). Only swallow the
        // event if we actually consumed file entries.
        e.preventDefault();
        acceptFiles(picked);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [acceptFiles]);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const submit = useCallback(
    async (opts?: { skip?: boolean }) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      const noteCycle = [
        files.length > 0 ? "Reading your materials…" : "Spinning up your session…",
        files.length > 0 ? "Asking Rose to skim your uploads…" : "Almost ready…",
        "Putting the room together…",
      ];
      setProgressNote(noteCycle[0]);
      let i = 0;
      const interval = window.setInterval(() => {
        i = (i + 1) % noteCycle.length;
        setProgressNote(noteCycle[i]);
      }, 2200);
      try {
        const form = new FormData();
        if (!opts?.skip) {
          if (topic.trim()) form.set("topic", topic.trim());
          if (modeTag) form.set("modeTag", modeTag);
          for (const f of files) form.append("files", f);
        }
        const res = await fetch("/api/tutor-session/start", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          const body = (await res
            .json()
            .catch(() => ({ error: "Couldn't start session." }))) as {
            error?: string;
          };
          throw new Error(body.error ?? `Start failed (${res.status})`);
        }
        const body = (await res.json()) as { session: { id: string } };
        router.push(`/tutor-session/active/${body.session.id}`);
      } catch (e) {
        console.error("[TutorSessionStartScreen submit]", e);
        setError(e instanceof Error ? e.message : "Something went wrong.");
        setSubmitting(false);
      } finally {
        window.clearInterval(interval);
      }
    },
    [files, modeTag, router, submitting, topic]
  );

  return (
    <div
      className={`relative overflow-hidden rounded-3xl border bg-white/85 p-8 shadow-xl shadow-zinc-900/[0.06] ring-1 backdrop-blur-md transition-colors dark:bg-zinc-950/80 sm:p-12 ${
        dragOver
          ? "border-violet-400 ring-violet-200/80 dark:border-violet-600"
          : "border-white/60 ring-white/50 dark:border-zinc-800"
      }`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Decorative gradient blobs */}
      <div
        className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-violet-200/40 via-fuchsia-200/30 to-transparent blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-gradient-to-tr from-sky-200/40 via-violet-200/30 to-transparent blur-3xl"
        aria-hidden
      />

      {/* Drop overlay — sits above everything but the gradient blobs.
          `pointer-events-none` so it doesn't swallow the drop event
          itself (the parent's onDrop is the one that fires). */}
      {dragOver ? (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl bg-violet-50/80 backdrop-blur-sm dark:bg-violet-950/40"
          aria-hidden
        >
          <div className="rounded-2xl border-2 border-dashed border-violet-400 bg-white/95 px-8 py-6 text-center shadow-lg dark:bg-zinc-900/95">
            <p className="text-2xl" aria-hidden>
              📎
            </p>
            <p className="mt-1 text-sm font-semibold text-violet-900 dark:text-violet-200">
              Drop your file here
            </p>
            <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-300">
              PDFs, screenshots, photos, notes
            </p>
          </div>
        </div>
      ) : null}

      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700 dark:text-violet-300">
          Tutor Session
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
          What do you want to work on?
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Tell Rose a topic, paste a problem, drop in your notes, or just start
          talking. All optional.
        </p>

        {/* Text input */}
        <div className="mt-7">
          <label htmlFor="tutor-topic" className="sr-only">
            What do you want to work on?
          </label>
          <textarea
            id="tutor-topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value.slice(0, 2000))}
            rows={4}
            placeholder="e.g. SN2 vs SN1 mechanisms for tomorrow's o-chem exam"
            className="w-full resize-none rounded-2xl border border-zinc-200/90 bg-white/95 px-4 py-3 text-[15px] leading-relaxed text-zinc-900 shadow-inner outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200 dark:border-zinc-800 dark:bg-zinc-900/80 dark:text-zinc-100"
            disabled={submitting}
          />
        </div>

        {/* Upload */}
        <div className="mt-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={INGEST_ACCEPT_ATTRIBUTE}
            multiple
            className="sr-only"
            onChange={(e) => addFiles(e.target.files)}
            disabled={submitting}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <span aria-hidden>📎</span>
              Attach reference material
            </button>
            <span className="text-[11px] text-zinc-500 dark:text-zinc-500">
              PDFs, photos, notes — or just drag &amp; drop / paste a screenshot.
              Purely context, never turned into a course.
            </span>
          </div>
          {files.length > 0 ? (
            <ul className="mt-3 flex flex-wrap gap-2">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  <span className="font-medium">{f.name}</span>
                  <span className="text-zinc-400">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    aria-label={`Remove ${f.name}`}
                    className="text-zinc-400 hover:text-rose-600"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Mode tag chips */}
        <div className="mt-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            How should Rose tutor you?
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {MODE_CHIPS.map((m) => {
              const active = modeTag === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModeTag(active ? null : m.id)}
                  disabled={submitting}
                  title={m.description}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition disabled:opacity-50 ${
                    active
                      ? "border-violet-400 bg-violet-100 text-violet-900 ring-1 ring-violet-200 dark:border-violet-600 dark:bg-violet-900/40 dark:text-violet-100"
                      : "border-zinc-200 bg-white/80 text-zinc-700 hover:border-violet-300 hover:bg-violet-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  }`}
                >
                  <span aria-hidden>{m.emoji}</span>
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        {/* Submit */}
        <div className="mt-7 flex flex-col items-center gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => submit({ skip: true })}
            disabled={submitting}
            className="text-sm font-medium text-zinc-500 underline-offset-4 hover:text-violet-700 hover:underline disabled:opacity-50 dark:text-zinc-500 dark:hover:text-violet-300"
          >
            Skip and just start talking →
          </button>
          <button
            type="button"
            onClick={() => submit()}
            disabled={!canSubmit}
            className="inline-flex items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-600/25 transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <svg
                  className="mr-2 h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
                </svg>
                {progressNote || "Starting…"}
              </>
            ) : (
              "Start session"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
