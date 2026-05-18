"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedWaveform } from "@/components/immersive/AnimatedWaveform";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";
import { LessonPlanLoading } from "@/components/immersive/LessonPlanLoading";
import { SourceLessonPanel } from "@/components/immersive/SourceLessonPanel";
import { TypewriterText } from "@/components/immersive/TypewriterText";
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
 * Immersive version of MentoredLessonRunner.
 *
 * Same logic as the original (load session → load plan → submit → advance)
 * but rendered inside the cloud / glass / waveform shell. The visible chunk
 * UI is intentionally minimal: one concept card with the explanation, then
 * a separate check-question card, then a tutor-reply card when applicable.
 *
 * Voice and text are both supported; the composer at the bottom always
 * shows both options.
 */

type Phase =
  | "loading-session"
  | "loading-plan"
  | "welcome-back"
  | "teaching"
  | "module-complete"
  | "error";

export function ImmersiveLessonRunner({
  materialId,
  course,
  activeModule,
  onboarding,
  onSwitchToFree,
  onExit,
  onAdvanceModule,
}: {
  materialId: string;
  course: CoursePayload;
  activeModule: CourseModule;
  onboarding: MentoredOnboardingRecord;
  onSwitchToFree: () => void;
  /** Hard exit from the immersive view (back to course detail). */
  onExit: () => void;
  onAdvanceModule: (nextModuleId: number) => void;
}) {
  // ---- session / plan ----
  const [phase, setPhase] = useState<Phase>("loading-session");
  const [session, setSession] = useState<MentoredSessionRecord | null>(null);
  const [plan, setPlan] = useState<MentoredLessonPlan | null>(null);
  const [chunkIdx, setChunkIdx] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // ---- per-turn ----
  const [tutorReply, setTutorReply] = useState<string | null>(null);
  const [answerText, setAnswerText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    onboarding.interactionMode
  );

  // Voice capture mode:
  //   "push"  — student holds M (or the on-screen status pill) to talk
  //   "live"  — mic auto-listens after each AI utterance; VAD endpoints
  //             the recording when the student stops speaking
  const [voiceMode, setVoiceMode] = useState<"push" | "live">("push");

  // ---- exit confirmation modal ----
  const [showExitMenu, setShowExitMenu] = useState(false);

  // Barge-in handler — defined after `submitAnswer` would create a forward
  // reference, so we use a ref the hook reads at fire time. Set below.
  const onBargeInRef = useRef<() => void>(() => {});

  const voice = useMentoredVoice({
    materialId,
    onBargeIn: () => onBargeInRef.current(),
  });
  const lastSpokenChunkIdRef = useRef<string | null>(null);
  const recordPromiseRef = useRef<Promise<Blob | null> | null>(null);

  // ---- session opening greeting ----
  // Plays once per mount, the moment the runner has a session loaded.
  // `greetingPlayed` gates the auto-speak-chunk effect so the chunk
  // doesn't talk over the welcome line.
  const [greetingPlayed, setGreetingPlayed] = useState(false);
  const greetingFiredRef = useRef(false);

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

      if (body.session && body.session.moduleId === activeModule.id) {
        setChunkIdx(body.session.chunkIndex ?? 0);
        setAttempts(body.session.attemptState?.attempts ?? 0);
        if (body.session.lessonPlan?.moduleId === activeModule.id) {
          setPlan(body.session.lessonPlan);
        }
        const last = body.session.lastSeenAt
          ? new Date(body.session.lastSeenAt).getTime()
          : 0;
        const fresh = Date.now() - last < 5 * 60_000;
        if (!fresh && body.session.lastRecap) {
          setPhase("welcome-back");
          return;
        }
      } else if (body.session) {
        setChunkIdx(0);
        setAttempts(0);
        setPlan(null);
      }
      setPhase("loading-plan");
    } catch (e) {
      console.error("[imm runner loadSession]", e);
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
      if (chunkIdx >= body.plan.chunks.length) setChunkIdx(0);
      setPhase("teaching");
    } catch (e) {
      console.error("[imm runner loadOrGeneratePlan]", e);
      setError(e instanceof Error ? e.message : "Could not build lesson plan");
      setPhase("error");
    }
  }, [activeModule.id, chunkIdx, materialId]);

  useEffect(() => {
    if (phase === "loading-plan") void loadOrGeneratePlan();
  }, [phase, loadOrGeneratePlan]);

  // ----- persist -----
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
        console.error("[imm runner persist]", e);
      }
    },
    [materialId]
  );

  const chunk: MentoredLessonChunk | null = plan?.chunks[chunkIdx] ?? null;
  const moduleCount = course.modules.length;
  const moduleIdx = course.modules.findIndex((m) => m.id === activeModule.id);

  // ----- session opening greeting (spoken + transcript) -----
  //
  // Plays once per page load. Picks a scenario from the loaded session:
  //   - no history & first chunk of first module → "first_time"
  //   - every module touched at least once       → "all_complete"
  //   - anything else with any prior progress    → "returning"
  //
  // The greeting text is dropped into `tutorReply` so it appears in the
  // transcript card (same place AI replies show), and the same string
  // is sent through ElevenLabs so it plays out loud. The Mentored vs
  // Free Exploration gate is implicit — this runner only mounts in
  // Mentored mode.

  useEffect(() => {
    if (greetingFiredRef.current) return;
    // Wait until either the teaching plan is loaded OR we have enough
    // session info to render the welcome-back screen. Don't fire
    // during loading-session / loading-plan / error.
    const ready =
      (phase === "teaching" && plan != null) ||
      (phase === "welcome-back" && session != null) ||
      (phase === "module-complete" && session != null);
    if (!ready) return;
    greetingFiredRef.current = true;

    const history = session?.history ?? [];
    const touchedModuleIds = new Set(history.map((h) => h.moduleId));
    const allComplete =
      moduleCount > 0 && touchedModuleIds.size >= moduleCount;
    const hasProgress =
      history.length > 0 || moduleIdx > 0 || chunkIdx > 0;
    const scenario: "first_time" | "returning" | "all_complete" = allComplete
      ? "all_complete"
      : hasProgress
        ? "returning"
        : "first_time";

    // Pull the most natural "last lesson title". Prefer the lesson
    // mapped to the most recent history chunk; fall back to the
    // concept name; fall back to the active module's title.
    const lastHistory = history.length > 0 ? history[history.length - 1] : null;
    const lastLessonTitle =
      lastHistory?.concept ?? activeModule.title ?? undefined;
    const firstLessonTitle =
      activeModule.lessons[0]?.title ?? activeModule.title ?? undefined;

    void (async () => {
      let text = "";
      try {
        const res = await fetch("/api/mentored/greeting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            courseTitle: course.title,
            courseDescription: course.description ?? undefined,
            firstLessonTitle,
            lastLessonTitle: scenario === "returning" ? lastLessonTitle : undefined,
            scenario,
          }),
        });
        if (res.ok) {
          const body = (await res.json()) as { greeting?: string };
          text = (body.greeting ?? "").trim();
        }
      } catch (e) {
        console.error("[imm runner greeting fetch]", e);
      }
      if (!text) {
        // Safe fallback — never leave the student in silence.
        text =
          scenario === "first_time"
            ? `Welcome to ${course.title}. Ready to dive in?`
            : scenario === "all_complete"
              ? `Welcome back — looks like you've already worked through this whole course. Want to review anything specific?`
              : lastLessonTitle
                ? `Welcome back. Last time we were on "${lastLessonTitle}". Ready to keep going?`
                : `Welcome back. Ready to keep going?`;
      }

      if (interactionMode === "voice") {
        // Sync the greeting's transcript reveal with audio playback —
        // tutorReply only gets set once Rose's voice actually starts,
        // so the text never appears before she speaks.
        try {
          await voice.speak(text, {
            onPlay: () => setTutorReply(text),
          });
        } catch (e) {
          console.error("[imm runner greeting speak]", e);
          // Failsafe — make sure the greeting appears even if the
          // speak() call threw before `onPlay` could fire.
          setTutorReply((prev) => prev ?? text);
        }
      } else {
        // Text-only mode: no audio to wait for.
        setTutorReply(text);
      }
      setGreetingPlayed(true);
    })();
    // We deliberately exclude `voice` / `course` / module-derived deps —
    // this should fire EXACTLY once per mount based on initial readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan, session]);

  // ----- auto-speak fresh chunk -----
  // Held back until the greeting is done so the tutor doesn't talk over
  // itself. Once the greeting finishes (or text mode skips it), this
  // takes over and speaks the chunk's explanation + check question.
  useEffect(() => {
    if (phase !== "teaching") return;
    if (!chunk) return;
    if (interactionMode !== "voice") return;
    if (!greetingPlayed) return;
    if (lastSpokenChunkIdRef.current === chunk.id) return;
    lastSpokenChunkIdRef.current = chunk.id;
    const text = `${chunk.explanation}\n\n${chunk.checkQuestion}`;
    void voice.speak(text);
  }, [chunk, interactionMode, phase, voice, greetingPlayed]);

  // ----- submit (streaming turn → sentence-streamed TTS) -----
  //
  // Hits /api/mentored/turn-stream and pipes:
  //   • `text` SSE deltas → setTutorReply (incrementally) and a sentence
  //                         splitter that feeds voice.speakSentenceStream
  //   • `meta` SSE event  → captured for advance / focused-review logic
  //
  // The voice playback pipeline starts as soon as the first sentence is
  // available — usually 0.5-1.5s after submit instead of waiting for
  // Claude to finish (~3-6s) AND a full TTS round-trip.
  const submitAnswer = useCallback(
    async (utterance: string) => {
      if (!chunk || !plan) return;
      const text = utterance.trim();
      if (text.length < 2) return;
      setSubmitting(true);
      setTutorReply("");
      try {
        const res = await fetch("/api/mentored/turn-stream", {
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
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || `HTTP ${res.status}`);
        }

        // Parse SSE chunks lazily into a single async generator. We pipe
        // text deltas into both setTutorReply (UI) and a sentence queue
        // (TTS). Meta and done are consumed but don't yield sentences.
        let finalIntent: MentoredTurnResponse["intent"] =
          "other" as MentoredTurnResponse["intent"];
        let finalAdvance = false;
        const decoder = new TextDecoder();
        const reader = res.body.getReader();

        async function* eachSseEvent(): AsyncGenerator<
          | { type: "text"; delta: string }
          | { type: "meta"; intent: MentoredTurnResponse["intent"]; advance: boolean }
          | { type: "done" }
          | { type: "error"; message: string },
          void,
          void
        > {
          let buf = "";
          while (true) {
            const { done, value } = await reader.read();
            if (done) return;
            buf += decoder.decode(value, { stream: true });
            // SSE messages are separated by blank lines.
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
              try {
                const parsed = JSON.parse(data) as Record<string, unknown>;
                if (event === "text" && typeof parsed.delta === "string") {
                  yield { type: "text", delta: parsed.delta };
                } else if (event === "meta") {
                  yield {
                    type: "meta",
                    intent:
                      typeof parsed.intent === "string"
                        ? (parsed.intent as MentoredTurnResponse["intent"])
                        : "other",
                    advance: parsed.advance === true,
                  };
                } else if (event === "done") {
                  yield { type: "done" };
                } else if (event === "error") {
                  yield {
                    type: "error",
                    message:
                      typeof parsed.message === "string"
                        ? parsed.message
                        : "Tutor stream failed",
                  };
                }
              } catch {
                /* malformed line — skip */
              }
            }
          }
        }

        // Sentence splitter: yields complete sentences as they appear in
        // the text stream. Final tail (no trailing terminator) is flushed
        // on `done`. We also keep an ordered `sentences` array — this is
        // the source of truth for transcript reveal, which happens only
        // when each sentence's audio actually starts playing (voice
        // mode) so the text never races ahead of Rose's voice.
        let pendingBuf = "";
        const sentences: string[] = [];

        const sentenceStream = (async function* (): AsyncGenerator<
          string,
          void,
          void
        > {
          for await (const ev of eachSseEvent()) {
            if (ev.type === "text") {
              pendingBuf += ev.delta;
              if (interactionMode !== "voice") {
                // Text-only mode: no audio to sync against, reveal
                // tokens as they arrive (original behavior).
                setTutorReply((prev) => (prev ?? "") + ev.delta);
              }
              // Flush complete sentences (ending in . ! ? or newline).
              // We require a terminator + whitespace OR end-of-buffer so
              // we don't cut mid-decimal ("3.14") in pathological cases.
              const re = /([\s\S]*?[.!?\n])(\s+|$)/g;
              let lastIdx = 0;
              let m: RegExpExecArray | null;
              while ((m = re.exec(pendingBuf)) !== null) {
                const sentence = m[1].trim();
                if (sentence.length >= 3) {
                  sentences.push(sentence);
                  yield sentence;
                }
                lastIdx = re.lastIndex;
              }
              if (lastIdx > 0) pendingBuf = pendingBuf.slice(lastIdx);
            } else if (ev.type === "meta") {
              finalIntent = ev.intent;
              finalAdvance = ev.advance;
            } else if (ev.type === "done") {
              const tail = pendingBuf.trim();
              if (tail.length >= 1) {
                sentences.push(tail);
                yield tail;
              }
              pendingBuf = "";
              return;
            } else if (ev.type === "error") {
              throw new Error(ev.message);
            }
          }
        })();

        if (interactionMode === "voice") {
          // Gate transcript reveal on audio playback — each sentence
          // appears in the transcript card the moment its audio chunk
          // actually starts playing, NOT when Claude emits the tokens.
          // If a sentence's audio fetch / playback fails, the hook
          // still fires `onSentencePlaying` with `failed: true` so the
          // text is revealed anyway (no silent + no-caption state).
          //
          // If the user barges in mid-reply, sentences after the abort
          // point will NEVER fire their reveal callback — that's
          // intentional. We don't backfill the rest of the text on
          // abort; the partially-revealed transcript is what the
          // student actually heard, which is what they should see.
          let revealedUpTo = 0;
          await voice.speakSentenceStream(sentenceStream, {
            onSentencePlaying: (_text, index) => {
              if (index < revealedUpTo) return;
              revealedUpTo = index + 1;
              setTutorReply(sentences.slice(0, revealedUpTo).join(" "));
            },
          });
        } else {
          // Drain the stream so meta/done events still execute.
          for await (const _ of sentenceStream) {
            void _;
          }
        }

        const historyEval: MentoredHistoryEntry["evaluation"] =
          finalIntent === "answer_correct"
            ? "correct"
            : finalIntent === "answer_partial"
              ? "partial"
              : finalIntent === "answer_wrong"
                ? "wrong"
                : finalIntent === "skip_concept" || finalIntent === "move_on"
                  ? "skipped"
                  : "partial";
        const attemptEval: "correct" | "partial" | "wrong" | null =
          historyEval === "skipped" ? null : historyEval;

        if (finalAdvance) {
          const nextIdx = chunkIdx + 1;
          setChunkIdx(nextIdx);
          setAttempts(0);
          setAnswerText("");

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
        console.error("[imm runner submitAnswer]", e);
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

  // ----- voice input -----
  const startVoiceAnswer = useCallback(async () => {
    if (submitting || voice.state.recording) return;
    voice.cancelSpeak();
    recordPromiseRef.current = voice.startRecording();
  }, [submitting, voice]);

  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceNotice) return;
    const id = window.setTimeout(() => setVoiceNotice(null), 3500);
    return () => window.clearTimeout(id);
  }, [voiceNotice]);

  const finishVoiceAnswer = useCallback(async () => {
    if (!recordPromiseRef.current) return;
    await voice.stopRecording();
    const blob = await recordPromiseRef.current;
    recordPromiseRef.current = null;
    if (!blob) {
      // Either the recording failed to start (mic permission) or no
      // audio was captured. The hook's `state.error` carries the more
      // specific permission/device message when that path was taken;
      // fall back to a generic "no audio" hint otherwise.
      if (voice.state.error) {
        setVoiceNotice(voice.state.error);
      } else {
        setVoiceNotice(
          "Didn't catch any audio — try holding the mic a little longer."
        );
      }
      return;
    }
    if (blob.size < 1500) {
      // ~50ms of opus — too short to transcribe reliably.
      setVoiceNotice(
        "That was very short — hold the mic and speak a full sentence."
      );
      return;
    }
    const text = await voice.transcribe(blob);
    if (!text) {
      setVoiceNotice(
        voice.state.error ??
          "I didn't catch that — could you try again, a bit closer to the mic?"
      );
      return;
    }
    setAnswerText(text);
    void submitAnswer(text);
  }, [submitAnswer, voice]);

  // ----- global "hold M to talk" -----
  // Listens at the window level so the student can talk from anywhere in
  // the immersive view without focusing a button. Suppressed when typing
  // in the textarea / other form fields, and when modifier keys are held
  // (so M as part of ⌘M / Ctrl+M still works for the browser).
  const mDownRef = useRef(false);
  useEffect(() => {
    if (interactionMode !== "voice") return;
    if (voiceMode !== "push") return;

    const isTextTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      if (mDownRef.current) return;
      mDownRef.current = true;
      void startVoiceAnswer();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (!mDownRef.current) return;
      mDownRef.current = false;
      void finishVoiceAnswer();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [finishVoiceAnswer, interactionMode, startVoiceAnswer, voiceMode]);

  // ----- barge-in handler -----
  // Fires when the VAD detects the student talking over the AI. We auto
  // start a silence-endpointed capture so they can speak their full
  // interruption without ever pressing a button, then send it through the
  // same submitAnswer pipeline as any other voice answer.
  const handleBargeIn = useCallback(async () => {
    try {
      const blob = await voice.recordUntilSilence();
      if (!blob) return;
      const text = await voice.transcribe(blob);
      if (!text) return;
      setAnswerText(text);
      void submitAnswer(text);
    } catch (e) {
      console.error("[imm runner handleBargeIn]", e);
    }
  }, [submitAnswer, voice]);

  useEffect(() => {
    onBargeInRef.current = () => void handleBargeIn();
  }, [handleBargeIn]);

  // ----- live mode: auto-listen after AI finishes speaking -----
  // When live mode is on AND the AI has just stopped speaking AND we're
  // not already capturing, kick off a silence-endpointed recording. This
  // gives the conversational "they speak, you speak, repeat" feel without
  // ever needing to press a key. Push mode skips this — the student
  // controls the mic with M.
  const liveCycleGuardRef = useRef(false);
  useEffect(() => {
    if (voiceMode !== "live") return;
    if (interactionMode !== "voice") return;
    if (phase !== "teaching") return;
    if (voice.state.speaking) return;
    if (voice.state.recording) return;
    if (voice.state.transcribing) return;
    if (submitting) return;
    if (liveCycleGuardRef.current) return;
    liveCycleGuardRef.current = true;
    (async () => {
      try {
        const blob = await voice.recordUntilSilence();
        if (!blob) return;
        const text = await voice.transcribe(blob);
        if (!text) return;
        setAnswerText(text);
        await submitAnswer(text);
      } catch (e) {
        console.error("[imm runner live mode]", e);
      } finally {
        liveCycleGuardRef.current = false;
      }
    })();
  }, [
    interactionMode,
    phase,
    submitAnswer,
    submitting,
    voice,
    voice.state.recording,
    voice.state.speaking,
    voice.state.transcribing,
    voiceMode,
  ]);

  const resumeFromRecap = useCallback(() => {
    setPhase("loading-plan");
  }, []);

  const goToNextModule = useCallback(async () => {
    const nextModule = course.modules[moduleIdx + 1];
    if (!nextModule) return;
    setPlan(null);
    setChunkIdx(0);
    setAttempts(0);
    setTutorReply(null);
    lastSpokenChunkIdRef.current = null;
    await persist({
      moduleId: nextModule.id,
      chunkIndex: 0,
      attemptState: { chunkIndex: 0, attempts: 0, lastEval: null },
    });
    onAdvanceModule(nextModule.id);
  }, [course.modules, moduleIdx, onAdvanceModule, persist]);

  // ----- top bar (always rendered) -----
  // We intentionally keep the top bar minimal — just voice/text mode +
  // Exit. The Hold M / Live toggle now lives inside the composer (see
  // AnswerComposer below) where the student's eyes are already focused,
  // so the choice is discoverable without a glance to the top-right.
  const topBar = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() =>
          setInteractionMode((m) => (m === "voice" ? "text" : "voice"))
        }
        className="rounded-full border border-white/50 bg-white/45 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
        title="Toggle voice / text"
      >
        {interactionMode === "voice" ? "🔊 Voice" : "📝 Text"}
      </button>
      <button
        type="button"
        onClick={() => setShowExitMenu(true)}
        className="rounded-full border border-white/50 bg-white/45 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
      >
        Exit
      </button>
    </div>
  );

  // ----- bottom (waveform + composer) -----
  const waveformMode = voice.state.speaking
    ? "speaking"
    : voice.state.recording
      ? "listening"
      : "idle";

  // Subtle status pill above the composer. Surface mic state for live
  // mode AND give a clear hint for push mode so the student knows the
  // hold-M shortcut is available without having to read docs. Voice
  // errors (e.g. empty transcription) take priority so silent failures
  // can't happen. The "Thinking…" state covers the window between
  // submit and the first audible sentence from the streaming turn —
  // now keyed on `tutorReply` being empty rather than `voice.state.
  // speaking`, because `speaking` flips to true the moment we kick off
  // the TTS request (well before the first audio chunk actually
  // plays). With audio-gated transcript reveal, tutorReply stays
  // empty until Rose's voice actually starts, which is exactly the
  // "thinking" window we want to surface.
  const thinkingNow =
    submitting && !tutorReply && !voice.state.transcribing;
  const liveHint =
    voiceNotice ??
    (voice.state.transcribing
      ? "Transcribing…"
      : thinkingNow
        ? "Thinking…"
        : voice.state.autoCapturing
          ? "Listening — I'll stop when you're done"
          : voice.state.recording
            ? "Listening — release M (or the mic) to send"
            : interactionMode === "voice" && voiceMode === "push"
              ? "Hold M to talk · or hold the mic button"
              : interactionMode === "voice" && voiceMode === "live"
                ? "Live mode — just start speaking"
                : null);

  // ---- branches that don't need the composer ----
  if (phase === "loading-session" || phase === "loading-plan") {
    return (
      <LessonPlanLoading
        courseTitle={course.title}
        moduleIdx={Math.max(moduleIdx, 0)}
        moduleCount={moduleCount}
        moduleTitle={activeModule.title}
        stage={phase === "loading-session" ? "session" : "plan"}
        topBar={topBar}
      />
    );
  }

  if (phase === "error") {
    return (
      <ImmersiveShell
        topBar={topBar}
        bottomBar={
          // No voice input on the error screen — render a slim decorative
          // strip with the idle waveform so the page still feels alive
          // without re-introducing the floating-mid-page overlap bug.
          <div className="pointer-events-none flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
            <div className="h-12 w-full max-w-md opacity-70">
              <AnimatedWaveform mode="idle" />
            </div>
          </div>
        }
      >
        <ProgressHeader
          courseTitle={course.title}
          moduleIdx={Math.max(moduleIdx, 0)}
          moduleCount={moduleCount}
          moduleTitle={activeModule.title}
        />
        <GlassPanel className="mt-8" tone="default">
          <p className="text-base font-semibold text-rose-700">
            Couldn&apos;t start Mentored Learning
          </p>
          <p className="mt-2 text-sm text-zinc-700">{error}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void loadSession()}
              className="rounded-full bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-400"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={onSwitchToFree}
              className="rounded-full border border-white/60 bg-white/60 px-4 py-1.5 text-xs font-medium text-zinc-700 hover:bg-white/80"
            >
              Switch to Free Exploration
            </button>
          </div>
        </GlassPanel>
        {showExitMenu ? (
          <ExitConfirm
            onClose={() => setShowExitMenu(false)}
            onSwitchToFree={onSwitchToFree}
            onExit={onExit}
          />
        ) : null}
      </ImmersiveShell>
    );
  }

  if (phase === "welcome-back" && session) {
    return (
      <ImmersiveShell
        topBar={topBar}
        bottomBar={
          <div className="pointer-events-none flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
            <div className="h-12 w-full max-w-md opacity-80">
              <AnimatedWaveform mode={waveformMode} />
            </div>
          </div>
        }
      >
        <ProgressHeader
          courseTitle={course.title}
          moduleIdx={Math.max(moduleIdx, 0)}
          moduleCount={moduleCount}
          moduleTitle={activeModule.title}
        />
        <GlassPanel className="mt-8" tone="reply" delayMs={100}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fuchsia-600">
            Welcome back
          </p>
          <p className="mt-3 text-base leading-relaxed text-zinc-800">
            <TypewriterText
              // Prefer the freshly-generated greeting once it lands —
              // it's tailored to this session and matches the audio
              // the student is hearing. Fall back to the saved recap
              // (or a default) while we wait for the greeting fetch.
              key={tutorReply ? "greeting" : "recap"}
              text={tutorReply ?? session.lastRecap ?? "Welcome back."}
              wordIntervalMs={55}
            />
          </p>
          <p className="mt-3 text-sm text-zinc-600">
            Want me to pick up from there, or would you rather skim the section
            yourself?
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resumeFromRecap}
              className="rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-md hover:bg-fuchsia-400"
            >
              Resume
            </button>
            <button
              type="button"
              onClick={onSwitchToFree}
              className="rounded-full border border-white/60 bg-white/60 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-white/80"
            >
              Just let me read
            </button>
          </div>
        </GlassPanel>
        {showExitMenu ? (
          <ExitConfirm
            onClose={() => setShowExitMenu(false)}
            onSwitchToFree={onSwitchToFree}
            onExit={onExit}
          />
        ) : null}
      </ImmersiveShell>
    );
  }

  if (phase === "module-complete") {
    const hasNext = moduleIdx + 1 < moduleCount;
    return (
      <ImmersiveShell
        topBar={topBar}
        bottomBar={
          <div className="pointer-events-none flex justify-center pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
            <div className="h-12 w-full max-w-md opacity-80">
              <AnimatedWaveform mode={waveformMode} />
            </div>
          </div>
        }
      >
        <ProgressHeader
          courseTitle={course.title}
          moduleIdx={Math.max(moduleIdx, 0)}
          moduleCount={moduleCount}
          moduleTitle={activeModule.title}
        />
        <GlassPanel className="mt-8" tone="reply">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Section complete
          </p>
          <h3 className="mt-2 text-xl font-semibold text-zinc-900">
            Nice — that wraps up &quot;{activeModule.title}&quot;
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-zinc-700">
            {tutorReply ? (
              <TypewriterText text={tutorReply} wordIntervalMs={55} />
            ) : (
              "How are you feeling about what we just covered? Head into the next section when you're ready."
            )}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {hasNext ? (
              <button
                type="button"
                onClick={() => void goToNextModule()}
                className="rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-md hover:bg-fuchsia-400"
              >
                Next section →
              </button>
            ) : (
              <span className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-semibold text-white">
                You finished the course
              </span>
            )}
            <button
              type="button"
              onClick={onSwitchToFree}
              className="rounded-full border border-white/60 bg-white/60 px-5 py-2 text-sm font-medium text-zinc-700 hover:bg-white/80"
            >
              Review on my own
            </button>
          </div>
        </GlassPanel>
        {showExitMenu ? (
          <ExitConfirm
            onClose={() => setShowExitMenu(false)}
            onSwitchToFree={onSwitchToFree}
            onExit={onExit}
          />
        ) : null}
      </ImmersiveShell>
    );
  }

  if (!plan || !chunk) {
    return (
      <ImmersiveShell topBar={topBar}>
        <GlassPanel className="mt-8" tone="subtle">
          <p className="text-center text-sm text-zinc-600">
            Lesson plan unavailable.
          </p>
        </GlassPanel>
      </ImmersiveShell>
    );
  }

  // ----- main teaching view -----
  // Voice controls (toggle, textarea, submit, mic) and the waveform now
  // live in a real docked bar pinned to the bottom of the viewport so
  // they can't overlap the Concept / Source / Quick Check cards. The
  // dock is full-bleed (edge-to-edge background) with the actual
  // controls centered to max-w-3xl so they line up with the lesson
  // content above.
  const voiceDockActive =
    voice.state.recording || voice.state.speaking || voice.state.transcribing;
  return (
    <ImmersiveShell
      topBar={topBar}
      bottomBar={
        <div className="immersive-dock border-t border-white/70 bg-white/85 shadow-[0_-12px_28px_-18px_rgba(60,60,90,0.20)] backdrop-blur-md">
          <div className="mx-auto w-full max-w-3xl px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-6 sm:pt-3">
            {/* Mini activity row above the controls. The waveform is a
                FIXED-WIDTH, overflow-clipped slot — using flex-1 here
                let it (and its glow filter) bleed across the toggle
                and textarea below it. Status pill (Listening /
                Transcribing / Thinking) sits to its right. The whole
                row collapses to height 0 when idle so the dock isn't
                taller than it needs to be. */}
            <div
              className={
                voiceDockActive || liveHint
                  ? "mb-1.5 flex items-center justify-center gap-3 transition-[height,opacity] duration-200"
                  : "h-0 overflow-hidden opacity-0 transition-[height,opacity] duration-200"
              }
              aria-hidden={!voiceDockActive && !liveHint}
            >
              <div className="h-5 w-32 shrink-0 overflow-hidden opacity-80">
                <AnimatedWaveform mode={waveformMode} />
              </div>
              {liveHint ? (
                <span className="shrink-0 rounded-full bg-white/70 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700 ring-1 ring-white/60">
                  {liveHint}
                </span>
              ) : null}
            </div>

            <AnswerComposer
              interactionMode={interactionMode}
              voiceMode={voiceMode}
              onVoiceModeChange={setVoiceMode}
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
          </div>
        </div>
      }
    >
      <ProgressHeader
        courseTitle={course.title}
        moduleIdx={Math.max(moduleIdx, 0)}
        moduleCount={moduleCount}
        moduleTitle={activeModule.title}
      />

      {/* Concept + explanation */}
      <GlassPanel key={`exp-${chunk.id}`} className="mt-8" tone="default">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Concept
            </p>
            <h3 className="mt-1 text-xl font-semibold text-zinc-900">
              {chunk.concept}
            </h3>
          </div>
          <button
            type="button"
            onClick={() =>
              void voice.speak(`${chunk.explanation}\n\n${chunk.checkQuestion}`)
            }
            className={
              voice.state.speaking
                ? "rounded-full bg-fuchsia-500/15 px-3 py-1 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-300/40"
                : "rounded-full border border-white/60 bg-white/60 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-white/80"
            }
          >
            <span className={voice.state.speaking ? "animate-pulse" : ""}>
              ●{" "}
            </span>
            {voice.state.speaking
              ? "Speaking…"
              : interactionMode === "voice"
                ? "Replay"
                : "Hear it"}
          </button>
        </div>
        <p className="mt-4 text-base leading-relaxed text-zinc-800">
          <TypewriterText
            key={`exp-text-${chunk.id}`}
            text={chunk.explanation}
            wordIntervalMs={45}
          />
        </p>
      </GlassPanel>

      {/* Source lesson with glowing key terms — anchors the chunk to the
          original course material so the student sees where the AI is
          drawing from. Hidden when the chunk has no source mapping or no
          extractable key terms. */}
      {(() => {
        const lessonIdx =
          typeof chunk.sourceLessonIndex === "number"
            ? chunk.sourceLessonIndex
            : null;
        const lesson =
          lessonIdx != null ? activeModule.lessons[lessonIdx] : undefined;
        if (!lesson) return null;
        const terms = chunk.keyTerms ?? [];
        return (
          <SourceLessonPanel
            key={`src-${chunk.id}`}
            lesson={lesson}
            keyTerms={terms}
          />
        );
      })()}

      {/* Check question */}
      <GlassPanel
        key={`q-${chunk.id}`}
        className="mt-4"
        tone="question"
        delayMs={350}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700">
          Quick check
        </p>
        <p className="mt-2 text-base font-medium leading-relaxed text-zinc-900">
          <TypewriterText
            key={`q-text-${chunk.id}`}
            text={chunk.checkQuestion}
            wordIntervalMs={50}
          />
        </p>
      </GlassPanel>

      {tutorReply ? (
        <GlassPanel
          key={`reply-${tutorReply.slice(0, 16)}`}
          className="mt-4"
          tone="reply"
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fuchsia-700">
            Tutor
          </p>
          <p className="mt-2 text-base leading-relaxed text-zinc-800">
            <TypewriterText text={tutorReply} wordIntervalMs={45} />
          </p>
        </GlassPanel>
      ) : null}

      {attempts >= 3 ? (
        <p className="mt-3 text-center text-xs italic text-amber-700">
          You&apos;re on attempt {attempts + 1}. We can come back to this one —
          try once more or just say &quot;move on&quot;.
        </p>
      ) : null}

      {showExitMenu ? (
        <ExitConfirm
          onClose={() => setShowExitMenu(false)}
          onSwitchToFree={onSwitchToFree}
          onExit={onExit}
        />
      ) : null}
    </ImmersiveShell>
  );
}

