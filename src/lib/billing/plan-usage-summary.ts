import "server-only";
import { assertCanCreateCourse } from "@/lib/billing/course-cap";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import { resolvePlanMeterCaps } from "@/lib/billing/plan-meter-caps";
import type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";

export type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";

/**
 * Snapshot of metered plan usage for the current billing period.
 * Caps come from `PLANS` unless the user is an app admin (unlimited).
 * Used counts come from the same gates as create-course / start-recording /
 * voice allowance.
 */
export async function getPlanUsageSummary(
  userId: string,
  opts?: { email?: string | null }
): Promise<PlanUsageSummary> {
  const [sub, courseGate, lectureGate, voice] = await Promise.all([
    getUserSubscription(userId),
    assertCanCreateCourse(userId, opts),
    assertCanStartLectureRecording(userId, opts),
    checkVoiceAllowance(userId, opts),
  ]);

  const tier = sub.tier;
  const meters = resolvePlanMeterCaps({ id: userId, email: opts?.email }, tier);
  const unlimited = meters.unlimited || voice.unlimited;

  // Dev voice allowance returns a fake unlimited free meter — keep the UI
  // honest by showing the real plan cap with zero used locally (admins stay
  // unlimited so the card doesn't show Stripe Premium quotas).
  const voiceUsedSeconds =
    process.env.NODE_ENV === "development" && !unlimited
      ? 0
      : Math.max(0, voice.usedSeconds);

  return {
    tier,
    coursesUsed: Math.max(0, courseGate.used),
    coursesCap: unlimited ? null : meters.coursesCap,
    voiceUsedSeconds,
    voiceCapSeconds: unlimited ? null : meters.voiceCapSeconds,
    recordingsUsed: Math.max(0, lectureGate.used),
    recordingsCap: unlimited ? null : meters.recordingsCap,
  };
}
