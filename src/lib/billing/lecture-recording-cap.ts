import "server-only";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import {
  isPaidTier,
  lectureRecordingCap,
  PLANS,
  type PlanTier,
} from "@/lib/billing/plans";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";

export const LECTURE_RECORDING_CAP_CODE = "lecture_recording_cap_reached";

export type LectureRecordingCapOk = {
  ok: true;
  tier: PlanTier;
  used: number;
  /** `null` = unlimited (app admin). */
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

function resolvePeriod(sub: {
  tier: PlanTier;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): { start: Date; end: string | null } {
  const period = resolveBillingPeriod(sub);
  return { start: period.start, end: period.endIso };
}

/**
 * Gate creating a NEW live lecture session (course or standalone).
 * Reopening an existing session does not consume another slot.
 */
export async function assertCanStartLectureRecording(
  userId: string,
  opts?: { email?: string | null }
): Promise<LectureRecordingCapOk | LectureRecordingCapBlocked> {
  const sub = await getUserSubscription(userId);
  const tier = sub.tier;
  const unlimited = await isUnlimitedPlanMeterUser(userId, opts?.email);
  const cap = unlimited ? null : lectureRecordingCap(tier);
  const { start } = resolvePeriod(sub);
  const periodStart = start.toISOString();

  const admin = createAdminClient();
  if (!admin) {
    return { ok: true, tier, used: 0, cap, periodStart };
  }

  // Count every started session in the period, including soft-deleted rows.
  // Deleting a recording must not restore a monthly slot.
  const { count, error } = await admin
    .from("live_lecture_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", periodStart);

  if (error) {
    console.error("[billing] lecture recording count", error);
    return { ok: true, tier, used: 0, cap, periodStart };
  }

  const used = count ?? 0;
  if (cap != null && used >= cap) {
    const planName = PLANS[tier].name;
    const upgradeHint = !isPaidTier(tier)
      ? "Choose a plan to record lectures."
      : `You've used all ${cap} lecture recordings included with ${planName} this billing period.`;
    return {
      ok: false,
      status: 402,
      code: LECTURE_RECORDING_CAP_CODE,
      error: upgradeHint,
      tier,
      used,
      cap,
      periodStart,
    };
  }

  return { ok: true, tier, used, cap, periodStart };
}
