import {
  addCalendarDays,
  dateKeyInZone,
} from "../calendar/dates.ts";
import {
  CHECKIN_STREAK_GOAL,
  TZ_HOP_GUARD_MS,
  type CheckInFailReason,
  type CheckInPublicStatus,
  type CheckInState,
  type EvaluateCheckInResult,
} from "./types.ts";
import { shouldGrantPlusForStreak } from "./plus-grant.ts";

export { CHECKIN_STREAK_GOAL, PLUS_GRANT_DAYS } from "./types.ts";
export {
  shouldGrantPlusForStreak,
  plusGrantSkipReason,
} from "./plus-grant.ts";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const tz = raw.trim();
  if (tz.length < 1 || tz.length > 100) return null;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return null;
  }
}

export function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function claimedDateIsPlausible(today: string, now: Date): boolean {
  if (!DATE_KEY.test(today)) return false;
  const utcToday = utcDateKey(now);
  const utcYesterday = addCalendarDays(utcToday, -1);
  const utcTomorrow = addCalendarDays(utcToday, 1);
  return today >= utcYesterday && today <= utcTomorrow;
}

export function displayStreak(state: CheckInState | null, today: string): number {
  if (!state) return 0;
  if (state.lastCheckinDate === today) return state.currentStreak;
  const yesterday = addCalendarDays(today, -1);
  if (state.lastCheckinDate === yesterday) return state.currentStreak;
  return 0;
}

export function publicStatusFromState(
  state: CheckInState | null,
  today: string,
  timeZone: string
): CheckInPublicStatus {
  const currentStreak = displayStreak(state, today);
  const checkedInToday = Boolean(state && state.lastCheckinDate === today);
  const pendingPlusGrant =
    checkedInToday &&
    currentStreak === CHECKIN_STREAK_GOAL &&
    shouldGrantPlusForStreak({
      nextStreak: currentStreak,
      lastPlusGrantedOnDate: state?.lastPlusGrantedOnDate ?? null,
      today,
    });

  return {
    checkedInToday,
    currentStreak,
    longestStreak: state?.longestStreak ?? 0,
    totalCheckins: state?.totalCheckins ?? 0,
    today,
    timezone: timeZone,
    goal: CHECKIN_STREAK_GOAL,
    goalProgress: Math.min(currentStreak, CHECKIN_STREAK_GOAL),
    plusGrants: state?.plusGrants ?? 0,
    lastPlusGrantedOnDate: state?.lastPlusGrantedOnDate ?? null,
    pendingPlusGrant,
  };
}

export function evaluateCheckIn(opts: {
  prev: CheckInState | null;
  now: Date;
  timeZone: string;
}): EvaluateCheckInResult {
  const timeZone = isValidTimeZone(opts.timeZone);
  if (!timeZone) {
    return {
      ok: false,
      reason: "invalid_timezone",
      today: null,
      timeZone: null,
      state: opts.prev,
    };
  }

  const today = dateKeyInZone(opts.now, timeZone);
  if (!claimedDateIsPlausible(today, opts.now)) {
    return {
      ok: false,
      reason: "clock_skew",
      today,
      timeZone,
      state: opts.prev,
    };
  }

  const fail = (reason: CheckInFailReason): EvaluateCheckInResult => ({
    ok: false,
    reason,
    today,
    timeZone,
    state: opts.prev,
  });

  if (opts.prev) {
    if (opts.prev.lastCheckinDate === today) {
      return fail("already_checked_in");
    }
    if (opts.prev.lastCheckinDate > today) {
      return fail("clock_skew");
    }
    if (
      opts.prev.timezone &&
      opts.prev.timezone !== timeZone &&
      opts.prev.lastCheckinAt
    ) {
      const lastAt = new Date(opts.prev.lastCheckinAt).getTime();
      const elapsed = opts.now.getTime() - lastAt;
      if (Number.isFinite(lastAt) && elapsed >= 0 && elapsed < TZ_HOP_GUARD_MS) {
        return fail("timezone_abuse");
      }
    }
  }

  const yesterday = addCalendarDays(today, -1);
  const nextStreak =
    opts.prev && opts.prev.lastCheckinDate === yesterday
      ? opts.prev.currentStreak + 1
      : 1;
  const longestStreak = Math.max(opts.prev?.longestStreak ?? 0, nextStreak);
  const lastCheckinAt = opts.now.toISOString();
  const next: CheckInState = {
    lastCheckinDate: today,
    lastCheckinAt,
    timezone: timeZone,
    currentStreak: nextStreak,
    longestStreak,
    totalCheckins: (opts.prev?.totalCheckins ?? 0) + 1,
    plusGrants: opts.prev?.plusGrants ?? 0,
    lastPlusGrantedOnDate: opts.prev?.lastPlusGrantedOnDate ?? null,
    lastPlusGrantedAt: opts.prev?.lastPlusGrantedAt ?? null,
  };

  return {
    ok: true,
    today,
    timeZone,
    next,
    shouldGrantPlus: shouldGrantPlusForStreak({
      nextStreak,
      lastPlusGrantedOnDate: next.lastPlusGrantedOnDate,
      today,
    }),
  };
}

export function markPlusGranted(
  state: CheckInState,
  at: Date
): CheckInState {
  return {
    ...state,
    plusGrants: state.plusGrants + 1,
    lastPlusGrantedOnDate: state.lastCheckinDate,
    lastPlusGrantedAt: at.toISOString(),
  };
}
