"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatedWaveform } from "@/components/immersive/AnimatedWaveform";
import { GlassPanel } from "@/components/immersive/GlassPanel";
import { ImmersiveShell } from "@/components/immersive/ImmersiveShell";
import { TypewriterText } from "@/components/immersive/TypewriterText";
import { tf } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/LocaleProvider";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";

/**
 * Welcome + mode-choice step that runs the first time a student enters the
 * immersive Mentored Learning view (and every time they come back too — it
 * doubles as a calm entry ritual).
 *
 * Behaviour:
 *   - Auto-speaks a short welcome on mount (voice mode).
 *   - Reveals the welcome text word-by-word while it's being spoken.
 *   - Surfaces two big glass cards: Mentored Learning / Free Exploration.
 *   - Mic button lets the student answer by voice; we transcribe and look
 *     for keywords. Ambiguous → keep them on the picker.
 *
 * On selection the parent gets a `mode` string and decides where to route.
 */
export function ImmersiveModePicker({
  materialId,
  courseTitle,
  defaultMode,
  onChoose,
  onExit,
}: {
  materialId: string;
  courseTitle: string;
  /** If the student previously picked a mode for this course, gently bias toward it. */
  defaultMode?: "mentored" | "free" | null;
  onChoose: (mode: "mentored" | "free") => void;
  onExit: () => void;
}) {
  const t = useT();
  // No barge-in on the welcome screen — the student hasn't opted into mic
  // monitoring yet, and we don't want to trip the browser permission
  // dialog the moment they land on /learn.
  const voice = useMentoredVoice({ materialId, bargeInEnabled: false });
  const spokeRef = useRef(false);
  const recordPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const welcome = tf(t.immersive.welcomeSpeech, { title: courseTitle });

  useEffect(() => {
    if (spokeRef.current) return;
    spokeRef.current = true;
    void voice.speak(welcome);
    // We only want the welcome to play once on mount; voice handle is stable
    // enough for our purposes and re-speaking on rerender would be jarring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- voice-driven choice -----
  const startListening = useCallback(async () => {
    if (classifying) return;
    setHint(null);
    recordPromiseRef.current = voice.startRecording();
  }, [classifying, voice]);

  const finishListening = useCallback(async () => {
    if (!recordPromiseRef.current) return;
    await voice.stopRecording();
    const blob = await recordPromiseRef.current;
    recordPromiseRef.current = null;
    if (!blob) return;
    setClassifying(true);
    const text = (await voice.transcribe(blob)).trim();
    if (!text) {
      setClassifying(false);
      return;
    }

    // LLM-classified intent. Returns { mode, confidence }. We fall back to
    // a keyword regex if the request fails for any reason so the picker
    // still works offline / without an Anthropic key.
    try {
      const res = await fetch("/api/mentored/classify-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance: text }),
      });
      const body = (await res.json()) as {
        mode?: "mentored" | "free" | "unclear";
        confidence?: number;
      };
      const mode = body.mode ?? "unclear";
      const confidence =
        typeof body.confidence === "number" ? body.confidence : 0.5;
      setClassifying(false);
      if ((mode === "mentored" || mode === "free") && confidence >= 0.45) {
        onChoose(mode);
        return;
      }
      setHint(tf(t.tutor.voiceHint, { text }));
    } catch {
      setClassifying(false);
      // Last-ditch fallback: same keyword regex as before.
      const lower = text.toLowerCase();
      if (/\b(free|explore|on my own|alone|read|skim)\b/.test(lower)) {
        onChoose("free");
        return;
      }
      if (/\b(mentor|guide|tutor|teach|walk me|together)\b/.test(lower)) {
        onChoose("mentored");
        return;
      }
      setHint(tf(t.tutor.voiceHint, { text }));
    }
  }, [onChoose, voice, t.tutor.voiceHint]);

  // Cancel speaking before navigating away.
  const choose = useCallback(
    (mode: "mentored" | "free") => {
      voice.cancelSpeak();
      onChoose(mode);
    },
    [onChoose, voice]
  );

  const handleExit = useCallback(() => {
    voice.cancelSpeak();
    onExit();
  }, [onExit, voice]);

  return (
    <ImmersiveShell
      topBar={
        <button
          type="button"
          onClick={handleExit}
          className="rounded-full border border-white/50 bg-white/40 px-4 py-1.5 text-xs font-medium text-zinc-700 shadow-sm backdrop-blur-md transition hover:bg-white/60"
        >
          {t.tutor.exit}
        </button>
      }
      bottomBar={
        <div className="flex flex-col items-center gap-3">
          <div className="h-16 w-full max-w-md">
            <AnimatedWaveform
              mode={
                voice.state.speaking
                  ? "speaking"
                  : voice.state.recording
                    ? "listening"
                    : "idle"
              }
            />
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={classifying || voice.state.transcribing}
              onMouseDown={() => void startListening()}
              onMouseUp={() => void finishListening()}
              onMouseLeave={
                voice.state.recording ? () => void finishListening() : undefined
              }
              onTouchStart={() => void startListening()}
              onTouchEnd={() => void finishListening()}
              className={
                voice.state.recording
                  ? "rounded-full bg-rose-500/90 px-5 py-2.5 text-sm font-semibold text-white shadow-lg backdrop-blur-md"
                  : "rounded-full border border-white/50 bg-white/45 px-5 py-2.5 text-sm font-medium text-zinc-800 shadow-sm backdrop-blur-md transition hover:bg-white/60"
              }
            >
              {voice.state.transcribing
                ? t.tutor.listening
                : voice.state.recording
                  ? t.tutor.release
                  : classifying
                    ? t.tutor.thinking
                    : t.tutor.sayChoice}
            </button>
            {hint ? (
              <span className="max-w-xs text-xs text-zinc-600">{hint}</span>
            ) : null}
          </div>
        </div>
      }
    >
      <div className="flex flex-col items-center text-center">
        <p className="text-[11px] font-semibold uppercase tracking-[0.25em] text-zinc-500">
          {t.tutor.welcome}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
          {courseTitle}
        </h1>

        <GlassPanel className="mt-8 w-full" tone="subtle" delayMs={150}>
          <p className="text-base leading-relaxed text-zinc-800 sm:text-lg">
            <TypewriterText text={welcome} wordIntervalMs={70} />
          </p>
        </GlassPanel>

        <div className="mt-8 grid w-full grid-cols-1 gap-4 sm:grid-cols-2">
          <ChoiceCard
            label={t.tutor.mentoredLearning}
            description={t.tutor.mentoredDesc}
            badge={defaultMode === "mentored" ? t.tutor.usualPick : null}
            recommended
            recommendedLabel={t.tutor.recommended}
            selfPacedLabel={t.tutor.selfPaced}
            chooseLabel={t.tutor.choose}
            onClick={() => choose("mentored")}
          />
          <ChoiceCard
            label={t.tutor.freeExploration}
            description={t.tutor.freeDesc}
            badge={defaultMode === "free" ? t.tutor.usualPick : null}
            recommendedLabel={t.tutor.recommended}
            selfPacedLabel={t.tutor.selfPaced}
            chooseLabel={t.tutor.choose}
            onClick={() => choose("free")}
          />
        </div>

        <p className="mt-6 text-xs text-zinc-500">
          {t.tutor.switchModesHint}
        </p>
      </div>
    </ImmersiveShell>
  );
}

function ChoiceCard({
  label,
  description,
  recommended,
  badge,
  recommendedLabel,
  selfPacedLabel,
  chooseLabel,
  onClick,
}: {
  label: string;
  description: string;
  recommended?: boolean;
  badge?: string | null;
  recommendedLabel: string;
  selfPacedLabel: string;
  chooseLabel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "choice-card group relative flex flex-col items-start gap-3 rounded-3xl border p-6 text-left shadow-[0_25px_60px_-25px_rgba(60,60,90,0.25)] ring-1 backdrop-blur-2xl backdrop-saturate-150 transition hover:translate-y-[-2px] hover:shadow-[0_30px_70px_-25px_rgba(60,60,90,0.32)] " +
        (recommended
          ? "border-fuchsia-200/60 bg-gradient-to-br from-white/55 to-fuchsia-50/40 ring-fuchsia-200/50"
          : "border-white/40 bg-white/45 ring-white/50")
      }
    >
      {badge ? (
        <span className="absolute right-4 top-4 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-medium text-zinc-600 ring-1 ring-white/60 backdrop-blur-md">
          {badge}
        </span>
      ) : null}
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
        {recommended ? recommendedLabel : selfPacedLabel}
      </span>
      <span className="text-xl font-semibold text-zinc-900">{label}</span>
      <span className="text-sm leading-relaxed text-zinc-700">
        {description}
      </span>
      <span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-zinc-700">
        {chooseLabel}
        <span aria-hidden className="transition group-hover:translate-x-1">
          →
        </span>
      </span>
      <style jsx>{`
        .choice-card {
          animation: card-in 0.6s cubic-bezier(0.22, 0.61, 0.36, 1) both;
        }
        @keyframes card-in {
          0% {
            opacity: 0;
            transform: translateY(10px) scale(0.98);
          }
          100% {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .choice-card {
            animation: none;
          }
        }
      `}</style>
    </button>
  );
}
