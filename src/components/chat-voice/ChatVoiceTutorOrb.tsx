"use client";

import { useEffect, useRef } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import type { ChatVoicePhase } from "@/lib/chat-voice/use-chat-voice-tutor";

const RING_COUNT = 4;

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
  const coreRef = useRef<HTMLDivElement | null>(null);
  const ringRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const core = coreRef.current;
      if (!core) return;

      const elapsed = (now - start) / 1000;
      const p = phaseRef.current;
      const mic = Math.min(1, Math.max(0, inputLevelRef.current));
      const play = Math.min(1, Math.max(0, playbackLevelRef.current));

      let period = 2.2;
      let maxScale = 1.55;
      let maxOp = 0.42;
      let coreScale = 1;

      if (reduced) {
        coreScale = p === "speaking" ? 1.06 : p === "listening" ? 1.03 : 1;
      } else if (p === "listening") {
        period = 1.1 - mic * 0.28;
        maxScale = 1.48 + mic * 0.55;
        maxOp = 0.42 + mic * 0.48;
        coreScale = 1.02 + mic * 0.14;
      } else if (p === "speaking") {
        const energy = 0.18 + play * 0.82;
        period = 0.82 - play * 0.22;
        maxScale = 1.58 + energy * 0.48;
        maxOp = 0.5 + energy * 0.38;
        coreScale = 1.03 + energy * 0.12;
      } else if (p === "thinking") {
        period = 1.55;
        maxScale = 1.48;
        maxOp = 0.4;
        coreScale = 1 + Math.sin(elapsed * 1.85) * 0.03;
      } else {
        period = 2.2;
        maxScale = 1.5;
        maxOp = 0.36;
        coreScale = 1 + Math.sin(elapsed * 1.35) * 0.025;
      }

      core.style.transform = `scale(${coreScale.toFixed(3)})`;

      for (let i = 0; i < RING_COUNT; i++) {
        const ring = ringRefs.current[i];
        if (!ring) continue;
        if (reduced) {
          const s = 1.12 + i * 0.16;
          ring.style.transform = `scale(${s.toFixed(3)})`;
          ring.style.opacity = `${Math.max(0.12, 0.38 - i * 0.07).toFixed(3)}`;
          continue;
        }
        const t = ((elapsed / Math.max(0.35, period) + i / RING_COUNT) % 1);
        ring.style.transform = `scale(${(1 + t * (maxScale - 1)).toFixed(3)})`;
        ring.style.opacity = `${((1 - t) * maxOp).toFixed(3)}`;
      }

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
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center overflow-visible sm:bottom-28">
      <div className="pointer-events-auto relative flex items-start gap-2 overflow-visible">
        <button
          type="button"
          onClick={onExit}
          aria-label={`${label}. ${t.common.voiceTutorExit}`}
          className="relative h-[4.5rem] w-[4.5rem] overflow-visible rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
        >
          {Array.from({ length: RING_COUNT }, (_, i) => (
            <span
              key={i}
              ref={(el) => {
                ringRefs.current[i] = el;
              }}
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full border border-rose-500/80 dark:border-rose-400/70"
            />
          ))}
          <div
            ref={coreRef}
            className="absolute inset-0 z-[1] overflow-hidden rounded-full bg-rose-600"
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
          className="relative z-[1] mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border border-zinc-200 bg-white/90 text-zinc-500 shadow-sm hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:text-white"
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