// ===========================================================================
// Pieces
// ===========================================================================

function ProgressHeader({
  courseTitle,
  moduleIdx,
  moduleCount,
  moduleTitle,
}: {
  courseTitle: string;
  moduleIdx: number;
  moduleCount: number;
  moduleTitle: string;
}) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
        {courseTitle} · Section {moduleIdx + 1} of {moduleCount}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl">
        {moduleTitle}
      </h1>
    </div>
  );
}

function AnswerComposer({
  interactionMode,
  voiceMode,
  onVoiceModeChange,
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
  voiceMode: "push" | "live";
  onVoiceModeChange: (mode: "push" | "live") => void;
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
  // In live mode the mic is handled by the auto-listen effect; the manual
  // hold-to-talk button only makes sense in push mode. We still keep the
  // textarea so the student can fall back to typing whenever they like.
  const showMicButton = interactionMode === "voice" && voiceMode === "push";
  const showModeToggle = interactionMode === "voice";

  // No floating-card styling here — the composer lives INSIDE the docked
  // bottom bar, which owns the bg / border / shadow. We just lay out the
  // controls horizontally: toggle (left) | textarea (center, flex-1) |
  // submit + mic (right). On narrow screens the row wraps so the textarea
  // never gets squeezed below readable width.
  return (
    <div>
      <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
        {showModeToggle ? (
          <div
            className="inline-flex items-stretch rounded-2xl border border-white/60 bg-white/55 p-0.5 text-[11px] font-medium text-zinc-700 shadow-sm"
            role="group"
            aria-label="Voice mic mode"
          >
            <button
              type="button"
              onClick={() => onVoiceModeChange("push")}
              aria-pressed={voiceMode === "push"}
              className={
                voiceMode === "push"
                  ? "rounded-xl bg-zinc-900/90 px-3 py-1.5 text-white shadow-sm"
                  : "rounded-xl px-3 py-1.5 text-zinc-700 hover:bg-white/70"
              }
            >
              Hold&nbsp;M
            </button>
            <button
              type="button"
              onClick={() => onVoiceModeChange("live")}
              aria-pressed={voiceMode === "live"}
              className={
                voiceMode === "live"
                  ? "rounded-xl bg-zinc-900/90 px-3 py-1.5 text-white shadow-sm"
                  : "rounded-xl px-3 py-1.5 text-zinc-700 hover:bg-white/70"
              }
            >
              Live
            </button>
          </div>
        ) : null}

        <textarea
          rows={1}
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
              ? voiceMode === "live"
                ? "Speak whenever — or type here…"
                : "Hold M (or the mic) to speak · or type here…"
              : "Type your answer (⌘↵ to submit)…"
          }
          className="block min-h-[2.5rem] flex-1 resize-none rounded-2xl border border-white/60 bg-white/70 px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-500 focus:border-fuchsia-300 focus:bg-white/90 focus:outline-none focus:ring-2 focus:ring-fuchsia-200/60"
        />

        <div className="flex shrink-0 items-stretch gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={onSubmitText}
            className="rounded-2xl bg-zinc-900/90 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Sending…" : "Submit"}
          </button>
          {showMicButton ? (
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
                  ? "ac-pulse-ring rounded-2xl bg-rose-500/95 px-4 py-2 text-sm font-semibold text-white shadow-lg"
                  : "rounded-2xl border border-white/60 bg-white/70 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-white/90 disabled:opacity-50"
              }
              title={
                recording ? "Release to send" : "Hold to talk (or press & hold M)"
              }
            >
              {transcribing
                ? "Transcribing…"
                : recording
                  ? "● Release"
                  : "🎤 Hold"}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="mt-1 px-1 text-xs text-rose-600">{error}</p>
      ) : null}
      <style jsx>{`
        .ac-pulse-ring {
          box-shadow:
            0 0 0 0 rgba(244, 63, 94, 0.55),
            0 10px 20px -8px rgba(244, 63, 94, 0.45);
          animation: ac-pulse-ring 1.1s ease-out infinite;
        }
        @keyframes ac-pulse-ring {
          0% {
            box-shadow:
              0 0 0 0 rgba(244, 63, 94, 0.55),
              0 10px 20px -8px rgba(244, 63, 94, 0.45);
          }
          70% {
            box-shadow:
              0 0 0 10px rgba(244, 63, 94, 0),
              0 10px 20px -8px rgba(244, 63, 94, 0.35);
          }
          100% {
            box-shadow:
              0 0 0 0 rgba(244, 63, 94, 0),
              0 10px 20px -8px rgba(244, 63, 94, 0.45);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .ac-pulse-ring {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function ExitConfirm({
  onClose,
  onSwitchToFree,
  onExit,
}: {
  onClose: () => void;
  onSwitchToFree: () => void;
  onExit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-zinc-900/15 backdrop-blur-sm">
      <GlassPanel className="w-full max-w-sm" tone="default">
        <p className="text-lg font-semibold text-zinc-900">
          Leave Mentored Learning?
        </p>
        <p className="mt-2 text-sm text-zinc-700">
          Your progress is saved — you can resume anytime.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSwitchToFree}
            className="rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white hover:bg-fuchsia-400"
          >
            Switch to Free Exploration
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full border border-white/60 bg-white/60 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-white/80"
          >
            Exit course
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-zinc-600 hover:text-zinc-900"
          >
            Stay here
          </button>
        </div>
      </GlassPanel>
    </div>
  );
}
