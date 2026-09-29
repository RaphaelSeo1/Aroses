import { PLANS, TOP_PLAN_TIER, isPaidTier, type PlanTier } from "./plans.ts";

/**
 * Student-facing "you ran out" copy for the monthly meters: what ran out,
 * when it resets, and how to get more. Pure so the wording is unit-tested.
 */

export function resetDateLabel(iso: string | null | undefined): string {
  if (!iso) return "your next billing date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "your next billing date";
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** "2 hours", "1 hour", "1.5 hours", "45 minutes". */
export function formatLectureHours(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const hours = Math.round((m / 60) * 10) / 10;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function upgradeHint(tier: PlanTier, more: string): string {
  if (tier === TOP_PLAN_TIER) return "";
  return ` Upgrade your plan for ${more}.`;
}

export function sourcePagesUsedUpMessage(opts: {
  tier: PlanTier;
  cap: number;
  periodEnd: string | null;
}): string {
  if (!isPaidTier(opts.tier) || opts.cap <= 0) {
    return "Choose a plan to build courses from your files.";
  }
  return `You've used all ${opts.cap.toLocaleString("en-US")} pages of course material in your ${PLANS[opts.tier].name} plan. They reset on ${resetDateLabel(opts.periodEnd)}.${upgradeHint(opts.tier, "more pages")}`;
}

export function sourcePagesShortMessage(opts: {
  tier: PlanTier;
  remaining: number;
  needed: number;
  periodEnd: string | null;
}): string {
  if (!isPaidTier(opts.tier)) {
    return "Choose a plan to build courses from your files.";
  }
  const left = Math.max(0, opts.remaining).toLocaleString("en-US");
  const needed = Math.max(0, opts.needed).toLocaleString("en-US");
  const more = opts.tier === TOP_PLAN_TIER ? "" : ", or upgrade your plan for more pages";
  return `These files have ${needed} pages, but you have ${left} pages of course material left. Remove some files, wait until your pages reset on ${resetDateLabel(opts.periodEnd)}${more}.`;
}

export function lectureMinutesUsedUpMessage(opts: {
  tier: PlanTier;
  capMinutes: number;
  periodEnd: string | null;
}): string {
  if (!isPaidTier(opts.tier) || opts.capMinutes <= 0) {
    return "Choose a plan to take live lecture notes.";
  }
  return `You've used all ${formatLectureHours(opts.capMinutes)} of live lecture notes in your ${PLANS[opts.tier].name} plan. They reset on ${resetDateLabel(opts.periodEnd)}.${upgradeHint(opts.tier, "more lecture hours")}`;
}

export function lectureMinutesWarningMessage(secondsLeft: number): string {
  const minutes = Math.max(1, Math.ceil(secondsLeft / 60));
  return `About ${minutes} minute${minutes === 1 ? "" : "s"} of live lecture notes left on your plan. Recording stops by itself at the limit, and everything so far is saved.`;
}

export function lectureMinutesStoppedMessage(): string {
  return "You've used your plan's live lecture hours for this month, so recording stopped. Your transcript and notes are saved and you can still finish them. Hours reset with your plan each month, or upgrade for more.";
}

export function extraQuestionsUsedUpMessage(opts: {
  tier: PlanTier;
  cap: number;
  periodEnd: string | null;
}): string {
  if (!isPaidTier(opts.tier) || opts.cap <= 0) {
    return "Choose a plan to generate extra practice questions.";
  }
  return `You've used all ${opts.cap.toLocaleString("en-US")} extra question sets in your ${PLANS[opts.tier].name} plan. They reset on ${resetDateLabel(opts.periodEnd)}.${upgradeHint(opts.tier, "more question sets")}`;
}

/** "about 5 hours", "about 1 hour", "about 20 minutes" until `resetsAt`. */
export function timeUntilLabel(resetsAt: string, now: Date = new Date()): string {
  const ms = Date.parse(resetsAt) - now.getTime();
  const minutes = Math.max(1, Math.ceil((Number.isFinite(ms) ? ms : 0) / 60_000));
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hour${hours === 1 ? "" : "s"}`;
}

export function extraQuestionsDailyLimitMessage(opts: {
  cap: number;
  resetsAt: string;
  now?: Date;
}): string {
  return `You've made ${opts.cap} extra question sets today, which is the daily limit. You can make more in ${timeUntilLabel(opts.resetsAt, opts.now)}.`;
}
