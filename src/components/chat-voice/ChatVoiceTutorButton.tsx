"use client";

import { useT } from "@/lib/i18n/LocaleProvider";

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

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`relative inline-flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "ring-2 ring-rose-400/80 dark:ring-rose-500/70"
          : "ring-1 ring-rose-200/80 dark:ring-rose-800/70"
      }`}
      style={{
        boxShadow: disabled
          ? "none"
          : active
            ? "0 0 16px 4px rgba(220, 38, 38, 0.55)"
            : "0 0 10px 2px rgba(220, 38, 38, 0.42)",
      }}
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
  );
}
