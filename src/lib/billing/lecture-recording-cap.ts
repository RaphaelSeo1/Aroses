import "server-only";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import { chatLimitResetsAt } from "@/lib/billing/chat-limits";
import {
  lectureAllowanceFrom,
  lectureMeterDelta,
  type LectureAllowanceNumbers,
} from "@/lib/billing/lecture-minutes";
import { lectureMinutesUsedUpMessage } from "@/lib/billing/limit-messages";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import { planMeterConsume, planMeterGet } from "@/lib/billing/plan-meter-store";
import { lectureCapSeconds, type PlanTier } from "@/lib/billing/plans";
import { getUserSubscription } from "@/lib/billing/subscription";
import { report } from "@/lib/report-error";
import { createAdminClient } from "@/lib/supabase/admin";

/** Kept from the recordings-count era so existing clients still route to billing. */
export const LECTURE_RECORDING_CAP_CODE = "lecture_recording_cap_reached";

export type LectureAllowance = LectureAllowanceNumbers & {
  tier: PlanTier;
  periodStart: string;
  periodEnd: string | null;
  resetsAt: string;
};

/**
 * Sum of recorded seconds on sessions started this period, including
 * soft-deleted ones (deleting a recording doesn't give time back).
 */
async function sessionSecondsThisPeriod(
  userId: string,
  periodStart: string
): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data, error } = await admin
    .from("live_lecture_sessions")
    .select("duration_seconds")
    .eq("user_id", userId)
    .gte("created_at", periodStart)
    .limit(2000);
  if (error) {
    console.error("[billing] lecture session seconds", error);
    return 0;
  }
  let total = 0;
  for (const row of data ?? []) {
    const n = Number((row as { duration_seconds?: unknown }).duration_seconds);
    if (Number.isFinite(n) && n > 0) total += n;
  }
  return total;
}

export async function getLectureAllowance(
  userId: string,
  opts?: { email?: string | null }
): Promise<LectureAllowance> {
  const [sub, unlimited] = await Promise.all([
    getUserSubscription(userId),
    isUnlimitedPlanMeterUser(userId, opts?.email).catch(() => false),
  ]);
  const period = resolveBillingPeriod(sub);
  const [meterSeconds, sessionSeconds] = await Promise.all([
    planMeterGet(userId, "lecture_seconds", period.startIso),
    sessionSecondsThisPeriod(userId, period.startIso),
  ]);
  const numbers = lectureAllowanceFrom({
    capSeconds: lectureCapSeconds(sub.tier),
    meterSeconds,
    sessionSeconds,
    unlimited,
  });
  return {
    ...numbers,
    tier: sub.tier,
    periodStart: period.startIso,
    periodEnd: period.endIso,
    resetsAt: chatLimitResetsAt(period),
  };
}

export function lectureLimitBody(allowance: LectureAllowance) {
  return {
    error: lectureMinutesUsedUpMessage({
      tier: allowance.tier,
      capMinutes: Math.round(allowance.capSeconds / 60),
      periodEnd: allowance.resetsAt,
    }),
    code: LECTURE_RECORDING_CAP_CODE,
    used: Math.floor(allowance.usedSeconds / 60),
    cap: Math.round(allowance.capSeconds / 60),
    resetsAt: allowance.resetsAt,
  };
}

export type LectureRecordingCapOk = {
  ok: true;
  tier: PlanTier;
  /** Minutes recorded this period. */
  used: number;
  /** Minutes allowed this period; `null` = unlimited (app admin). */
  cap: number | null;
  periodStart: string;
};

export type LectureRecordingCapBlocked = {
  ok: false;
  status: 402;
  code: typeof LECTURE_RECORDING_CAP_CODE;
  error: string;
  tier: PlanTier;
  used: number;
  cap: number;
  periodStart: string;
};

/**
 * Gate creating a NEW live lecture session (course or standalone): blocked
 * once no lecture minutes remain this period. Reopening an existing session
 * is not gated here; the Deepgram token route checks minutes on every connect.
 */
export async function assertCanStartLectureRecording(
  userId: string,
  opts?: { email?: string | null }
): Promise<LectureRecordingCapOk | LectureRecordingCapBlocked> {
  const allowance = await getLectureAllowance(userId, opts);
  const used = Math.floor(allowance.usedSeconds / 60);
  if (!allowance.allowed) {
    const body = lectureLimitBody(allowance);
    return {
      ok: false,
      status: 402,
      code: LECTURE_RECORDING_CAP_CODE,
      error: body.error,
      tier: allowance.tier,
      used,
      cap: body.cap,
      periodStart: allowance.periodStart,
    };
  }
  return {
    ok: true,
    tier: allowance.tier,
    used,
    cap: allowance.unlimited ? null : Math.round(allowance.capSeconds / 60),
    periodStart: allowance.periodStart,
  };
}

/**
 * Meter a session's newly recorded seconds. Returns the new metered total to
 * store on the session, or null when nothing was metered (too small a step,
 * or the meter is unavailable — the session sum still counts that time).
 */
export async function meterLectureSession(opts: {
  userId: string;
  durationSeconds: number;
  meteredSeconds: number;
  final?: boolean;
}): Promise<number | null> {
  const delta = lectureMeterDelta(opts);
  if (delta <= 0) return null;
  try {
    const sub = await getUserSubscription(opts.userId);
    const period = resolveBillingPeriod(sub);
    const ok = await planMeterConsume(
      opts.userId,
      "lecture_seconds",
      period.startIso,
      delta
    );
    return ok ? Math.round(opts.meteredSeconds) + delta : null;
  } catch (e) {
    void report("billing.lecture_meter_failed", e, {
      userId: opts.userId,
      detail: { delta },
    });
    return null;
  }
}
