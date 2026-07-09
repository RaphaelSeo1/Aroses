"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmDialog } from "@/components/AppDialogs";
import {
  NotesPanel,
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
import {
  LiveNotesAiActivity,
  type AiActivityEntry,
} from "@/components/live-notes/LiveNotesAiActivity";

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

/**
 * Synthesis cadence. A 5s heartbeat plus every committed segment attempt a
 * synthesis; the char thresholds below decide whether one actually fires:
 *   - first section quickly (~180 chars ≈ 15s of speech — proof of life),
 *   - then whenever ~450 new chars (~30s of speech) have accumulated.
 * The API gate (`synthInFlight`) opens as soon as the model stream ends;
 * typing continues on a chained pump so the next slice can synthesize while
 * the previous section is still animating into the editor.
 */
const SYNTH_TARGET_CHARS = 450;
const SYNTH_FIRST_SECTION_CHARS = 180;
const SYNTH_MIN_CHARS = 180;
const SYNTH_CHECK_INTERVAL_MS = 5 * 1000;

/**
 * Visible typing pace for AI notes. Speeds up automatically when the pump
 * falls behind the model so notes never feel stuck.
 */
const TYPE_CPS = 90;
const TYPE_CPS_CATCHUP = 200;
const TYPE_TICK_MS = 30;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ordered work items the typing pump consumes. */
type PumpItem =
  | { kind: "append"; sectionId: string; dividerBefore: boolean }
  | { kind: "revise"; sectionId: string }
  | { kind: "text"; text: string };

export type LiveNotesInitialSession = {
  id: string;
  courseId?: string | null;
  userNoteId?: string | null;
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

function transcriptSaveLabel(
  status: "idle" | "saving" | "saved" | "error",
  lastSavedAt: number | null,
  pendingCount: number,
  segmentCount: number
): string {
  if (status === "saving") return "Saving transcript…";
  if (status === "error") {
    return pendingCount > 0
      ? `Save failed — ${pendingCount} segment${pendingCount === 1 ? "" : "s"} pending`
      : "Transcript save failed — still retrying";
  }
  if (segmentCount === 0) return "Transcript autosaves as you record";
  if (lastSavedAt) {
    const sec = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));
    if (sec < 8) return "Transcript saved";
    if (sec < 60) return `Transcript saved ${sec}s ago`;
    return `Transcript saved ${Math.floor(sec / 60)}m ago`;
  }
  return pendingCount > 0 ? "Saving transcript…" : "Transcript saved";
}

