"use client";

import { useT } from "@/lib/i18n/LocaleProvider";

const WAVE_DELAYS_IDLE = ["0s", "-0.73s", "-1.47s"] as const;
const WAVE_DELAYS_ACTIVE = ["0s", "-0.38s", "-0.77s"] as const;

export function ChatVoiceTutorButton({
  active,
  disabled,
  disabledReason,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onClick: () => void;
}) {
  const t = useT();
  const label = disabled
    ? (disabledReason ?? t.billing.voiceCapReached)
    : active
      ? t.common.voiceTutorExit
      : t.common.voiceTutor;
  const duration = active ? "1.15s" : "2.2s";
  const delays = active ? WAVE_DELAYS_ACTIVE : WAVE_DELAYS_IDLE;

  return (
    <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center">
      {!disabled
        ? delays.map((delay, i) => (
            <span
              key={i}
              aria-hidden
              className={`pointer-events-none absolute inset-0 rounded-full border animate-aroses-sound-wave ${
                i === 0
                  ? "border-rose-500/75 dark:border-rose-400/70"
                  : i === 1
                    ? "border-rose-400/55 dark:border-rose-300/50"
                    : "border-rose-300/40 dark:border-rose-200/40"
              }`}
              style={{ animationDuration: duration, animationDelay: delay }}
            />
          ))
        : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        title={label}
        aria-pressed={active}
        className={`relative z-[1] inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
          active
            ? "ring-1 ring-rose-400/80 dark:ring-rose-500/70"
            : "ring-1 ring-rose-200/80 dark:ring-rose-800/70"
        }`}
      >
        <img
          src="/aroses-icon.png"
          alt=""
          width={28}
          height={28}
          className="h-full w-full object-cover"
          draggable={false}
        />
      </button>
    </span>
  );
}
