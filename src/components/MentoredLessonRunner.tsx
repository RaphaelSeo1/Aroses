"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CourseModule, CoursePayload } from "@/types/course";
import type {
  InteractionMode,
  MentoredHistoryEntry,
  MentoredLessonChunk,
  MentoredLessonPlan,
  MentoredOnboardingRecord,
  MentoredSessionPatch,
  MentoredSessionRecord,
  MentoredTurnResponse,
} from "@/types/mentored";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";

/**
 * Active Mentored Learning runner.
 *
 * Loads the cached lesson plan for the current module (generating if absent),
 * walks the student through one chunk at a time, and routes each utterance
 * through /api/mentored/turn to decide whether to advance, re-explain, etc.
 *
 * Voice and text are both supported. Voice mode auto-speaks each chunk;
 * text mode just shows it. Either way the student can answer by speaking
 * (hold-to-talk) or typing.
 */

type Phase =
  | "loading-session"
  | "loading-plan"
  | "welcome-back"
  | "teaching"
  | "module-complete"
  | "error";

const RECAP_SUFFIX = "…";

export function MentoredLessonRunner({
  materialId,
  course,
  activeModule,
  onboarding,
  onSwitchToFree,
  onAdvanceModule,
}: {
  materialId: string;
  course: CoursePayload;
  activeModule: CourseModule;
  onboarding: MentoredOnboardingRecord;
  onSwitchToFree: () => void;
  /**
   * Hand off navigation to the parent so URL state stays in sync. Receives
   * the next module's id; the parent updates `activeModuleId` + URL.
   */
  onAdvanceModule: (nextModuleId: number) => void;
}) {
  // ---------- session + plan state ----------
  const [phase, setPhase] = useState<Phase>("loading-session");
  const [session, setSession] = useState<MentoredSessionRecord | null>(null);
  const [plan, setPlan] = useState<MentoredLessonPlan | null>(null);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ---------- per-turn state ----------
  const [tutorReply, setTutorReply] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    onboarding.interactionMode
  );

  const voice = useMentoredVoice({ materialId });

  // Avoid re-speaking the same chunk on every render — we only auto-speak
  // when the chunk pointer actually changes (and we're in voice mode).
  const lastSpokenChunkIdRef = useRef<string | null>(null);
  const recordPromiseRef = useRef<Promise<Blob | null> | null>(null);

  // ----- load session -----
  const loadSession = useCallback(async () => {
    setPhase("loading-session");
    try {
      const res = await fetch(`/api/mentored/session/${materialId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as {
        session: MentoredSessionRecord | null;
      };
      setSession(body.session);

      // If we have a session for the same module, hydrate position.
      if (body.session && body.session.moduleId === activeModule.id) {
        setChunkIdx(body.session.chunkIndex ?? 0);
        setAttempts(body.session.attemptState?.attempts ?? 0);
        if (body.session.lessonPlan?.moduleId === activeModule.id) {
          setPlan(body.session.lessonPlan);
        }
        // Show a "welcome back" recap when this is a resume (lastSeenAt > 5min).
        const last = body.session.lastSeenAt
          ? new Date(body.session.lastSeenAt).getTime()
          : 0;
        const fresh = Date.now() - last < 5 * 60_000;
        if (!fresh && body.session.lastRecap) {
          setPhase("welcome-back");
          return;
        }
      } else if (body.session) {
        // Different module — fresh start in this module.
        setChunkIdx(0);
        setAttempts(0);
        setPlan(null);
      }
      setPhase("loading-plan");
    } catch (e) {
      console.error("[runner loadSession]", e);
      setError(e instanceof Error ? e.message : "Could not load session");
      setPhase("error");
    }
  }, [activeModule.id, materialId]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  // ----- load or generate plan -----
  const loadOrGeneratePlan = useCallback(async () => {
    try {
      const res = await fetch("/api/mentored/lesson-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          moduleId: activeModule.id,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as {
        plan: MentoredLessonPlan;
        cached: boolean;
      };
      setPlan(body.plan);
      // If we just generated a fresh plan but the existing chunkIdx is past
      // the end (e.g. a stale resume), reset to start.
      if (chunkIdx >= body.plan.chunks.length) setChunkIdx(0);
      setPhase("teaching");
    } catch (e) {
      console.error("[runner loadOrGeneratePlan]", e);
      setError(e instanceof Error ? e.message : "Could not build lesson plan");
      setPhase("error");
    }
  }, [activeModule.id, chunkIdx, materialId]);

  useEffect(() => {
    if (phase === "loading-plan") void loadOrGeneratePlan();
  }, [phase, loadOrGeneratePlan]);

  // ----- persist session patch -----
  const persist = useCallback(
    async (patch: MentoredSessionPatch) => {
      try {
        const res = await fetch(`/api/mentored/session/${materialId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (res.ok) {
          const body = (await res.json()) as { session: MentoredSessionRecord };
          setSession(body.session);
        }
      } catch (e) {
        console.error("[runner persist]", e);
      }
    },
    [materialId]
  );

  // Active chunk derivation
  const chunk: MentoredLessonChunk | null = plan?.chunks[chunkIdx] ?? null;
  const totalChunks = plan?.chunks.length ?? 0;
  const moduleCount = course.modules.length;
  const moduleIdx = course.modules.findIndex((m) => m.id === activeModule.id);

  // ----- auto-speak when entering a new chunk in voice mode -----
  useEffect(() => {
    if (phase !== "teaching") return;
    if (!chunk) return;
    if (interactionMode !== "voice") return;
    if (lastSpokenChunkIdRef.current === chunk.id) return;
    lastSpokenChunkIdRef.current = chunk.id;
    // Speak the explanation followed by the check question with a beat between.
    const text = `${chunk.explanation}\n\n${chunk.checkQuestion}`;
    void voice.speak(text);
  }, [chunk, interactionMode, phase, voice]);

  // ----- core submit -----
  const submitAnswer = useCallback(
    async (utterance: string) => {
      if (!chunk || !plan) return;
      const text = utterance.trim();
      if (text.length < 2) return;
      setSubmitting(true);
      setTutorReply(null);
      try {
        const res = await fetch("/api/mentored/turn", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            moduleId: activeModule.id,
            chunk,
            attempts,
            studentUtterance: text,
            knowledgeLevel: onboarding.knowledgeLevel,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const body = (await res.json()) as MentoredTurnResponse;
        setTutorReply(body.reply);
        if (interactionMode === "voice") void voice.speak(body.reply);

        // Record this attempt in history for the recap. `historyEval`
        // includes "skipped" (only meaningful in history rows), while
        // `attemptEval` is the narrower set the AttemptState carries.
        const historyEval: MentoredHistoryEntry["evaluation"] =
          body.intent === "answer_correct"
            ? "correct"
            : body.intent === "answer_partial"
              ? "partial"
              : body.intent === "answer_wrong"
                ? "wrong"
                : body.intent === "skip_concept" || body.intent === "move_on"
                  ? "skipped"
                  : "partial";
        const attemptEval: "correct" | "partial" | "wrong" | null =
          historyEval === "skipped" ? null : historyEval;

        if (body.advance) {
          const nextIdx = chunkIdx + 1;
          setChunkIdx(nextIdx);
          setAttempts(0);
          setAnswerText("");

          // Persist position + history entry.
          await persist({
            chunkIndex: nextIdx,
            attemptState: {
              chunkIndex: nextIdx,
              attempts: 0,
              lastEval: attemptEval,
            },
            lastRecap: `Module ${activeModule.id} — last covered "${chunk.concept}".`,
            appendHistory: {
              at: new Date().toISOString(),
              moduleId: activeModule.id,
              chunkIndex: chunkIdx,
              concept: chunk.concept,
              evaluation: historyEval,
            },
          });

          if (nextIdx >= plan.chunks.length) {
            setPhase("module-complete");
          }
        } else {
          const nextAttempts = attempts + 1;
          setAttempts(nextAttempts);
          setAnswerText("");
          await persist({
            attemptState: {
              chunkIndex: chunkIdx,
              attempts: nextAttempts,
              lastEval: attemptEval,
            },
          });
        }
      } catch (e) {
        console.error("[runner submitAnswer]", e);
        setTutorReply(
          e instanceof Error ? e.message : "Could not reach the tutor."
        );
      }
      setSubmitting(false);
    },
    [
      activeModule.id,
      attempts,
      chunk,
      chunkIdx,
      interactionMode,
      materialId,
      onboarding.knowledgeLevel,
      persist,
      plan,
      voice,
    ]
  );

  // ----- voice input controls -----
  const startVoiceAnswer = useCallback(async () => {
    if (submitting || voice.state.recording) return;
    voice.cancelSpeak();
    recordPromiseRef.current = voice.startRecording();
  }, [submitting, voice]);

  const finishVoiceAnswer = useCallback(async () => {
    if (!recordPromiseRef.current) return;
    await voice.stopRecording();
    const blob = await recordPromiseRef.current;
    recordPromiseRef.current = null;
    if (!blob) return;
    const text = await voice.transcribe(blob);
    if (!text) return;
    setAnswerText(text);
    void submitAnswer(text);
  }, [submitAnswer, voice]);

  // ----- resume from welcome-back -----
  const resumeFromRecap = useCallback(() => {
    setPhase("loading-plan");
  }, []);

  // ----- advance to next module on module-complete -----
  const goToNextModule = useCallback(async () => {
    const nextModule = course.modules[moduleIdx + 1];
    if (!nextModule) return;
    setPlan(null);
    setChunkIdx(0);
    setAttempts(0);
    setTutorReply(null);
    lastSpokenChunkIdRef.current = null;
    // Update session module pointer. The page-level CoursePlayer will pick
    // up activeModule via its own state — for now the runner reloads its
    // plan against `activeModule.id`. Surface the change to the parent
    // by clicking the existing module navigation if available.
    await persist({
      moduleId: nextModule.id,
      chunkIndex: 0,
      attemptState: { chunkIndex: 0, attempts: 0, lastEval: null },
    });
    onAdvanceModule(nextModule.id);
  }, [course.modules, moduleIdx, onAdvanceModule, persist]);

  // ===========================================================================
  // Render
  // ===========================================================================
  if (phase === "loading-session" || phase === "loading-plan") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30 dark:text-zinc-400">
        {phase === "loading-session"
          ? "Loading your tutor session…"
          : "Tutor is building today's lesson plan…"}
      </div>
    );
  }

  if (phase === "error") {
    return (
      <ErrorState
        message={error || "Something went wrong"}
        onRetry={() => void loadSession()}
        onSwitchToFree={onSwitchToFree}
      />
    );
  }

  if (phase === "welcome-back" && session) {
    return (
      <WelcomeBack
        recap={session.lastRecap ?? "Welcome back."}
        onResume={resumeFromRecap}
        onSwitchToFree={onSwitchToFree}
      />
    );
  }

  if (phase === "module-complete") {
    const hasNext = moduleIdx + 1 < moduleCount;
    return (
      <ModuleComplete
        moduleTitle={activeModule.title}
        hasNext={hasNext}
        onNext={() => void goToNextModule()}
        onSwitchToFree={onSwitchToFree}
      />
    );
  }

  if (!plan || !chunk) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-zinc-50/50 p-10 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/30">
        Lesson plan unavailable.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ProgressHeader
        moduleIdx={moduleIdx}
        moduleCount={moduleCount}
        chunkIdx={chunkIdx}
        chunkCount={totalChunks}
        moduleTitle={activeModule.title}
        onInteractionToggle={() =>
          setInteractionMode((m) => (m === "voice" ? "text" : "voice"))
        }
        interactionMode={interactionMode}
      />

      <ChunkCard
        chunk={chunk}
        attempts={attempts}
        tutorReply={tutorReply}
        speaking={voice.state.speaking}
        onReplay={() =>
          void voice.speak(`${chunk.explanation}\n\n${chunk.checkQuestion}`)
        }
        interactionMode={interactionMode}
      />

      <AnswerComposer
        interactionMode={interactionMode}
        text={answerText}
        onTextChange={setAnswerText}
        onSubmitText={() => void submitAnswer(answerText)}
        recording={voice.state.recording}
        transcribing={voice.state.transcribing}
        onMicDown={() => void startVoiceAnswer()}
        onMicUp={() => void finishVoiceAnswer()}
        submitting={submitting}
        error={voice.state.error}
      />

      <FooterActions onSwitchToFree={onSwitchToFree} />
    </div>
  );
}

