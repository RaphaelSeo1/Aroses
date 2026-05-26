"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatedWaveform } from "@/components/immersive/AnimatedWaveform";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";
import { LessonPlanLoading } from "@/components/immersive/LessonPlanLoading";
import {
  NotesPanel,
  type NoteSuggestion,
  type NotesPanelHandle,
} from "@/components/immersive/NotesPanel";
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
import { autoGenLog, autoGenLogError } from "@/lib/mentored/auto-generate-log";
import { buildAutoNotesFromChunk } from "@/lib/mentored/build-auto-notes";
import { useMinWidth } from "@/hooks/use-min-width";

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

  // ---- playback speed (Rose's voice) — declared up here so it can
  //      be passed into `useMentoredVoice` below.
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const raw = window.localStorage.getItem("rose:playbackRate");
    const n = raw ? Number.parseFloat(raw) : NaN;
    if (!Number.isFinite(n)) return 1;
    return Math.min(1.5, Math.max(0.5, n));
  });
  const updatePlaybackRate = useCallback((next: number) => {
    const clamped = Math.min(1.5, Math.max(0.5, next));
    setPlaybackRate(clamped);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("rose:playbackRate", String(clamped));
      } catch {
        /* localStorage disabled — preference just won't persist */
      }
    }
  }, []);

  /** Returning students must tap Continue before Rose starts the lesson. */
  const [awaitingContinue, setAwaitingContinue] = useState(false);
  const awaitingContinueRef = useRef(false);
  useEffect(() => {
    awaitingContinueRef.current = awaitingContinue;
  }, [awaitingContinue]);

  const voice = useMentoredVoice({
    materialId,
    onBargeIn: () => onBargeInRef.current(),
    playbackRate,
    // Barge-in (VAD on the mic while Rose is speaking) is ONLY safe
    // in live mode. In push-to-talk mode the student presses M to
    // talk — leaving the mic always-on monitor running causes Rose
    // to "hear" room noise / her own playback bleed and respond to
    // nothing. Gate the entire monitor on voice mode.
    bargeInEnabled: voiceMode === "live" && !awaitingContinue,
  });
  const lastSpokenChunkIdRef = useRef<string | null>(null);
  const recordPromiseRef = useRef<Promise<Blob | null> | null>(null);

  // ---- interruption tracking ----
  // The most recent text Rose has ACTUALLY spoken aloud (and the
  // student has heard) up to this instant. Updated as each streamed
  // sentence's audio starts playing. When the student barges in, we
  // snapshot this and pass it to the next turn so Rose knows where
  // she was cut off and can resume contextually instead of starting
  // her explanation over.
  const lastSpokenRef = useRef<string>("");
  const [interruptedContext, setInterruptedContext] = useState<string | null>(
    null
  );

  // ---- smart question timing (§4) ----
  // Timestamps drive the pacing signals we pass into Rose's turn
  // prompt so she can decide whether a check question is appropriate
  // this turn. Both are refs (not state) — the only consumer is the
  // submit handler, no render needs to react to them.
  const lastCheckAtRef = useRef<number | null>(null);
  const lastStudentSpokeAtRef = useRef<number | null>(null);

  // ---- walk-through narration (§1) ----
  // The single most recent sentence Rose has spoken aloud. Drives
  // SourceLessonPanel's paragraph highlight + auto-scroll so the
  // student visually sees which part of the source Rose is
  // currently paraphrasing. We use state (not a ref) so the panel
  // re-renders when it changes; the panel is memo'd so other state
  // changes don't trigger unnecessary work here.
  const [narrationText, setNarrationText] = useState<string>("");

  // ---- on-demand image (§9) ----
  // The current Mentored Learning image (set when Rose's turn meta
  // included an imageRequest OR the student asked for one via a
  // keyword phrase like "show me X"). Renders above the lesson
  // cards; clears when the chunk advances.
  const [mentoredImage, setMentoredImage] = useState<{
    url: string;
    thumbUrl: string;
    sourceUrl: string;
    attribution: string;
    type: "diagram" | "photo" | "illustration";
  } | null>(null);
  const [mentoredImageLoading, setMentoredImageLoading] = useState(false);
  const fetchMentoredImage = useCallback(
    async (query: string, type: "diagram" | "photo" | "illustration") => {
      if (!query || query.trim().length < 3) return;
      setMentoredImageLoading(true);
      try {
        const res = await fetch("/api/mentored/image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ materialId, query, imageType: type }),
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          image: {
            url: string;
            thumbUrl: string;
            sourceUrl: string;
            attribution: string;
            type: "diagram" | "photo" | "illustration";
          } | null;
        };
        if (body.image) setMentoredImage(body.image);
      } catch (e) {
        console.error("[imm runner fetchMentoredImage]", e);
      } finally {
        setMentoredImageLoading(false);
      }
    },
    [materialId]
  );

  // ---- notes panel (§2) ----
  // The "seed" suggestion for the current chunk is derived from the
  // chunk's concept + first key point. We don't store the suggestion
  // in state — it's a pure function of the chunk + which ids the
  // student has already consumed/dismissed.
  const [consumedSuggestionIds, setConsumedSuggestionIds] = useState<
    Set<string>
  >(() => new Set());
  const [autoGenerateNotes, setAutoGenerateNotes] = useState(false);
  const [notesDrawerOpen, setNotesDrawerOpen] = useState(false);
  const notesPanelRef = useRef<NotesPanelHandle | null>(null);
  const notesAppendedChunkRef = useRef<string | null>(null);
  const [notesEditorReady, setNotesEditorReady] = useState(false);
  const onNotesEditorReady = useCallback(() => {
    autoGenLog("parent: notes editor hydrated and ready");
    setNotesEditorReady(true);
  }, []);
  const showDockedNotes = useMinWidth(1280);

  // When the student toggles auto-generate OFF→ON we clear the
  // "already appended for chunk X" guard so the current chunk gets
  // re-emitted. Without this, deleting an auto-generated block and
  // flipping the toggle off + on appears to do nothing (the effect
  // sees the ref still says "appended", returns early). This wrapper
  // is what we pass down to NotesPanel as `onAutoGenerateChange`.
  const handleAutoGenerateChange = useCallback((next: boolean) => {
    autoGenLog("parent: autoGenerate state change", { next });
    setAutoGenerateNotes((prev) => {
      if (next && !prev) notesAppendedChunkRef.current = null;
      return next;
    });
  }, []);

  useEffect(() => {
    autoGenLog("parent: material changed — resetting notes editor ready");
    setNotesEditorReady(false);
    notesAppendedChunkRef.current = null;
  }, [materialId]);

  useEffect(() => {
    if (awaitingContinue) setNotesDrawerOpen(false);
  }, [awaitingContinue]);

  const showNotesPanel = !awaitingContinue && phase === "teaching";

  useEffect(() => {
    if (!showNotesPanel) {
      setNotesEditorReady(false);
    }
  }, [showNotesPanel]);

  // ---- session opening greeting ----
  // Plays once per mount, the moment the runner has a session loaded.
  // `greetingPlayed` gates the auto-speak-chunk effect so the chunk
  // doesn't talk over the welcome line.
  const [greetingPlayed, setGreetingPlayed] = useState(false);
  const greetingFiredRef = useRef(false);

  // ---- question popup (the centered "Rose asks" modal) ----
  //
  // Three independent states drive the popup lifecycle:
  //
  //   • `questionAudioStartedFor` — set to the chunk id at the
  //     instant Rose actually begins speaking the check question
  //     aloud. The popup waits for THIS, not for chunk arrival,
  //     so the question lands on screen synchronously with Rose's
  //     voice instead of jumping up while she's still explaining.
  //
  //   • `questionPopupDismissedFor` — chunk id whose popup the
  //     student × dismissed. Stays hidden until the next chunk.
  //
  //   • `questionPopupMinimized` — when true the popup is rendered
  //     as a chip in the top-right corner (with no backdrop dim)
  //     instead of the full centered modal. Lets the student step
  //     away to read notes / source transcript without losing the
  //     question entirely; tapping the chip re-expands.
  //
  // All three reset to "fresh" when the chunk id changes (open is
  // keyed off chunk.id, the audio-started ref clears in the speak
  // effect's setup, dismissed/minimized reset in a cleanup effect
  // below).
  const [questionAudioStartedFor, setQuestionAudioStartedFor] = useState<
    string | null
  >(null);
  const [questionPopupDismissedFor, setQuestionPopupDismissedFor] = useState<
    string | null
  >(null);
  const [questionPopupMinimized, setQuestionPopupMinimized] = useState(false);


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

      const storedModuleId =
        typeof body.session?.moduleId === "number" && body.session.moduleId > 0
          ? body.session.moduleId
          : null;
      const moduleMatches =
        storedModuleId != null && storedModuleId === activeModule.id;

      if (body.session && moduleMatches) {
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
      } else if (body.session && storedModuleId == null) {
        // Legacy rows used module_id=0 — resume module position but not chunk.
        setChunkIdx(0);
        setAttempts(0);
        setPlan(null);
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

  const progressRef = useRef({ moduleId: activeModule.id, chunkIdx: 0 });
  progressRef.current = { moduleId: activeModule.id, chunkIdx };

  // Keep session row in sync with the module the student is on.
  useEffect(() => {
    if (phase === "loading-session" || phase === "error") return;
    void persist({ moduleId: activeModule.id });
  }, [activeModule.id, materialId, persist, phase]);

  useEffect(() => {
    return () => {
      const { moduleId, chunkIdx: chunkIndex } = progressRef.current;
      fetch(`/api/mentored/session/${materialId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId, chunkIndex }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [materialId]);

  const chunk: MentoredLessonChunk | null = plan?.chunks[chunkIdx] ?? null;
  const moduleCount = course.modules.length;
  const moduleIdx = course.modules.findIndex((m) => m.id === activeModule.id);

  const lessonKeyTerms = useMemo(() => {
    if (!chunk) return activeModule.lessons.flatMap((l) => l.key_terms ?? []);
    const idx = chunk.sourceLessonIndex;
    if (typeof idx === "number" && activeModule.lessons[idx]) {
      return activeModule.lessons[idx].key_terms ?? [];
    }
    return activeModule.lessons.flatMap((l) => l.key_terms ?? []);
  }, [activeModule.lessons, chunk]);

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

    // Welcome-back uses its own Resume panel first; greeting runs after
    // the student taps Resume (see resumeFromRecap).
    if (phase === "welcome-back") {
      return;
    }

    greetingFiredRef.current = true;

    // True first-time signal: either no session row exists OR the
    // session row is brand new (no history entries AND chunk index
    // still at 0). We deliberately do NOT treat `moduleIdx > 0` as
    // "returning" — the resume-target helper can land a student in
    // module 2 from outside (e.g. deep-link) without them having
    // actually completed module 1. The canonical signal is the
    // `history` array, which only gets appended when the student
    // finishes a chunk.
    const history = session?.history ?? [];
    const touchedModuleIds = new Set(history.map((h) => h.moduleId));
    const allComplete =
      moduleCount > 0 && touchedModuleIds.size >= moduleCount;
    const isFirstTime =
      session === null ||
      (history.length === 0 && (session.chunkIndex ?? 0) === 0);
    const scenario: "first_time" | "returning" | "all_complete" = allComplete
      ? "all_complete"
      : isFirstTime
        ? "first_time"
        : "returning";

    const needsAcknowledgement =
      scenario === "returning" || scenario === "all_complete";
    if (needsAcknowledgement) {
      awaitingContinueRef.current = true;
      setAwaitingContinue(true);
      lastSpokenChunkIdRef.current = null;
    }

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

      const needsAcknowledgement =
        scenario === "returning" || scenario === "all_complete";

      if (interactionMode === "voice") {
        try {
          await voice.speak(text, {
            onPlay: () => {
              setTutorReply(text);
              lastSpokenRef.current = text;
            },
          });
        } catch (e) {
          console.error("[imm runner greeting speak]", e);
          setTutorReply((prev) => prev ?? text);
        }
      } else {
        setTutorReply(text);
        lastSpokenRef.current = text;
      }

      // Returning / all-complete: Continue button. First-time: auto-start.
      if (needsAcknowledgement) {
        /* keep greetingPlayed false until Continue */
      } else {
        setGreetingPlayed(true);
      }
    })();
    // We deliberately exclude `voice` / `course` / module-derived deps —
    // this should fire EXACTLY once per mount based on initial readiness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, plan, session]);

  const appendAutoNotesForChunk = useCallback(
    (opts?: { enabledOverride?: boolean; skipDedupe?: boolean }) => {
      const enabled = opts?.enabledOverride ?? autoGenerateNotes;
      const state = {
        enabled,
        autoGenerateNotes,
        phase,
        chunkId: chunk?.id ?? null,
        awaitingContinue: awaitingContinueRef.current,
        notesEditorReady,
        hasPanelRef: !!notesPanelRef.current,
        appendedChunkRef: notesAppendedChunkRef.current,
      };
      autoGenLog("appendAutoNotesForChunk called", state);

      if (!chunk || phase !== "teaching") {
        autoGenLog("append aborted — not in teaching or no chunk", state);
        return;
      }
      if (awaitingContinueRef.current) {
        autoGenLog("append aborted — awaitingContinue", state);
        return;
      }
      if (!enabled) {
        autoGenLog("append aborted — autoGenerate disabled", state);
        return;
      }
      if (!notesEditorReady || !notesPanelRef.current) {
        autoGenLog("append aborted — editor not ready or ref missing", state);
        return;
      }
      if (notesAppendedChunkRef.current === chunk.id) {
        autoGenLog("append aborted — chunk already appended", state);
        return;
      }

      const block = buildAutoNotesFromChunk(chunk, lessonKeyTerms);
      if (!block) {
        autoGenLog("append aborted — no structured note content", {
          keyPoints: chunk.keyPoints,
          concept: chunk.concept,
        });
        return;
      }

      const appended = notesPanelRef.current.appendBlock({
        ...block,
        skipDedupe: opts?.skipDedupe,
      });
      autoGenLog("appendBlock returned", { appended, chunkId: chunk.id });
      if (appended) notesAppendedChunkRef.current = chunk.id;
    },
    [autoGenerateNotes, chunk, lessonKeyTerms, notesEditorReady, phase]
  );

  const handleAutoGenerateUserToggle = useCallback(
    (next: boolean) => {
      autoGenLog("user toggle — triggering append", { next });
      if (next) {
        notesAppendedChunkRef.current = null;
        appendAutoNotesForChunk({ enabledOverride: true, skipDedupe: true });
      }
    },
    [appendAutoNotesForChunk]
  );

  // ----- auto-speak fresh chunk -----
  // Held back until the greeting is done so the tutor doesn't talk over
  // itself. Once the greeting finishes (or text mode skips it), this
  // takes over and speaks the chunk's explanation + check question.
  // ---- notes suggestion (§2) — pure derivation, no setState in effect.
  // The seed is `null` when there's no useful text to suggest, OR
  // when the student has already consumed it.
  const noteSuggestions = useMemo<NoteSuggestion[]>(() => {
    if (!chunk || phase !== "teaching") return [];
    const heading = chunk.concept;
    const firstKeyPoint = chunk.keyPoints[0]?.trim();
    const text =
      firstKeyPoint && firstKeyPoint.length > 0
        ? firstKeyPoint
        : chunk.explanation.split(/(?<=[.!?])\s+/)[0]?.trim() ?? "";
    if (!text) return [];
    const id = `s-${chunk.id}`;
    if (consumedSuggestionIds.has(id)) return [];
    return [{ id, heading, text }];
  }, [chunk, phase, consumedSuggestionIds]);

  useEffect(() => {
    appendAutoNotesForChunk();
  }, [appendAutoNotesForChunk]);

  useEffect(() => {
    setQuestionPopupDismissedFor(null);
    setQuestionPopupMinimized(false);
    setQuestionAudioStartedFor(null);
  }, [chunk?.id]);

  useEffect(() => {
    if (phase !== "teaching") return;
    if (!chunk) return;
    if (interactionMode !== "voice") return;
    if (!greetingPlayed) return;
    if (awaitingContinueRef.current) return;
    if (lastSpokenChunkIdRef.current === chunk.id) return;
    lastSpokenChunkIdRef.current = chunk.id;

    if (questionAudioStartedFor !== chunk.id) {
      setQuestionAudioStartedFor(null);
      setQuestionPopupMinimized(false);
    }

    const explanation = chunk.explanation;
    const checkQuestion = chunk.checkQuestion;
    const captured = chunk.id;

    void (async () => {
      await voice.speak(explanation, {
        onPlay: () => {
          lastSpokenRef.current = explanation;
          setNarrationText(explanation);
        },
      });
      if (lastSpokenChunkIdRef.current !== captured) return;
      await voice.speak(checkQuestion, {
        onPlay: () => {
          lastSpokenRef.current = `${explanation}\n\n${checkQuestion}`;
          lastCheckAtRef.current = Date.now();
          setQuestionAudioStartedFor(captured);
        },
      });
    })();
  }, [awaitingContinue, chunk, interactionMode, phase, voice, greetingPlayed]);

  // Text mode: show the check-question popup as soon as the chunk is
  // active (no TTS onPlay hook to drive it).
  useEffect(() => {
    if (phase !== "teaching") return;
    if (!chunk) return;
    if (interactionMode !== "text") return;
    if (!greetingPlayed) return;
    if (awaitingContinueRef.current) return;
    setQuestionAudioStartedFor(chunk.id);
    setQuestionPopupMinimized(false);
  }, [
    awaitingContinue,
    chunk,
    chunk?.id,
    greetingPlayed,
    interactionMode,
    phase,
  ]);

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
      if (awaitingContinueRef.current) return;
      if (!chunk || !plan) return;
      const text = utterance.trim();

      // §9 — Detect explicit image requests in the student's
      // utterance and kick off the search BEFORE we wait on
      // Rose's reply. Two paths can result in an image:
      //   1. This client-side keyword match (fast, fires the
      //      moment the student submits).
      //   2. Rose's turn meta emitting an imageRequest (handled
      //      below when the stream meta event arrives).
      // Both paths POST to the same cached endpoint so a
      // duplicate request just hits the cache.
      const imgIntent = detectImageRequest(text);
      if (imgIntent) {
        void fetchMentoredImage(imgIntent.query, imgIntent.type);
      }
      if (text.length < 2) return;
      setSubmitting(true);
      setTutorReply("");
      // Snapshot + clear any pending interruption context so it only
      // applies to THIS turn (the one responding to the barge-in).
      const interruptedAfter = interruptedContext;
      if (interruptedAfter !== null) setInterruptedContext(null);

      // Compute pacing deltas for the smart question-timing prompt.
      // The student is submitting NOW so we update the "spoke at"
      // timestamp right away — but the value we send was sampled
      // BEFORE this update so the prompt sees the actual silence.
      const now = Date.now();
      const secondsSinceLastCheck =
        lastCheckAtRef.current != null
          ? (now - lastCheckAtRef.current) / 1000
          : null;
      const secondsSinceStudentSpoke =
        lastStudentSpokeAtRef.current != null
          ? (now - lastStudentSpokeAtRef.current) / 1000
          : null;
      lastStudentSpokeAtRef.current = now;

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
            // Optional: when the student cut Rose off mid-sentence,
            // this is what she had already said out loud. The
            // turn-stream / Claude prompt uses it to acknowledge
            // the interruption and offer to resume from there.
            interruptedAfter: interruptedAfter ?? undefined,
            secondsSinceLastCheck,
            secondsSinceStudentSpoke,
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
              // §9 — Rose's turn included an explicit image request.
              // Kick the search off in parallel with the rest of the
              // response (we don't await — image arrives when ready).
              const ir = (ev as { imageRequest?: { query?: string; type?: string } })
                .imageRequest;
              if (ir && typeof ir.query === "string") {
                const t =
                  ir.type === "diagram" || ir.type === "photo"
                    ? ir.type
                    : "illustration";
                void fetchMentoredImage(ir.query, t);
              }
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
            onSentencePlaying: (text, index) => {
              if (index < revealedUpTo) return;
              revealedUpTo = index + 1;
              const spoken = sentences.slice(0, revealedUpTo).join(" ");
              setTutorReply(spoken);
              // Keep the "what Rose has said out loud" snapshot
              // current — used as `interruptedAfter` if the student
              // barges in next.
              lastSpokenRef.current = spoken;
              // Walk-through highlight: the SOURCE panel highlights
              // the paragraph closest to whatever Rose is saying
              // RIGHT NOW. Use the latest sentence (not the running
              // total) so the match doesn't dilute across sentences.
              setNarrationText(text);
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

        // Safety net for "Rose asks a question then advances anyway".
        // Claude sometimes flags advance:true on a turn that ends
        // with a question to the student ("want to keep going?",
        // "should we move on?", "got it?"). When that happens we
        // suppress the advance so the student actually gets to
        // answer — they say yes (next turn → advance) or no (next
        // turn → stay + cover what they asked about). Heuristic is
        // simple on purpose: trailing "?" is a strong, reliable
        // signal that Rose is waiting on input.
        const finalSpokenText = sentences.join(" ").trim();
        if (finalAdvance && /\?\s*["')\]]*\s*$/.test(finalSpokenText)) {
          finalAdvance = false;
        }

        if (finalAdvance) {
          const nextIdx = chunkIdx + 1;
          setChunkIdx(nextIdx);
          setAttempts(0);
          setAnswerText("");
          // Clear walk-through highlight + tutor reply so the new
          // chunk starts visually fresh. Same for the on-demand
          // image — each new chunk gets its own visual context.
          setNarrationText("");
          setTutorReply(null);
          setMentoredImage(null);
          setMentoredImageLoading(false);

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
      fetchMentoredImage,
      interactionMode,
      interruptedContext,
      materialId,
      onboarding.knowledgeLevel,
      persist,
      plan,
      voice,
    ]
  );

  // ----- voice input -----
  const startVoiceAnswer = useCallback(async () => {
    if (awaitingContinueRef.current) return;
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
  //
  // On fire we ALSO snapshot whatever Rose had already spoken out loud
  // (`lastSpokenRef.current`) so the next turn prompt can include it as
  // `interruptedAfter` — Rose then knows where she was cut off and can
  // acknowledge the interruption + offer to resume instead of restarting
  // the explanation cold.
  const handleBargeIn = useCallback(async () => {
    if (awaitingContinueRef.current) return;
    try {
      const spokenSoFar = lastSpokenRef.current.trim();
      if (spokenSoFar.length >= 8) {
        // Only mark as an "interruption" if Rose had said something
        // meaningful first. Otherwise the barge was just the student
        // speaking up before Rose started — no resume context needed.
        setInterruptedContext(spokenSoFar);
      }
      const blob = await voice.recordUntilSilence();
      if (!blob) {
        // No utterance captured — clear the interruption context so
        // the next genuine answer doesn't carry over stale "you cut
        // me off" framing.
        setInterruptedContext(null);
        return;
      }
      const text = await voice.transcribe(blob);
      if (!text) {
        setInterruptedContext(null);
        return;
      }
      setAnswerText(text);
      void submitAnswer(text);
    } catch (e) {
      console.error("[imm runner handleBargeIn]", e);
      setInterruptedContext(null);
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
    if (!greetingPlayed) return;
    if (awaitingContinueRef.current) return;
    if (voice.state.speaking) return;
    if (voice.state.recording) return;
    if (voice.state.transcribing) return;
    if (submitting) return;
    if (liveCycleGuardRef.current) return;
    // Hold the mic while the check question is on screen — room noise
    // shouldn't auto-submit an answer before the student is ready.
    if (
      chunk &&
      questionAudioStartedFor === chunk.id &&
      attempts === 0 &&
      questionPopupDismissedFor !== chunk.id
    ) {
      return;
    }
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
    attempts,
    awaitingContinue,
    chunk,
    greetingPlayed,
    interactionMode,
    phase,
    questionAudioStartedFor,
    questionPopupDismissedFor,
    submitAnswer,
    submitting,
    voice,
    voice.state.recording,
    voice.state.speaking,
    voice.state.transcribing,
    voiceMode,
  ]);

  const resumeFromRecap = useCallback(() => {
    greetingFiredRef.current = false;
    setGreetingPlayed(false);
    awaitingContinueRef.current = false;
    setAwaitingContinue(false);
    setTutorReply(null);
    lastSpokenChunkIdRef.current = null;
    voice.cancelSpeak();
    setPhase("loading-plan");
  }, [voice]);

  const acknowledgeAndContinue = useCallback(() => {
    awaitingContinueRef.current = false;
    setAwaitingContinue(false);
    setGreetingPlayed(true);
    lastSpokenChunkIdRef.current = null;
    voice.cancelSpeak();
  }, [voice]);

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
      <SpeedControl
        rate={playbackRate}
        onChange={updatePlaybackRate}
        // Hide when the student is in text-only mode — speed only
        // affects Rose's voice and would be confusing otherwise.
        hidden={interactionMode !== "voice"}
      />
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
              ? "Press and hold M or the mic button to speak"
              : interactionMode === "voice" && voiceMode === "live"
                ? "Live mode — just start speaking"
                : null);

  // ---- branches that don't need the composer ----
  if (phase === "loading-session" || phase === "loading-plan") {
    return (
      <>
        <LessonPlanLoading
          courseTitle={course.title}
          moduleIdx={Math.max(moduleIdx, 0)}
          moduleCount={moduleCount}
          moduleTitle={activeModule.title}
          stage={phase === "loading-session" ? "session" : "plan"}
          topBar={topBar}
          onRequestExit={() => setShowExitMenu(true)}
        />
        {showExitMenu ? (
          <ExitConfirm
            onClose={() => setShowExitMenu(false)}
            onSwitchToFree={onSwitchToFree}
            onExit={onExit}
          />
        ) : null}
      </>
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
      contentMaxWidth={showNotesPanel ? "wide" : "default"}
      bottomBar={
        awaitingContinue ? (
          <div className="border-t border-white/70 bg-white/85 px-4 py-3 text-center text-xs text-zinc-500 backdrop-blur-md">
            Tap <span className="font-semibold text-zinc-700">Continue lesson</span>{" "}
            above when you&apos;re ready — Rose will wait for you.
          </div>
        ) : (
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
        )
      }
    >
      <ProgressHeader
        courseTitle={course.title}
        moduleIdx={Math.max(moduleIdx, 0)}
        moduleCount={moduleCount}
        moduleTitle={activeModule.title}
      />

      {awaitingContinue ? (
        <GlassPanel className="mx-auto mt-6 max-w-2xl" tone="reply">
          <p className="text-sm leading-relaxed text-zinc-800">
            {tutorReply ??
              "Welcome back — let me know when you are ready and we will pick up from here."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={acknowledgeAndContinue}
              className="rounded-full bg-fuchsia-500 px-5 py-2 text-sm font-semibold text-white shadow-md hover:bg-fuchsia-400"
            >
              Continue lesson
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
      ) : null}

      {!awaitingContinue ? (
      <div
        className={`mt-2 grid grid-cols-1 gap-6 ${showNotesPanel ? "xl:grid-cols-2 xl:gap-8" : ""}`}
      >
        <div className="min-w-0">
      {!awaitingContinue && chunk ? (
        <>

      {/* §9 — On-demand image area. Renders when Rose has decided a
          visual would help OR the student explicitly asked for one
          ("show me a diagram of..."). Stays visible until the
          chunk advances. Loading skeleton matches the cloud aesthetic. */}
      {mentoredImageLoading || mentoredImage ? (
        <GlassPanel className="mt-6" tone="subtle">
          {mentoredImage ? (
            <figure className="overflow-hidden rounded-xl">
              <a
                href={mentoredImage.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open original on Wikimedia Commons"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mentoredImage.thumbUrl}
                  alt=""
                  className="block max-h-80 w-full object-contain bg-white"
                />
              </a>
              <figcaption className="mt-2 px-1 text-[11px] text-zinc-500">
                {mentoredImage.attribution}
              </figcaption>
            </figure>
          ) : (
            <div
              className="h-44 animate-pulse rounded-xl bg-gradient-to-br from-zinc-100/80 to-zinc-50/60"
              aria-busy="true"
              aria-label="Rose is sketching this out…"
            />
          )}
        </GlassPanel>
      ) : null}

      {/* Concept + explanation */}
      <GlassPanel key={`exp-${chunk.id}`} className="mt-6" tone="default">
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
            narrationText={narrationText}
          />
        );
      })()}

      {/* Check question — appears as a centered ad-style modal the
          MOMENT Rose's voice starts speaking the question (not when
          the chunk arrives). Dim backdrop is click-through so the
          student can scroll the lesson or jot notes through the dim.
          The student can also Minimize the popup to a chip in the
          top-right corner to fully reclaim the page; tap the chip to
          expand back to center. Auto-hides after submission or on ×
          dismiss. */}
      <QuestionCloud
        key={`q-cloud-${chunk.id}`}
        chunkId={chunk.id}
        text={chunk.checkQuestion}
        open={
          questionAudioStartedFor === chunk.id &&
          questionPopupDismissedFor !== chunk.id &&
          attempts === 0
        }
        minimized={questionPopupMinimized}
        onMinimize={() => setQuestionPopupMinimized(true)}
        onExpand={() => setQuestionPopupMinimized(false)}
        onDismiss={() => setQuestionPopupDismissedFor(chunk.id)}
        onRepeat={() =>
          void voice.speak(chunk.checkQuestion, {
            onPlay: () => {
              lastSpokenRef.current = chunk.checkQuestion;
              lastCheckAtRef.current = Date.now();
            },
          })
        }
      />

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
        </>
      ) : null}
        </div>

        {/* Right column — notes panel. Only one NotesPanel instance
            mounts at a time (docked xl+ OR mobile drawer) so the
            shared editorRef is never cleared by an unmounted twin. */}
        {showNotesPanel && showDockedNotes ? (
        <div className="hidden min-w-0 xl:block">
          <div className="sticky top-2">
                <NotesPanel
                  key="mentored-notes-panel"
                  materialId={materialId}
                  lessonTitle={activeModule.title}
                  courseTitle={course.title}
                  suggestions={noteSuggestions}
                  onConsumeSuggestion={(id) =>
                    setConsumedSuggestionIds((prev) => {
                      const next = new Set(prev);
                      next.add(id);
                      return next;
                    })
                  }
                  autoGenerate={autoGenerateNotes}
                  onAutoGenerateChange={handleAutoGenerateChange}
                  onAutoGenerateUserToggle={handleAutoGenerateUserToggle}
                  onEditorReady={onNotesEditorReady}
                  editorRef={notesPanelRef}
                  className="h-[calc(100vh-220px)] min-h-[34rem]"
                />
          </div>
        </div>
        ) : null}
      </div>
      ) : null}

      {/* Mobile / narrow-screen drawer — toggled by the floating
          button. Slides in from the right with a fade overlay so
          students on phones still get notes without losing the
          lesson focus. Uses fixed positioning + a high z-index so
          it sits above the dock but below ExitConfirm (z-30). */}
      {showNotesPanel ? (
      <button
        type="button"
        onClick={() => setNotesDrawerOpen(true)}
        className="fixed bottom-[140px] right-4 z-20 rounded-full border border-white/60 bg-white/85 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-md backdrop-blur-md transition hover:bg-white xl:hidden"
        aria-label="Open notes"
      >
        ✎ Notes
      </button>
      ) : null}
      {showNotesPanel && notesDrawerOpen && !showDockedNotes ? (
        <div className="fixed inset-0 z-30 flex xl:hidden">
          <button
            type="button"
            aria-label="Close notes"
            onClick={() => setNotesDrawerOpen(false)}
            className="flex-1 bg-black/30 backdrop-blur-sm"
          />
          <div className="flex h-full w-full max-w-md flex-col bg-white/90 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
              <h2 className="text-sm font-semibold">Your notes</h2>
              <button
                type="button"
                onClick={() => setNotesDrawerOpen(false)}
                className="rounded-full border border-zinc-200 px-3 py-1 text-xs"
              >
                Close
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3">
                  <NotesPanel
                    key="mentored-notes-panel"
                    materialId={materialId}
                    lessonTitle={activeModule.title}
                    courseTitle={course.title}
                    suggestions={noteSuggestions}
                    onConsumeSuggestion={(id) =>
                      setConsumedSuggestionIds((prev) => {
                        const next = new Set(prev);
                        next.add(id);
                        return next;
                      })
                    }
                    autoGenerate={autoGenerateNotes}
                    onAutoGenerateChange={handleAutoGenerateChange}
                    onAutoGenerateUserToggle={handleAutoGenerateUserToggle}
                    onEditorReady={onNotesEditorReady}
                    editorRef={notesPanelRef}
                    className="h-full"
                  />
            </div>
          </div>
        </div>
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

/**
 * Detects when the student is explicitly asking for a visual.
 *
 * Returns `{ query, type }` if a request was recognized, `null`
 * otherwise. Recognized phrases (case-insensitive):
 *   - "show me ..."             → photo
 *   - "show me a diagram of ..." → diagram
 *   - "draw me ..."             → diagram
 *   - "draw a ..."              → diagram
 *   - "picture of ..."          → photo
 *   - "diagram of ..."          → diagram
 *   - "what does X look like"   → photo
 *
 * The extracted noun phrase is trimmed of stop words at the front
 * ("a", "an", "the", "some") and capped at 60 chars to keep the
 * Wikimedia query tight.
 */
function detectImageRequest(
  text: string
):
  | { query: string; type: "diagram" | "photo" | "illustration" }
  | null {
  const lower = text.toLowerCase().trim();
  if (lower.length < 6) return null;
  const patterns: { re: RegExp; type: "diagram" | "photo" | "illustration" }[] = [
    { re: /(?:show|draw)\s+(?:me\s+)?(?:a\s+|the\s+|an\s+)?diagram\s+of\s+(.+?)[.?!]?$/i, type: "diagram" },
    { re: /(?:show|draw)\s+(?:me\s+)?(?:a\s+|the\s+|an\s+)?(?:picture|photo|image)\s+of\s+(.+?)[.?!]?$/i, type: "photo" },
    { re: /(?:draw|sketch)\s+(?:me\s+)?(?:a\s+|the\s+|an\s+)?(.+?)[.?!]?$/i, type: "diagram" },
    { re: /(?:show|see)\s+(?:me\s+)?(?:a\s+|the\s+|an\s+)?(.+?)[.?!]?$/i, type: "photo" },
    { re: /what\s+does\s+(.+?)\s+look\s+like[.?!]?$/i, type: "photo" },
    { re: /^(?:picture|photo|image|diagram)\s+of\s+(.+?)[.?!]?$/i, type: "photo" },
  ];
  for (const { re, type } of patterns) {
    const m = lower.match(re);
    if (m && m[1]) {
      const q = m[1]
        .replace(/^(?:a|an|the|some)\s+/, "")
        .trim()
        .slice(0, 60);
      if (q.length >= 3) return { query: q, type };
    }
  }
  return null;
}

/**
 * Centered ad-style question modal — with a minimize-to-chip mode.
 *
 * UX goal: the moment Rose's voice ACTUALLY says the question, the
 * screen dims and a cloud pops up smack in the middle of the viewport
 * so the student can't miss it. The dim backdrop is
 * `pointer-events-none` so the page underneath stays scrollable
 * through the dim — but the centered card naturally covers the notes
 * panel on a wide layout. That's where the minimize button comes in:
 * tapping "Minimize" shrinks the popup to a small chip in the
 * top-right corner of the viewport, lifts the dim, and lets the
 * student freely write notes / reread the source / cross-reference
 * the course material. Tapping the chip "Expand" re-inflates the
 * popup to center.
 *
 * Lifecycle
 *   - Parent controls `open` (when Rose's audio for the question
 *     starts) and `minimized` (toggled by chip/Minimize button).
 *   - A new chunkId remounts the component so the typewriter
 *     animation and entrance animation re-play.
 *   - `onDismiss` fully hides the popup until the next chunk;
 *     `onMinimize` / `onExpand` just toggle the chip/center modes.
 */
function QuestionCloud({
  chunkId,
  text,
  open,
  minimized,
  onMinimize,
  onExpand,
  onRepeat,
  onDismiss,
}: {
  chunkId: string;
  text: string;
  open: boolean;
  minimized: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onRepeat: () => void;
  onDismiss: () => void;
}) {
  // Escape: expanded → minimize; minimized → expand (never dismiss).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (minimized) onExpand();
      else onMinimize();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, minimized, onExpand, onMinimize]);

  if (!open) return null;

  // ───────────── MINIMIZED MODE — top-right chip ─────────────
  // No backdrop, no dim, no blocked clicks. The page is fully usable
  // and the chip is just a button hovering in the corner so the
  // student can find their way back to the question.
  if (minimized) {
    return (
      <div
        key={`q-chip-${chunkId}`}
        className="question-cloud-chip fixed right-4 top-[88px] z-30 w-[min(340px,calc(100vw-2rem))] sm:right-6"
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand Rose's question"
          className="q-chip-btn group relative flex w-full min-w-0 items-center gap-2.5 overflow-hidden rounded-full border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-amber-100/90 px-3.5 py-2 shadow-[0_18px_36px_-12px_rgba(180,140,40,0.35)] ring-1 ring-amber-200/50 transition hover:from-amber-100 hover:to-amber-200/90 sm:px-4"
        >
          <span
            aria-hidden
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-base shadow-sm ring-1 ring-amber-200/70"
          >
            💭
          </span>
          <span className="min-w-0 flex-1 overflow-hidden text-left">
            <span className="block text-[9px] font-semibold uppercase tracking-[0.16em] text-amber-700">
              Rose asks
            </span>
            <span className="block truncate text-[12px] font-medium text-zinc-800">
              {text}
            </span>
          </span>
          <span
            aria-hidden
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-zinc-600 shadow-sm ring-1 ring-zinc-200 transition group-hover:text-zinc-900"
            title="Expand"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M4 10V4h6" />
              <path d="M20 14v6h-6" />
              <path d="M4 4l7 7" />
              <path d="M20 20l-7-7" />
            </svg>
          </span>
        </button>
        <style jsx>{`
          .q-chip-btn {
            animation: q-chip-in 320ms cubic-bezier(0.22, 0.9, 0.32, 1.2) both;
            will-change: transform, opacity;
          }
          @keyframes q-chip-in {
            from {
              opacity: 0;
              transform: translate(20px, -10px) scale(0.85);
            }
            to {
              opacity: 1;
              transform: translate(0, 0) scale(1);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .q-chip-btn {
              animation: none;
            }
          }
        `}</style>
      </div>
    );
  }

  // ───────────── EXPANDED MODE — centered modal ─────────────
  return (
    <div
      key={`q-cloud-${chunkId}`}
      className="question-cloud-root fixed inset-0 z-30"
      role="dialog"
      aria-modal="false"
      aria-label="Rose's question"
    >
      {/* Dim layer — covers the whole viewport so the page reads as
          "dimmed", but pointer-events-none means clicks pass through. */}
      <div
        aria-hidden
        className="question-cloud-backdrop pointer-events-none absolute inset-0 bg-zinc-900/35 backdrop-blur-[2px]"
      />
      {/* Click-to-minimize layer — covers the full viewport. Clicking
          the dimmed area outside the card minimizes (not dismisses)
          the popup. That's the cheaper gesture for "I want to look
          at the notes for a second". The × button is the kill switch. */}
      <button
        type="button"
        aria-label="Minimize question"
        onClick={onMinimize}
        className="absolute inset-0 cursor-default"
      />

      {/* The popup card. Smack in the middle of the viewport. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="question-cloud-card pointer-events-auto relative w-full max-w-xl">
          <div className="relative overflow-visible rounded-[32px] border border-amber-200/70 bg-gradient-to-br from-amber-50/98 via-white to-amber-100/95 px-7 py-7 shadow-[0_40px_80px_-20px_rgba(60,60,90,0.45)] ring-1 ring-amber-200/60 sm:px-9 sm:py-9">
            <div
              aria-hidden
              className="pointer-events-none absolute -left-6 -top-7 h-20 w-20 rounded-full bg-amber-200/55 blur-2xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-6 -bottom-7 h-20 w-20 rounded-full bg-rose-200/45 blur-2xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-3 top-1/3 h-10 w-10 rounded-full bg-violet-200/40 blur-xl"
            />

            {/* Top-right cluster: minimize + close. Minimize sits to
                the LEFT of close so the destructive action is always
                on the outside. */}
            <div className="absolute right-4 top-4 z-10 flex items-center gap-1.5">
              <button
                type="button"
                onClick={onMinimize}
                aria-label="Minimize question"
                title="Minimize to corner"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-900"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M5 19h14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dismiss the question"
                title="Dismiss"
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/80 text-zinc-500 shadow-sm ring-1 ring-zinc-200 transition hover:text-zinc-900"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6 6l12 12M18 6l-12 12" />
                </svg>
              </button>
            </div>

            <div className="relative flex items-start gap-4">
              <div
                aria-hidden
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-[26px] shadow-sm ring-1 ring-amber-200/70"
              >
                💭
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
                  Rose asks
                </p>
                <p className="mt-2 pr-16 text-[20px] font-semibold leading-snug text-zinc-900 sm:text-[22px]">
                  {text}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-2 text-[12px] text-zinc-500">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1">
                    <span aria-hidden>🎙️</span>
                    Hold the mic or type your answer below
                  </span>
                  <button
                    type="button"
                    onClick={onRepeat}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-medium text-zinc-700 transition hover:bg-white"
                    title="Have Rose ask again"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M3 12a9 9 0 1 0 3.5-7.1" />
                      <path d="M3 4v6h6" />
                    </svg>
                    Replay
                  </button>
                  <button
                    type="button"
                    onClick={onMinimize}
                    className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 font-medium text-zinc-700 transition hover:bg-white"
                    title="Minimize so I can check the notes"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden
                    >
                      <path d="M14 4h6v6" />
                      <path d="M10 20H4v-6" />
                      <path d="M20 4l-7 7" />
                      <path d="M4 20l7-7" />
                    </svg>
                    Check notes
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .question-cloud-root {
          animation: q-root-in 220ms ease-out both;
        }
        .question-cloud-backdrop {
          animation: q-bd-in 260ms ease-out both;
        }
        .question-cloud-card {
          animation: q-card-in 480ms cubic-bezier(0.22, 0.9, 0.32, 1.25) both;
          will-change: transform, opacity;
        }
        @keyframes q-root-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes q-bd-in {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes q-card-in {
          from {
            opacity: 0;
            transform: translateY(24px) scale(0.9);
          }
          60% {
            transform: translateY(-6px) scale(1.02);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .question-cloud-root,
          .question-cloud-backdrop,
          .question-cloud-card {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

/**
 * Compact speed-rate selector for Rose's voice. Cycles through 0.75x ↔
 * 1x ↔ 1.25x ↔ 1.5x ↔ 0.5x on click, with the active rate shown on
 * the button face. Persists to localStorage via the parent. Changes
 * affect the NEXT sentence so we never re-pitch mid-utterance.
 */
function SpeedControl({
  rate,
  onChange,
  hidden,
}: {
  rate: number;
  onChange: (next: number) => void;
  hidden?: boolean;
}) {
  if (hidden) return null;
  const STEPS = [0.75, 1, 1.25, 1.5, 0.5] as const;
  // Find the closest step to the current rate, then advance.
  const advance = () => {
    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < STEPS.length; i += 1) {
      const d = Math.abs(STEPS[i] - rate);
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }
    onChange(STEPS[(bestIdx + 1) % STEPS.length]);
  };
  // Show the rate with a single trailing "x", trim trailing zero (1.0x → 1x).
  const label = `${Number.isInteger(rate) ? rate.toFixed(0) : rate.toFixed(2).replace(/0$/, "")}x`;
  return (
    <button
      type="button"
      onClick={advance}
      className="rounded-full border border-white/50 bg-white/45 px-3 py-1.5 text-xs font-medium tabular-nums text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
      title={`Voice speed: ${label}. Click to cycle.`}
      aria-label={`Voice speed ${label}, click to change`}
    >
      {label}
    </button>
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
                : "Press and hold M or the mic button to speak · or type here…"
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
                recording ? "Release to send" : "Press and hold to speak"
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
