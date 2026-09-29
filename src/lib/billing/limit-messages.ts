import { tf } from "../i18n/format.ts";
import { limits } from "../../locales/limits.ts";
import { TOP_PLAN_TIER, isPaidTier, type PlanTier } from "./plans.ts";

/**
 * Student-facing "you ran out" copy for the monthly meters: what ran out,
 * when it resets, and how to get more. Pure so the wording is unit-tested.
 *
 * Every builder takes an optional `LimitCopy`: the student's app language and
 * IANA time zone (server: `getLimitCopy()` in `limit-copy.ts`). Reset times
 * are shown in that zone; without one they're shown in UTC, labeled as such.
 */

export type LimitLocale = keyof typeof limits;

export type LimitCopy = {
  locale?: LimitLocale | string | null;
  timeZone?: string | null;
};

type Strings = (typeof limits)["en"];

export function limitLocale(raw: unknown): LimitLocale {
  return raw === "ko" ? "ko" : "en";
}

function strings(copy?: LimitCopy): Strings {
  return limits[limitLocale(copy?.locale)];
}

function intlLocale(copy?: LimitCopy): string {
  return limitLocale(copy?.locale) === "ko" ? "ko-KR" : "en-US";
}

export function validTimeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tz = raw.trim();
  if (!tz || tz.length > 100) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

function count(n: number, copy?: LimitCopy): string {
  return Math.max(0, n).toLocaleString(intlLocale(copy));
}

function planName(tier: PlanTier, copy?: LimitCopy): string {
  const s = strings(copy);
  switch (tier) {
    case "lite":
      return s.planLite;
    case "student":
      return s.planStudent;
    case "plus":
      return s.planPlus;
    case "pro":
      return s.planPro;
    default:
      return s.planMax;
  }
}

/**
 * "September 30 at 5:00 PM" in the student's zone ("10월 1일 오전 9:00" in
 * Korean). Unknown zone → UTC with the zone name so the time isn't misread.
 */
export function resetDateLabel(
  iso: string | null | undefined,
  copy?: LimitCopy
): string {
  const s = strings(copy);
  if (!iso) return s.resetFallback;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return s.resetFallback;
  const timeZone = validTimeZone(copy?.timeZone);
  return new Intl.DateTimeFormat(intlLocale(copy), {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timeZone ?? "UTC",
    ...(timeZone ? {} : { timeZoneName: "short" as const }),
  }).format(d);
}

/** "2 hours", "1 hour", "1.5 hours", "45 minutes". */
export function formatLectureHours(minutes: number, copy?: LimitCopy): string {
  const s = strings(copy);
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return m === 1 ? s.minuteOne : tf(s.minutesMany, { minutes: m });
  const hours = Math.round((m / 60) * 10) / 10;
  return hours === 1 ? s.hourOne : tf(s.hoursMany, { hours });
}

function withUpgrade(tier: PlanTier, head: string, upgrade: string): string {
  return tier === TOP_PLAN_TIER ? head : `${head} ${upgrade}`;
}

export function sourcePagesUsedUpMessage(
  opts: { tier: PlanTier; cap: number; periodEnd: string | null },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  if (!isPaidTier(opts.tier) || opts.cap <= 0) return s.pagesChoosePlan;
  const head = tf(s.pagesUsedUp, {
    cap: count(opts.cap, copy),
    plan: planName(opts.tier, copy),
    date: resetDateLabel(opts.periodEnd, copy),
  });
  return withUpgrade(opts.tier, head, s.pagesUpgrade);
}

export function sourcePagesShortMessage(
  opts: {
    tier: PlanTier;
    remaining: number;
    needed: number;
    periodEnd: string | null;
  },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  if (!isPaidTier(opts.tier)) return s.pagesChoosePlan;
  return tf(opts.tier === TOP_PLAN_TIER ? s.pagesShortTopPlan : s.pagesShort, {
    needed: count(opts.needed, copy),
    left: count(opts.remaining, copy),
    date: resetDateLabel(opts.periodEnd, copy),
  });
}

export function buildChoosePlanMessage(copy?: LimitCopy): string {
  return strings(copy).buildChoosePlan;
}

export function lectureMinutesUsedUpMessage(
  opts: { tier: PlanTier; capMinutes: number; periodEnd: string | null },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  if (!isPaidTier(opts.tier) || opts.capMinutes <= 0) return s.lectureChoosePlan;
  const head = tf(s.lectureUsedUp, {
    hours: formatLectureHours(opts.capMinutes, copy),
    plan: planName(opts.tier, copy),
    date: resetDateLabel(opts.periodEnd, copy),
  });
  return withUpgrade(opts.tier, head, s.lectureUpgrade);
}

export function lectureMinutesWarningMessage(
  secondsLeft: number,
  copy?: LimitCopy
): string {
  const s = strings(copy);
  const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
  return tf(s.lectureWarning, {
    minutes: minutes === 1 ? s.minuteOne : tf(s.minutesMany, { minutes }),
  });
}

export function lectureMinutesStoppedMessage(copy?: LimitCopy): string {
  return strings(copy).lectureStopped;
}

export function extraQuestionsUsedUpMessage(
  opts: { tier: PlanTier; cap: number; periodEnd: string | null },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  if (!isPaidTier(opts.tier) || opts.cap <= 0) return s.extraChoosePlan;
  const head = tf(s.extraUsedUp, {
    cap: count(opts.cap, copy),
    plan: planName(opts.tier, copy),
    date: resetDateLabel(opts.periodEnd, copy),
  });
  return withUpgrade(opts.tier, head, s.extraUpgrade);
}

/** "about 5 hours", "about 1 hour", "about 20 minutes" until `resetsAt`. */
export function timeUntilLabel(
  resetsAt: string,
  now: Date = new Date(),
  copy?: LimitCopy
): string {
  const s = strings(copy);
  const ms = Date.parse(resetsAt) - now.getTime();
  const minutes = Math.max(1, Math.ceil((Number.isFinite(ms) ? ms : 0) / 60_000));
  if (minutes < 60) {
    return minutes === 1 ? s.aboutMinuteOne : tf(s.aboutMinutesMany, { minutes });
  }
  const hours = Math.round(minutes / 60);
  return hours === 1 ? s.aboutHourOne : tf(s.aboutHoursMany, { hours });
}

export function extraQuestionsDailyLimitMessage(
  opts: { cap: number; resetsAt: string; now?: Date },
  copy?: LimitCopy
): string {
  return tf(strings(copy).extraDaily, {
    cap: count(opts.cap, copy),
    wait: timeUntilLabel(opts.resetsAt, opts.now, copy),
  });
}

export function chatLimitReachedMessage(
  input: {
    tier: PlanTier;
    monthlyMessages: number;
    resetsAt: string;
    upgradeAvailable: boolean;
  },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  const date = resetDateLabel(input.resetsAt, copy);
  const n = input.monthlyMessages;
  const head =
    n > 0
      ? tf(s.chatUsedUp, { count: count(n, copy), date })
      : tf(s.chatUnavailable, { date });
  if (!input.upgradeAvailable || input.tier === TOP_PLAN_TIER) return head;
  return `${head} ${input.tier === "free" ? s.chatChoosePlan : s.chatUpgrade}`;
}

export function voiceCapReachedMessage(
  opts: { upgradeAvailable: boolean },
  copy?: LimitCopy
): string {
  const s = strings(copy);
  return opts.upgradeAvailable ? s.voiceCapUpgrade : s.voiceCap;
}