export function LiveNotesSurface({
  session,
  courseTitle,
  initialSegments,
  variant = "course",
}: {
  session: LiveNotesInitialSession;
  courseTitle: string;
  initialSegments: LiveTranscriptSegment[];
  /** Standalone notes from /notes/doc — save back to the note, no course build. */
  variant?: "course" | "standalone";
}) {
  const router = useRouter();
  const sessionId = session.id;
  const isStandalone = variant === "standalone" || Boolean(session.userNoteId);
  const noteDocHref = session.userNoteId
    ? `/notes/doc/${session.userNoteId}`
    : "/notes";

  const [segments, setSegments] = useState<LiveTranscriptSegment[]>(
    initialSegments
  );
  const [error, setError] = useState<string | null>(null);
  const [voiceCapped, setVoiceCapped] = useState(false);
  const [autoGenerate, setAutoGenerate] = useState(true);
  const [railOpen, setRailOpen] = useState(true);
  const [finishing, setFinishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [started, setStarted] = useState(false);
  const [aiWriting, setAiWriting] = useState(false);
  const [aiLogOpen, setAiLogOpen] = useState(true);
  const [aiActivity, setAiActivity] = useState<AiActivityEntry[]>([]);
  const aiActivitySeqRef = useRef(0);
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
  const synthInFlightRef = useRef(false);
  const blockCountRef = useRef(0);
  /**
   * Ring buffer: transcript excerpt each AI section was written from —
   * the ground truth the model checks its own notes against when deciding
   * self-revisions. Bounded to the revision window (+ slack).
   */
  const sectionExcerptsRef = useRef<Map<string, string>>(new Map());
  /** Serializes typing pumps so writer ops never overlap. */
  const pumpTailRef = useRef(Promise.resolve());
  const pumpJobsRef = useRef(0);

  const syncAiWritingUi = useCallback(() => {
    const busy = synthInFlightRef.current || pumpJobsRef.current > 0;
    setAiWriting(busy);
    notesRef.current?.setStreamingIndicator(busy);
  }, []);

  const pushAiActivity = useCallback(
    (kind: AiActivityEntry["kind"], message: string) => {
      aiActivitySeqRef.current += 1;
      setAiActivity((prev) =>
        [
          ...prev,
          {
            id: `ai-${aiActivitySeqRef.current}`,
            at: Date.now(),
            kind,
            message,
          },
        ].slice(-40)
      );
    },
    []
  );

  const maybeSynthesize = useCallback(
    async (force: boolean) => {
      if (!autoGenerateRef.current) return;
      if (synthInFlightRef.current) return;
      const pending = unsynthesizedRef.current.trim();
      // The first section should appear fast (proof the AI is listening);
      // after that, batch to keep call counts and costs sane.
      const threshold = force
        ? SYNTH_MIN_CHARS
        : blockCountRef.current === 0
          ? SYNTH_FIRST_SECTION_CHARS
          : SYNTH_TARGET_CHARS;
      if (pending.length < threshold) return;

      const writer = notesRef.current?.getStreamWriter();
      if (!writer) return;

      synthInFlightRef.current = true;
      unsynthesizedRef.current = "";
      setAiWriting(true);
      setAiLogOpen(true);
      pushAiActivity(
        "status",
        "Reading the latest slice of the lecture…"
      );
      notesRef.current?.setStreamingIndicator(true);
      syncAiWritingUi();

      // Bounded self-revision context: recent fully-AI sections plus the raw
      // transcript excerpts underlying them. The NEWEST section is excluded —
      // models love to "update" the section they just wrote by rewriting it
      // wholesale, which reads as churn; new material must append instead. A
      // section becomes correctable one call later. Student-edited sections
      // are excluded by the writer (and re-checked on receipt).
      const excerpts = sectionExcerptsRef.current;
      const allSections = writer.listRevisableSections(5);
      const revisable = allSections.slice(0, -1).slice(-4).map((s) => ({
        sectionId: s.sectionId,
        markdown: s.markdown,
        transcriptExcerpt: excerpts.get(s.sectionId),
      }));
      const recentHeadings = allSections
        .map((s) => s.markdown.match(/^##\s+(.+)$/m)?.[1]?.trim())
        .filter((h): h is string => Boolean(h))
        .slice(-5);

      let appendSectionId: string | null = null;
      let gotContent = false;

      // ── Typing pump ─────────────────────────────────────────────────────
      // SSE events land in `queue`; a chained pump drains them into the
      // editor. Synthesis can start the next API call while a prior pump
      // is still typing — only the pump itself is serialized on the writer.
      const queue: PumpItem[] = [];
      let queueClosed = false;
      const pendingPumpChars = () =>
        queue.reduce(
          (n, item) => (item.kind === "text" ? n + item.text.length : n),
          0
        );
      const charsPerTick = () => {
        const backlog = pendingPumpChars();
        const cps =
          backlog > 900 ? TYPE_CPS_CATCHUP : backlog > 400 ? 140 : TYPE_CPS;
        return Math.max(1, Math.round((cps * TYPE_TICK_MS) / 1000));
      };
      const runPump = async () => {
        let opValid = false;
        while (true) {
          const item = queue.shift();
          if (!item) {
            if (queueClosed) break;
            await sleep(TYPE_TICK_MS);
            continue;
          }
          if (item.kind === "append") {
            writer.finishOp();
            writer.beginAppend({
              sectionId: item.sectionId,
              dividerBefore: item.dividerBefore,
            });
            appendSectionId = item.sectionId;
            opValid = true;
          } else if (item.kind === "revise") {
            writer.finishOp();
            opValid = await writer.beginRevision(item.sectionId);
          } else if (opValid && item.text) {
            const step = charsPerTick();
            for (let i = 0; i < item.text.length; i += step) {
              writer.write(item.text.slice(i, i + step));
              gotContent = true;
              await sleep(TYPE_TICK_MS);
            }
          }
        }
        writer.finishOp();
      };

      const schedulePump = () => {
        pumpJobsRef.current += 1;
        syncAiWritingUi();
        pumpTailRef.current = pumpTailRef.current
          .then(() => runPump())
          .then(() => {
            if (appendSectionId && gotContent) {
              blockCountRef.current += 1;
              excerpts.set(appendSectionId, pending.slice(0, 3_000));
              pushAiActivity(
                "status",
                "Finished this batch — still listening for more…"
              );
              while (excerpts.size > 6) {
                const oldest = excerpts.keys().next().value;
                if (oldest === undefined) break;
                excerpts.delete(oldest);
              }
            }
          })
          .catch(() => {})
          .finally(() => {
            pumpJobsRef.current -= 1;
            syncAiWritingUi();
          });
      };

      try {
        const res = await fetch(`/api/live-notes/${sessionId}/synthesize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            newSegmentText: pending,
            recentHeadings,
            revisable,
          }),
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("text/event-stream")) {
          // JSON fallback: capped (stop quietly) or a hard error (put the
          // slice back — the next cadence tick retries with it).
          const data = (await res
            .json()
            .catch(() => ({}))) as { capped?: boolean };
          if (!data.capped) {
            unsynthesizedRef.current =
              `${pending} ${unsynthesizedRef.current}`.trim();
          }
          return;
        }

        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let buf = "";

        const handleEvent = (event: string, parsed: Record<string, unknown>) => {
          if (event === "thought") {
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              pushAiActivity("thought", parsed.message.trim());
            }
          } else if (event === "op") {
            const sectionId =
              typeof parsed.sectionId === "string" ? parsed.sectionId : "";
            if (parsed.op === "append" && sectionId) {
              pushAiActivity("append", "Adding new notes for what the lecturer just covered…");
              queue.push({
                kind: "append",
                sectionId,
                dividerBefore: false,
              });
            } else if (parsed.op === "revise" && sectionId) {
              pushAiActivity(
                "revise",
                "Something in an earlier note doesn't match — rewriting that section…"
              );
              queue.push({ kind: "revise", sectionId });
            }
          } else if (event === "text") {
            if (typeof parsed.delta === "string" && parsed.delta) {
              queue.push({ kind: "text", text: parsed.delta });
            }
          } else if (event === "error") {
            pushAiActivity(
              "error",
              typeof parsed.message === "string"
                ? parsed.message
                : "Could not update notes for this slice."
            );
            throw new Error(
              typeof parsed.message === "string"
                ? parsed.message
                : "Synthesis failed."
            );
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sepIdx: number;
          while ((sepIdx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            let event = "message";
            let data = "";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            handleEvent(event, JSON.parse(data) as Record<string, unknown>);
          }
        }
        queueClosed = true;
      } catch {
        unsynthesizedRef.current =
          `${pending} ${unsynthesizedRef.current}`.trim();
        pushAiActivity("error", "Note update failed — will retry on the next slice.");
      } finally {
        queueClosed = true;
        synthInFlightRef.current = false;
        syncAiWritingUi();
        schedulePump();
      }
    },
    [sessionId, pushAiActivity, syncAiWritingUi]
  );

  // Cadence heartbeat: attempt a synthesis every 5s. The char thresholds
  // and the in-flight/typing guard inside maybeSynthesize decide whether
  // one actually fires, so this is cheap to run constantly.
  useEffect(() => {
    const t = window.setInterval(() => {
      void maybeSynthesize(false);
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
    transcriptSaveStatus,
    transcriptLastSavedAt,
    transcriptPendingCount,
  } = useLiveLectureTranscription({
    sessionId,
    initialNextSeq: session.lastSegmentSeq + 1,
    initialElapsedMs: session.durationSeconds * 1000,
    onSegment: (segment) => {
      setSegments((prev) => [...prev, segment]);
      unsynthesizedRef.current =
        `${unsynthesizedRef.current} ${segment.text}`.trim();
      // Attempt on EVERY committed segment, not only Deepgram natural
      // breaks — continuous lecture audio (YouTube at full pace) can go
      // minutes without a speech_final, and segments then arrive via the
      // max-length guard. The thresholds above make extra attempts free.
      void maybeSynthesize(false);
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

  // Warn before closing the tab mid-recording (transcript autosaves on each
  // utterance + every ~5s, but a tab kill can still race the last flush).
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
      await maybeSynthesize(true);
      await stop();
      await flushNow();

      if (isStandalone) {
        const res = await fetch(`/api/live-notes/${sessionId}/finish`, {
          method: "POST",
        });
        const data = (await res.json().catch(() => ({}))) as {
          redirect?: string;
          error?: string;
        };
        if (!res.ok || !data.redirect) {
          setError(
            data.error ||
              "Could not save your recording. Your notes are still in this session — try again."
          );
          setFinishing(false);
          return;
        }
        router.push(data.redirect);
        return;
      }

      const res = await fetch(`/api/live-notes/${sessionId}/complete`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!res.ok || !data.redirect) {
        setError(
          data.error ||
            "Could not start the course build. Your transcript and notes are saved to this session — use Resume on the course page to pick up where you left off."
        );
        setFinishing(false);
        return;
      }
      router.push(data.redirect);
    } catch {
      setError("Could not finish the session. Check your connection and try again.");
      setFinishing(false);
    }
  }, [finishing, maybeSynthesize, stop, flushNow, sessionId, router, isStandalone]);

  const handleDelete = useCallback(async () => {
    if (deleting || finishing) return;
    const ok = await confirmDialog({
      title: "Delete this live lecture?",
      body:
        "This cannot be undone. The recording, transcript, and notes for this session will be removed entirely.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      if (started && status !== "idle") {
        await stop();
      }
      const res = await fetch(`/api/live-notes/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Could not delete this session.");
        setDeleting(false);
        return;
      }
      router.push(isStandalone ? noteDocHref : "/notes");
    } catch {
      setError("Could not delete this session. Check your connection and try again.");
      setDeleting(false);
    }
  }, [deleting, finishing, started, status, stop, sessionId, router, isStandalone, noteDocHref]);

  const alreadyCompleted =
    !isStandalone && session.status === "completed" && session.ingestJobId;
  const standaloneDone = isStandalone && session.status === "completed";
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
          href={isStandalone ? noteDocHref : "/notes"}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          {isStandalone ? "← Back to note" : "← All notes"}
        </Link>
        {!isStandalone && session.courseId ? (
          <Link
            href={`/dashboard/courses/${session.courseId}`}
            className="hidden text-xs font-medium text-zinc-500 hover:text-violet-700 dark:text-zinc-500 dark:hover:text-violet-300 sm:inline"
          >
            {courseTitle || "Course"}
          </Link>
        ) : null}

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

          {started || alreadyCompleted || standaloneDone || segments.length > 0 ? (
            confirmFinish ? (
              <span className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void handleFinish()}
                  disabled={finishing}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {finishing
                    ? isStandalone
                      ? "Saving…"
                      : "Building…"
                    : isStandalone
                      ? "Confirm — stop recording"
                      : "Confirm — build course"}
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
                onClick={() => {
                  if (alreadyCompleted && session.courseId) {
                    router.push(
                      `/dashboard/courses/${session.courseId}/study/build?pdfJobs=${session.ingestJobId}`
                    );
                  } else if (standaloneDone) {
                    router.push(noteDocHref);
                  } else {
                    setConfirmFinish(true);
                  }
                }}
                disabled={finishing}
                className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {alreadyCompleted
                  ? "View course build"
                  : standaloneDone
                    ? "Back to note"
                    : finishing
                      ? isStandalone
                        ? "Saving…"
                        : "Building…"
                      : isStandalone
                        ? "Stop recording"
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

          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting || finishing}
            className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900/50 dark:bg-zinc-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            {deleting ? "Deleting…" : "Delete"}
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
        <main className="flex min-w-0 flex-1 flex-col">
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
            scrollFollowMode
            className="min-h-0 flex-1"
          />
          <LiveNotesAiActivity
            entries={aiActivity}
            active={aiWriting}
            open={aiLogOpen}
            onOpenChange={setAiLogOpen}
          />
        </main>

        {railOpen ? (
          <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-200 bg-white/70 dark:border-zinc-800 dark:bg-zinc-950/70 sm:w-80">
            <div className="border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Live transcript
              </p>
              <p
                className={`mt-0.5 text-[10px] font-medium ${
                  transcriptSaveStatus === "error"
                    ? "text-rose-600 dark:text-rose-400"
                    : transcriptSaveStatus === "saving" ||
                        transcriptPendingCount > 0
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-zinc-400 dark:text-zinc-500"
                }`}
                aria-live="polite"
              >
                {transcriptSaveLabel(
                  transcriptSaveStatus,
                  transcriptLastSavedAt,
                  transcriptPendingCount,
                  segments.length
                )}
              </p>
            </div>
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
