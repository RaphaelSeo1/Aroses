import "server-only";
import {
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
  cap: number;
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
 * Billing-period anchor (same rules as voice usage): paid users reset on
 * Stripe's current_period_start; free users on the 1st of the UTC month.
 */
function resolvePeriod(sub: {
  tier: PlanTier;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
}): { start: Date; end: string | null } {
  if (sub.tier !== "free" && sub.currentPeriodStart) {
    const start = new Date(sub.currentPeriodStart);
    if (!Number.isNaN(start.getTime())) {
      return { start, end: sub.currentPeriodEnd };
    }
  }
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0)
  );
  return { start, end: end.toISOString() };
}

/**
 * Gate creating a NEW live lecture session (course or standalone).
 * Reopening an existing session does not consume another slot.
 */
export async function assertCanStartLectureRecording(
  userId: string
): Promise<LectureRecordingCapOk | LectureRecordingCapBlocked> {
  const sub = await getUserSubscription(userId);
  const tier = sub.tier;
  const cap = lectureRecordingCap(tier);
  const { start } = resolvePeriod(sub);
  const periodStart = start.toISOString();

  const admin = createAdminClient();
  if (!admin) {
    return { ok: true, tier, used: 0, cap, periodStart };
  }

  let query = admin
    .from("live_lecture_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", periodStart);

  // Soft-delete column may be missing pre-migration — retry without it.
  let { count, error } = await query.is("deleted_at", null);

  if (error && /deleted_at/i.test(error.message ?? "")) {
    ({ count, error } = await admin
      .from("live_lecture_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", periodStart));
  }

  if (error) {
    console.error("[billing] lecture recording count", error);
    return { ok: true, tier, used: 0, cap, periodStart };
  }

  const used = count ?? 0;
  if (used >= cap) {
    const planName = PLANS[tier].name;
    const upgradeHint =
      tier === "premium"
        ? "You've used all lecture recordings for this billing period."
        : tier === "advanced"
          ? `Your ${planName} plan includes ${cap} lecture recordings per month. Upgrade to Premium for 20 / month.`
          : tier === "student"
            ? `Your ${planName} plan includes ${cap} lecture recordings per month. Upgrade to Advanced for 10 / month or Premium for 20 / month.`
            : `Free includes ${cap} lecture recording per month. Upgrade to Student for 5, Advanced for 10, or Premium for 20 / month.`;
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
