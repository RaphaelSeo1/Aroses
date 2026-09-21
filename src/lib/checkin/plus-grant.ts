import { addCalendarDays } from "../calendar/dates.ts";
import {
  hasPaidProductAccess,
  type PaidAccessSnapshot,
} from "../billing/paid-access.ts";
import { PLAN_RANK, parsePlanTier, type PlanTier } from "../billing/plans.ts";
import { CHECKIN_STREAK_GOAL, type PlusGrantSkipReason } from "./types.ts";

/**
 * Grant only on the 30th consecutive day of a streak, and only once per
 * streak. A later streak (after a miss) may earn Plus again.
 */
export function shouldGrantPlusForStreak(opts: {
  nextStreak: number;
  lastPlusGrantedOnDate: string | null;
  today: string;
}): boolean {
  if (opts.nextStreak !== CHECKIN_STREAK_GOAL) return false;
  const streakStart = addCalendarDays(opts.today, -(CHECKIN_STREAK_GOAL - 1));
  if (
    opts.lastPlusGrantedOnDate &&
    opts.lastPlusGrantedOnDate >= streakStart
  ) {
    return false;
  }
  return true;
}

/**
 * Skip if they already have paid access at Student or higher (Stripe or grant).
 * An expired check-in grant does not block a later streak.
 * Only Free may receive the grant (never a downgrade).
 */
export function plusGrantSkipReason(
  sub: PaidAccessSnapshot,
  now?: Date
): PlusGrantSkipReason | null {
  if (!hasPaidProductAccess(sub, now)) return null;
  const tier = (parsePlanTier(sub.tier) ?? "free") as PlanTier;
  if (PLAN_RANK[tier] >= PLAN_RANK.student) return "already_plus_or_higher";
  return null;
}
