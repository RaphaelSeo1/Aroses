"use client";

import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import {
  fireCheckInConfetti,
  useDailyCheckIn,
} from "@/lib/checkin/use-daily-checkin";

export function CheckInStreakChip({ enabled = true }: { enabled?: boolean }) {
  const t = useT();
  const { status, busy, checkIn } = useDailyCheckIn({ enabled });
  if (!enabled) return null;

  const streak = status?.currentStreak ?? 0;
  const checkedIn = Boolean(status?.checkedInToday);
  const due = status != null && !checkedIn;

  const onClick = async () => {
    if (!due || busy) return;
    const result = await checkIn();
    if (result?.justCheckedIn || result?.plusGranted) {
      void fireCheckInConfetti(Boolean(result.plusGranted));
    }
  };

  const label = due
    ? t.checkin.chipAriaDue
    : tf(t.checkin.chipAriaDone, { count: streak });

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy || !due}
      aria-label={label}
      title={due ? t.checkin.cta : t.checkin.comeBackTomorrow}
      className={[
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-semibold transition",
        due
          ? "bg-brand text-white shadow-sm shadow-red-600/20 hover:bg-brand-hover"
          : "bg-brand-blush/90 text-brand-ink dark:bg-white/[0.12] dark:text-brand-soft",
      ].join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 20c-2.2-2.4-6-5.2-6-9a6 6 0 0 1 12 0c0 3.8-3.8 6.6-6 9Z" />
      </svg>
      <span className="tabular-nums">
        {due ? t.checkin.ctaShort : streak > 0 ? streak : "–"}
      </span>
    </button>
  );
}
