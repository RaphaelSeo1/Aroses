export const CHECKIN_STREAK_GOAL = 30;
export const PLUS_GRANT_DAYS = 30;
export const TZ_HOP_GUARD_MS = 12 * 60 * 60 * 1000;

export type CheckInState = {
  lastCheckinDate: string;
  lastCheckinAt: string;
  timezone: string;
  currentStreak: number;
  longestStreak: number;
  totalCheckins: number;
  plusGrants: number;
  lastPlusGrantedOnDate: string | null;
  lastPlusGrantedAt: string | null;
};

export type CheckInPublicStatus = {
  checkedInToday: boolean;
  currentStreak: number;
  longestStreak: number;
  totalCheckins: number;
  today: string;
  timezone: string;
  goal: typeof CHECKIN_STREAK_GOAL;
  goalProgress: number;
  plusGrants: number;
  lastPlusGrantedOnDate: string | null;
  pendingPlusGrant: boolean;
};

export type CheckInFailReason =
  | "already_checked_in"
  | "invalid_timezone"
  | "timezone_abuse"
  | "clock_skew";

export type EvaluateCheckInResult =
  | {
      ok: true;
      today: string;
      timeZone: string;
      next: CheckInState;
      shouldGrantPlus: boolean;
    }
  | {
      ok: false;
      reason: CheckInFailReason;
      today: string | null;
      timeZone: string | null;
      state: CheckInState | null;
    };

export type PlusGrantSkipReason = "already_plus_or_higher";

export type PlusGrantOutcome =
  | { applied: true; periodEnd: string }
  | { applied: false; reason: PlusGrantSkipReason | "not_attempted" | "write_failed" };
