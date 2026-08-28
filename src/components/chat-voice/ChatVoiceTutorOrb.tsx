"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { ChatVoicePhase } from "@/lib/chat-voice/use-chat-voice-tutor";

export function ChatVoiceTutorOrb({
  phase,
  inputLevelRef,
  playbackLevelRef,
  onExit,
}: {
  phase: ChatVoicePhase;
  inputLevelRef: React.MutableRefObject<number>;
  playbackLevelRef: React.MutableRefObject<number>;
  onExit: () => void;
}) {
  const t = useT();
  const wrapRef = useRef<HTMLButtonElement | null>(null);
  const coreRef = useRef<HTMLDivElement | null>(null);
  const ringARef = useRef<HTMLSpanElement | null>(null);
  const ringBRef = useRef<HTMLSpanElement | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const wrap = wrapRef.current;
      const core = coreRef.current;
      const ringA = ringARef.current;
      const ringB = ringBRef.current;
      if (!wrap || !core) return;

      const elapsed = (now - start) / 1000;
      const p = phaseRef.current;
      const mic = Math.min(1, Math.max(0, inputLevelRef.current));
      const play = Math.min(1, Math.max(0, playbackLevelRef.current));

      let y = 0;
      let scale = 1;
      let rotA = 0;
      let rotB = 0;
      let glow = 0.35;

      if (reduced) {
        scale = p === "speaking" ? 1.08 : p === "listening" ? 1.04 : 1;
      } else if (p === "listening") {
        y = Math.sin(elapsed * 2.1) * 3;
        scale = 1.02 + mic * 0.55;
        glow = 0.4 + mic * 0.55;
      } else if (p === "speaking") {
        const energy = 0.18 + play * 0.82;
        y = Math.sin(elapsed * 3.4) * (4 + play * 8);
        scale = 1.04 + energy * 0.38;
        rotA = elapsed * 70;
        rotB = elapsed * -110;
        glow = 0.5 + energy * 0.5;
      } else {
        // idle / thinking: gentle float + breathe
        y = Math.sin(elapsed * 1.35) * 7;
        scale = 1 + Math.sin(elapsed * 1.85) * 0.045;
        rotA = elapsed * 18;
        rotB = elapsed * -12;
        glow = 0.32 + Math.sin(elapsed * 1.85) * 0.08;
      }

      wrap.style.transform = `translateY(${y.toFixed(2)}px)`;
      core.style.transform = `scale(${scale.toFixed(3)})`;
      core.style.boxShadow = `0 0 ${(18 + glow * 28).toFixed(0)}px ${
        (6 + glow * 10).toFixed(0)
      }px rgba(220, 38, 38, ${glow.toFixed(2)})`;
      if (ringA) ringA.style.transform = `rotate(${rotA.toFixed(1)}deg)`;
      if (ringB) ringB.style.transform = `rotate(${rotB.toFixed(1)}deg)`;

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inputLevelRef, playbackLevelRef]);

  const label =
    phase === "speaking"
      ? t.common.voiceTutorSpeaking
      : phase === "listening"
        ? t.common.voiceTutorListening
        : t.common.voiceTutor;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center sm:bottom-28">
      <div className="pointer-events-auto relative flex items-start gap-2">
        <button
          type="button"
          ref={wrapRef}
          onClick={onExit}
          aria-label={`${label}. ${t.common.voiceTutorExit}`}
          className="relative h-[4.5rem] w-[4.5rem] rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          <span
            ref={ringARef}
            aria-hidden
            className="absolute -inset-1 rounded-full border border-rose-300/50 dark:border-rose-400/40"
            style={{
              borderRadius: "50%",
              borderTopColor: "rgba(220, 38, 38, 0.85)",
              borderBottomColor: "transparent",
            }}
          />
          <span
            ref={ringBRef}
            aria-hidden
            className="absolute -inset-2.5 rounded-full border border-rose-200/40 dark:border-rose-500/30"
            style={{
              borderRadius: "50%",
              borderLeftColor: "rgba(252, 165, 165, 0.9)",
              borderRightColor: "transparent",
            }}
          />
          <div
            ref={coreRef}
            className="absolute inset-0 overflow-hidden rounded-full bg-rose-600"
          >
            <img
              src="/aroses-icon.png"
              alt=""
              width={72}
              height={72}
              className="h-full w-full object-cover"
              draggable={false}
            />
          </div>
        </button>
        <button
          type="button"
          onClick={onExit}
          aria-label={t.common.voiceTutorExit}
          className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-500 shadow-sm hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-white"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            aria-hidden
          >
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