// ===========================================================================
// Pieces
// ===========================================================================

function ProgressHeader({
  moduleIdx,
  moduleCount,
  chunkIdx,
  chunkCount,
  moduleTitle,
  interactionMode,
  onInteractionToggle,
}: {
  moduleIdx: number;
  moduleCount: number;
  chunkIdx: number;
  chunkCount: number;
  moduleTitle: string;
  interactionMode: InteractionMode;
  onInteractionToggle: () => void;
}) {
  const pct = chunkCount === 0 ? 0 : Math.round((chunkIdx / chunkCount) * 100);
  return (
    <header className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Section {moduleIdx + 1} of {moduleCount}
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {moduleTitle}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
          <span className="tabular-nums">
            {Math.min(chunkIdx + 1, chunkCount)} / {chunkCount}
          </span>
          <button
            type="button"
            onClick={onInteractionToggle}
            className="rounded-full border border-zinc-200 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {interactionMode === "voice" ? "🔊 Voice" : "📝 Text"}
          </button>
        </div>
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-brand transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </header>
  );
}

function ChunkCard({
  chunk,
  attempts,
  tutorReply,
  speaking,
  onReplay,
  interactionMode,
}: {
  chunk: MentoredLessonChunk;
  attempts: number;
  tutorReply: string | null;
  speaking: boolean;
  onReplay: () => void;
  interactionMode: InteractionMode;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            Concept
          </p>
          <h3 className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {chunk.concept}
          </h3>
        </div>
        <button
          type="button"
          onClick={onReplay}
          className={
            speaking
              ? "inline-flex items-center gap-1 rounded-full bg-brand/10 px-3 py-1 text-xs font-semibold text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
              : "inline-flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
          }
        >
          <span className={speaking ? "animate-pulse" : ""}>●</span>
          {speaking ? "Speaking…" : interactionMode === "voice" ? "Replay" : "Hear it"}
        </button>
      </div>

      <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
        {chunk.explanation}
      </p>

      <div className="mt-5 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          Quick check
        </p>
        <p className="mt-1 text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {chunk.checkQuestion}
        </p>
      </div>

      {tutorReply ? (
        <div className="mt-4 rounded-xl border border-brand-border bg-brand-blush/40 p-4 text-sm leading-relaxed text-zinc-800 dark:border-brand-border/40 dark:bg-brand-blush/10 dark:text-zinc-200">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
            Tutor
          </p>
          <p className="mt-1 whitespace-pre-wrap">{tutorReply}</p>
        </div>
      ) : null}

      {attempts >= 3 ? (
        <p className="mt-3 text-xs italic text-amber-700 dark:text-amber-400">
          You're on attempt {attempts + 1}. We can come back to this one — try
          once more or just say "move on".
        </p>
      ) : null}
    </div>
  );
}

