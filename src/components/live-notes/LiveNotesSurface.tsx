"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  NotesPanel,
  type AutoGenerateBlock,
  type NotesPanelHandle,
} from "@/components/immersive/NotesPanel";
import {
  detectCapturePlatform,
  type CapturePlatform,
} from "@/lib/live-notes/capture";
import {
  useLiveLectureTranscription,
  type LiveCaptureSource,
  type LiveTranscriptSegment,
} from "@/lib/live-notes/use-live-transcription";

/**
 * Live Notes — full-page live lecture capture surface.
 *
 * Header: record/pause/finish controls, elapsed time, "AI is listening".
 * Body: the reused TipTap NotesPanel (AI blocks append without stealing the
 * cursor) + a collapsible live transcript rail.
 *
 * On Finish the transcript is handed to the existing transcript-review →
 * course pipeline and the student lands on the standard build page.
 */

/** Synthesis trigger thresholds (see plan §3). */
const SYNTH_TARGET_CHARS = 2_800;
const SYNTH_MIN_CHARS = 800;
const SYNTH_FALLBACK_MS = 5 * 60 * 1000;
const SYNTH_CHECK_INTERVAL_MS = 30 * 1000;

export type LiveNotesInitialSession = {
  id: string;
  courseId: string;
  title: string;
  status: "recording" | "paused" | "completed" | "failed";
  durationSeconds: number;
  ingestJobId: string | null;
  lastSegmentSeq: number;
};

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatAtMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function LiveNotesSurface({
  session,
  courseTitle,
  initialSegments,
}: {
  session: LiveNotesInitialSession;
  courseTitle: string;
  initialSegments: LiveTranscriptSegment[];
}) {
  const router = useRouter();
  const sessionId = session.id;

  const [segments, setSegments] = useState<LiveTranscriptSegment[]>(
    initialSegments
  );
  const [error, setError] = useState<string | null>(null);
  const [voiceCapped, setVoiceCapped] = useState(false);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [started, setStarted] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  // Detected after mount so the server-rendered HTML never depends on the
  // client platform (hydration-safe). Null = still detecting.
  const [platform, setPlatform] = useState<CapturePlatform | null>(null);
  useEffect(() => {
    setPlatform(detectCapturePlatform());
  }, []);

  const notesRef = useRef<NotesPanelHandle | null>(null);
  const railScrollRef = useRef<HTMLDivElement | null>(null);

  const autoGenerateRef = useRef(autoGenerate);
  autoGenerateRef.current = autoGenerate;

  // ── Synthesis buffering ────────────────────────────────────────────────
  const unsynthesizedRef = useRef("");
  const recentHeadingsRef = useRef<string[]>([]);
  const synthInFlightRef = useRef(false);
  const lastSynthAtRef = useRef(Date.now());
  const blockCountRef = useRef(0);

  const maybeSynthesize = useCallback(
    async (force: boolean) => {
      if (!autoGenerateRef.current) return;
      if (synthInFlightRef.current) return;
      const pending = unsynthesizedRef.current.trim();
      const threshold = force ? SYNTH_MIN_CHARS : SYNTH_TARGET_CHARS;
      if (pending.length < threshold) return;

      synthInFlightRef.current = true;
      unsynthesizedRef.current = "";
      lastSynthAtRef.current = Date.now();
      setAiWriting(true);
      try {
        const res = await fetch(`/api/live-notes/${sessionId}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newSegmentText: pending,
            recentHeadings: recentHeadingsRef.current.slice(-5),
          }),
        });
        if (!res.ok) {
          // Put the slice back — the next natural break retries with it.
          unsynthesizedRef.current =
            `${pending} ${unsynthesizedRef.current}`.trim();
          return;
        }
        const data = (await res.json()) as {
          block?: AutoGenerateBlock | null;
          capped?: boolean;
        };
        if (data.block) {
          const chunkId = `live-${sessionId}-${blockCountRef.current}`;
          const appended = notesRef.current?.appendBlock({
            ...data.block,
            chunkId,
            dividerBefore: blockCountRef.current > 0,
            preserveSelection: true,
            selfCheck: undefined,
          });
          if (appended) {
            blockCountRef.current += 1;
            if (data.block.heading) {
              recentHeadingsRef.current = [
                ...recentHeadingsRef.current,
                data.block.heading,
              ].slice(-5);
            }
          }
        }
      } catch {
        unsynthesizedRef.current =
          `${pending} ${unsynthesizedRef.current}`.trim();
      } finally {
        synthInFlightRef.current = false;
        setAiWriting(false);
      }
    },
    [sessionId]
  );

  // Fallback timer: if the lecturer never pauses long enough for a natural
  // break, still synthesize every few minutes.
  useEffect(() => {
    const t = window.setInterval(() => {
      if (Date.now() - lastSynthAtRef.current >= SYNTH_FALLBACK_MS) {
        void maybeSynthesize(true);
      }
    }, SYNTH_CHECK_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [maybeSynthesize]);

  // ── Capture hook ────────────────────────────────────────────────────────
  const {
    status,
    partialText,
    elapsedMs,
    activeSource,
    start,
    pause,
    resume,
    stop,
    switchSource,
    flushNow,
  } = useLiveLectureTranscription({
    sessionId,
    initialNextSeq: session.lastSegmentSeq + 1,
    initialElapsedMs: session.durationSeconds * 1000,
    onSegment: (segment) => {
      setSegments((prev) => [...prev, segment]);
      unsynthesizedRef.current =
        `${unsynthesizedRef.current} ${segment.text}`.trim();
    },
    onNaturalBreak: () => {
      void maybeSynthesize(false);
    },
    onCapped: () => {
      setVoiceCapped(true);
    },
    onError: (message) => {
      setError(message);
    },
  });

  // Keep the transcript rail pinned to the newest line.
  useEffect(() => {
    const el = railScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [segments, partialText]);

  // Warn before closing the tab mid-recording (transcript is flushed every
  // ~15s, so at most a few seconds of speech are at risk — still worth a nudge).
  useEffect(() => {
    if (status !== "recording" && status !== "reconnecting") return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [status]);

  const handleStart = useCallback(
    async (source: LiveCaptureSource) => {
      setError(null);
      const ok = await start(source);
      if (ok) setStarted(true);
    },
    [start]
  );

  const [switching, setSwitching] = useState(false);
  const handleSwitchSource = useCallback(
    async (source: LiveCaptureSource) => {
      if (switching) return;
      setSwitching(true);
      setError(null);
      try {
        await switchSource(source);
      } finally {
        setSwitching(false);
      }
    },
    [switching, switchSource]
  );

  const sourceOptions: Array<{ id: LiveCaptureSource; label: string }> = [
    { id: "tab", label: "Tab" },
    ...(platform?.systemAudioSupported
      ? [{ id: "system" as const, label: "System" }]
      : []),
    { id: "mic", label: "Mic" },
  ];

  const handleFinish = useCallback(async () => {
    if (finishing) return;
    setConfirmFinish(false);
    setFinishing(true);
    setError(null);
    try {
      // Final synthesis pass on whatever teaching is still buffered, so the
      // notes doc covers the lecture tail too. Best-effort.
      await maybeSynthesize(true);
      await stop();
      await flushNow();
      const res = await fetch(`/api/live-notes/${sessionId}/complete`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!res.ok || !data.redirect) {
        setError(
          data.error || "Could not start the course build. Your notes and transcript are saved — try again."
        );
        setFinishing(false);
        return;
      }
      router.push(data.redirect);
    } catch {
      setError("Could not finish the session. Check your connection and try again.");
      setFinishing(false);
    }
  }, [finishing, maybeSynthesize, stop, flushNow, sessionId, router]);

  const alreadyCompleted = session.status === "completed" && session.ingestJobId;
  const isLive = status === "recording" || status === "reconnecting";
  const showStartOverlay =
    !alreadyCompleted &&
    !started &&
    (status === "idle" || status === "connecting") &&
    !finishing;

  return (
    <div className="flex h-dvh flex-col bg-app-gradient">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-200 bg-white/85 px-4 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85 sm:px-6">
        <Link
          href={`/dashboard/courses/${session.courseId}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← {courseTitle || "Course"}
        </Link>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-50">
            {session.title}
          </p>
          <p className="text-[11px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
            Live notes
          </p>
        </div>

        {/* Status pill */}
        <div className="flex items-center gap-2">
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
              </span>
              {status === "reconnecting"
                ? "Reconnecting…"
                : aiWriting
                  ? "AI is writing…"
                  : autoGenerate
                    ? "AI is listening"
                    : "Recording"}
            </span>
          ) : status === "paused" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
              ⏸ Paused
            </span>
          ) : null}
          <span className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold tabular-nums text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {formatElapsed(elapsedMs)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2">
          {(isLive || status === "paused" || (status === "error" && started)) &&
          !finishing ? (
            <div
              className="inline-flex items-center overflow-hidden rounded-full border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
              role="group"
              aria-label="Audio source"
            >
              {sourceOptions.map((opt) => {
                const active = activeSource === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => void handleSwitchSource(opt.id)}
                    disabled={switching || active}
                    aria-pressed={active}
                    title={
                      opt.id === "tab"
                        ? "Capture tab audio (lecture in another tab)"
                        : opt.id === "system"
                          ? "Capture system audio (lecture outside the browser)"
                          : "Capture the room through your microphone"
                    }
                    className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                      active
                        ? "bg-rose-600 text-white"
                        : "text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {switching && !active ? "…" : opt.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {isLive ? (
            <button
              type="button"
              onClick={() => void pause()}
              className="rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              Pause
            </button>
          ) : (status === "paused" || status === "error") && started ? (
            <button
              type="button"
              onClick={() => void resume()}
              className="rounded-full bg-rose-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
            >
              Resume
            </button>
          ) : null}

          {started || alreadyCompleted || segments.length > 0 ? (
            confirmFinish ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={finishing}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {finishing ? "Building…" : "Confirm — build course"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmFinish(false)}
                  disabled={finishing}
                  className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() =>
                  alreadyCompleted
                    ? router.push(
                        `/dashboard/courses/${session.courseId}/study/build?pdfJobs=${session.ingestJobId}`
                      )
                    : setConfirmFinish(true)
                }
                disabled={finishing}
                className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {alreadyCompleted
                  ? "View course build"
                  : finishing
                    ? "Building…"
                    : "Finish & build course"}
              </button>
            )
          ) : null}

          <button
            type="button"
            onClick={() => setRailOpen((v) => !v)}
            className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-pressed={railOpen}
          >
            {railOpen ? "Hide transcript" : "Show transcript"}
          </button>
        </div>
      </header>

      {/* ── Error / cap banners ────────────────────────────────────────── */}
      {voiceCapped ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 sm:px-6">
          You&apos;ve reached this month&apos;s voice limit, so live transcription is
          unavailable. Your notes and transcript so far are saved — you can
          still finish and build the course.
        </p>
      ) : error ? (
        <p className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100 sm:px-6">
          {error}
        </p>
      ) : null}

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1">
        <main className="min-w-0 flex-1">
          <NotesPanel
            notesEndpoint={`/api/live-notes/${sessionId}/notes`}
            lessonTitle={session.title}
            courseTitle={courseTitle}
            suggestions={[]}
            onConsumeSuggestion={() => {}}
            autoGenerate={autoGenerate}
            onAutoGenerateChange={setAutoGenerate}
            editorRef={notesRef}
            fillHeight
            pinToolbar
            className="h-full"
          />
        </main>

        {railOpen ? (
          <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-950/70 sm:w-80">
            <p className="border-b border-zinc-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Live transcript
            </p>
            <div
              ref={railScrollRef}
              className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
            >
              {segments.length === 0 && !partialText ? (
                <p className="text-xs leading-relaxed text-zinc-400 dark:text-zinc-500">
                  {isLive
                    ? "Listening… the transcript appears here as the lecturer speaks."
                    : "Nothing captured yet."}
                </p>
              ) : null}
              {segments.map((s) => (
                <div key={s.seq}>
                  <span className="mr-1.5 text-[10px] font-semibold tabular-nums text-zinc-400 dark:text-zinc-500">
                    {formatAtMs(s.atMs)}
                  </span>
                  <span className="text-xs leading-relaxed text-zinc-700 dark:text-zinc-300">
                    {s.text}
                  </span>
                </div>
              ))}
              {partialText ? (
                <p className="text-xs italic leading-relaxed text-zinc-400 dark:text-zinc-500">
                  {partialText}…
                </p>
              ) : null}
            </div>
          </aside>
        ) : null}

        {/* ── Start overlay ─────────────────────────────────────────────── */}
        {showStartOverlay ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/70 p-6 backdrop-blur-sm dark:bg-zinc-950/70">
            <div className="w-full max-w-md rounded-3xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-950">
              <p className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                ● Live notes
              </p>
              <h1 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                {session.title}
              </h1>
              <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
                Rose listens to the lecture, builds running notes in real time,
                and turns everything into a full course when you finish. Pick an
                audio source to start.
              </p>
              <div className="mt-5 grid gap-2">
                <button
                  type="button"
                  onClick={() => void handleStart("tab")}
                  disabled={status === "connecting"}
                  className="rounded-2xl bg-rose-600 px-4 py-3 text-left text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  Capture tab audio
                  <span className="mt-0.5 block text-xs font-normal text-rose-100">
                    YouTube, Zoom or Meet in the browser — pick the lecture tab
                    under &quot;Chrome Tab&quot; and tick &quot;Also share tab
                    audio&quot;.
                  </span>
                </button>
                {platform?.systemAudioSupported ? (
                  <button
                    type="button"
                    onClick={() => void handleStart("system")}
                    disabled={status === "connecting"}
                    className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                  >
                    Capture system audio
                    <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                      Lecture playing outside the browser (e.g. the Zoom app) —
                      choose &quot;Entire screen&quot; and turn on &quot;Also
                      share system audio&quot;.
                    </span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleStart("mic")}
                  disabled={status === "connecting"}
                  className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left text-sm font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                >
                  Use the microphone
                  <span className="mt-0.5 block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                    In-person lecture — capture the room through your mic.
                  </span>
                </button>
              </div>
              {platform && !platform.captureAudioSupported ? (
                <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100">
                  This browser can&apos;t capture tab or screen audio. Open
                  Rose in <strong>Google Chrome</strong> (or Edge) to record a
                  screen lecture — the microphone still works here.
                </p>
              ) : platform?.isMac ? (
                <p className="mt-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  On a Mac, &quot;Entire screen&quot; and &quot;Window&quot;
                  sharing never include audio — share the <strong>tab</strong>{" "}
                  itself and tick &quot;Also share tab audio&quot;. For a Zoom
                  lecture, join from your browser instead of the Zoom app
                  (zoom.us → &quot;Join from your browser&quot;).
                </p>
              ) : null}
              {status === "connecting" ? (
                <p className="mt-3 text-center text-xs text-zinc-400">
                  Connecting to live transcription…
                </p>
              ) : null}
              {segments.length > 0 ? (
                <p className="mt-3 text-center text-xs text-zinc-400">
                  This session already has {segments.length} transcript
                  segment{segments.length === 1 ? "" : "s"} — resuming continues
                  where it left off.
                </p>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
