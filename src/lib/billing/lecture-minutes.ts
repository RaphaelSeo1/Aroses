/**
 * Live lecture hours: recorded (Deepgram-connected) seconds per billing
 * period. Pure rules; the server check lives in `lecture-recording-cap.ts`.
 *
 * Usage is the larger of two readings: the server-only meter
 * (`plan_meter_usage`, migration 119) and the sum of this period's session
 * `duration_seconds`. The meter can't be edited from the browser; the session
 * sum covers time recorded before the migration existed.
 */

/** Warn when this much recording time is left. */
export const LECTURE_WARN_SECONDS = 5 * 60;

export type LectureAllowanceNumbers = {
  unlimited: boolean;
  capSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  allowed: boolean;
};

export function lectureAllowanceFrom(input: {
  capSeconds: number;
  meterSeconds: number | null;
  sessionSeconds: number;
  unlimited: boolean;
}): LectureAllowanceNumbers {
  const capSeconds = Math.max(0, Math.round(input.capSeconds));
  const usedSeconds = Math.max(
    0,
    Math.round(Math.max(input.meterSeconds ?? 0, input.sessionSeconds))
  );
  if (input.unlimited) {
    return {
      unlimited: true,
      capSeconds,
      usedSeconds,
      remainingSeconds: Number.MAX_SAFE_INTEGER,
      allowed: true,
    };
  }
  const remainingSeconds = Math.max(0, capSeconds - usedSeconds);
  return {
    unlimited: false,
    capSeconds,
    usedSeconds,
    remainingSeconds,
    allowed: remainingSeconds > 0,
  };
}

/**
 * The session's recorded length at which the plan runs out: what this session
 * has recorded so far (already inside `usedSeconds`) plus what's left. Null
 * when unlimited.
 */
export function sessionLimitSeconds(input: {
  allowance: LectureAllowanceNumbers;
  sessionRecordedSeconds: number;
}): number | null {
  if (input.allowance.unlimited) return null;
  return Math.max(0, Math.round(input.sessionRecordedSeconds)) + input.allowance.remainingSeconds;
}

export type LectureLimitState = "ok" | "warn" | "reached";

export function lectureLimitState(
  elapsedSeconds: number,
  limitSeconds: number | null
): LectureLimitState {
  if (limitSeconds == null) return "ok";
  if (elapsedSeconds >= limitSeconds) return "reached";
  if (limitSeconds - elapsedSeconds <= LECTURE_WARN_SECONDS) return "warn";
  return "ok";
}

/** Seconds to add to the meter for a session flush (only whole-minute steps unless `final`). */
export function lectureMeterDelta(input: {
  durationSeconds: number;
  meteredSeconds: number;
  final?: boolean;
}): number {
  const delta = Math.round(input.durationSeconds) - Math.round(input.meteredSeconds);
  if (delta <= 0) return 0;
  if (!input.final && delta < 60) return 0;
  return delta;
}