function AnswerComposer({
  interactionMode,
  text,
  onTextChange,
  onSubmitText,
  recording,
  transcribing,
  onMicDown,
  onMicUp,
  submitting,
  error,
}: {
  interactionMode: InteractionMode;
  text: string;
  onTextChange: (v: string) => void;
  onSubmitText: () => void;
  recording: boolean;
  transcribing: boolean;
  onMicDown: () => void;
  onMicUp: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const canSubmit = text.trim().length >= 2 && !submitting;
  const busy = submitting || transcribing;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <textarea
          rows={3}
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
              e.preventDefault();
              onSubmitText();
            }
          }}
          placeholder={
            interactionMode === "voice"
              ? "Speak or type your answer…"
              : "Type your answer (⌘↵ to submit)…"
          }
          className="block w-full flex-1 resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
        />
        <div className="flex flex-row gap-2 sm:flex-col">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmitText}
            className="flex-1 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white sm:flex-none"
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
          <button
            type="button"
            disabled={busy}
            onMouseDown={onMicDown}
            onMouseUp={onMicUp}
            onMouseLeave={recording ? onMicUp : undefined}
            onTouchStart={onMicDown}
            onTouchEnd={onMicUp}
            className={
              recording
                ? "flex-1 rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-lg sm:flex-none"
                : "flex-1 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900 sm:flex-none"
            }
            title={recording ? "Release to send" : "Hold to talk"}
          >
            {transcribing
              ? "Transcribing…"
              : recording
                ? "● Release to send"
                : "🎤 Hold to talk"}
          </button>
        </div>
      </div>
      {error ? (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
    </div>
  );
}

function WelcomeBack({
  recap,
  onResume,
  onSwitchToFree,
}: {
  recap: string;
  onResume: () => void;
  onSwitchToFree: () => void;
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-brand">
        Welcome back
      </p>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {recap}
      </p>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Want me to pick up from there, or would you rather skim the section
        yourself?
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onResume}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
        >
          Resume
        </button>
        <button
          type="button"
          onClick={onSwitchToFree}
          className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Just let me read
        </button>
      </div>
    </div>
  );
}

function ModuleComplete({
  moduleTitle,
  hasNext,
  onNext,
  onSwitchToFree,
}: {
  moduleTitle: string;
  hasNext: boolean;
  onNext: () => void;
  onSwitchToFree: () => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm dark:border-emerald-900 dark:bg-emerald-950/40">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
        Section complete
      </p>
      <h3 className="mt-2 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Nice — that wraps up "{moduleTitle}"
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        How are you feeling about what we just covered? You can review what's
        next in the sidebar, or jump straight into the next section{RECAP_SUFFIX}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        {hasNext ? (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover"
          >
            Next section →
          </button>
        ) : (
          <span className="inline-flex items-center rounded-full bg-emerald-600 px-5 py-2 text-sm font-semibold text-white">
            You finished the course
          </span>
        )}
        <button
          type="button"
          onClick={onSwitchToFree}
          className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
        >
          Review on my own
        </button>
      </div>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  onSwitchToFree,
}: {
  message: string;
  onRetry: () => void;
  onSwitchToFree: () => void;
}) {
  return (
    <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900 dark:bg-rose-950/40">
      <p className="text-sm font-semibold text-rose-900 dark:text-rose-100">
        Couldn't start Mentored Learning
      </p>
      <p className="mt-2 text-sm text-rose-700 dark:text-rose-200">{message}</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onSwitchToFree}
          className="rounded-full border border-rose-300 bg-white px-4 py-2 text-xs font-medium text-rose-900 hover:bg-rose-100"
        >
          Switch to Free Exploration
        </button>
      </div>
    </div>
  );
}

function FooterActions({
  onSwitchToFree,
}: {
  onSwitchToFree: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <button
        type="button"
        onClick={onSwitchToFree}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1 font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
      >
        Switch to Free Exploration
      </button>
    </div>
  );
}
