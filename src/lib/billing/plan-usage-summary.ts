import "server-only";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import {
  getGenerationUsageTotals,
} from "@/lib/billing/course-cap";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import { resolvePlanMeterCaps } from "@/lib/billing/plan-meter-caps";
import type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";

export type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";

/**
 * Snapshot of metered plan usage for the current billing period.
 * Course generations and source pages come from the usage ledger — never
 * from COUNT(*) on courses.
 */
export async function getPlanUsageSummary(
  userId: string,
  opts?: { email?: string | null }
): Promise<PlanUsageSummary> {
  const [sub, lectureGate, voice] = await Promise.all([
    getUserSubscription(userId),
    assertCanStartLectureRecording(userId, opts),
    checkVoiceAllowance(userId, opts),
  ]);

  const tier = sub.tier;
  const period = resolveBillingPeriod(sub);
  const meters = resolvePlanMeterCaps({ id: userId, email: opts?.email }, tier);
  const unlimited = meters.unlimited || voice.unlimited;

  const totals = await getGenerationUsageTotals(userId, period.startIso);
  const courseGenerationsUsed = Math.max(0, totals?.courseGenerations ?? 0);
  const sourcePagesUsed = Math.max(0, totals?.sourcePages ?? 0);

  const voiceUsedSeconds =
    process.env.NODE_ENV === "development" && !unlimited
      ? 0
      : Math.max(0, voice.usedSeconds);

  const courseGenerationsCap = unlimited ? null : meters.courseGenerationsCap;
  const sourcePagesCap = unlimited ? null : meters.sourcePagesCap;

  return {
    tier,
    courseGenerationsUsed,
    courseGenerationsCap,
    sourcePagesUsed,
    sourcePagesCap,
    voiceUsedSeconds,
    voiceCapSeconds: unlimited ? null : meters.voiceCapSeconds,
    recordingsUsed: Math.max(0, lectureGate.used),
    recordingsCap: unlimited ? null : meters.recordingsCap,
    periodStart: period.startIso,
    periodEnd: period.endIso,
    coursesUsed: courseGenerationsUsed,
    coursesCap: courseGenerationsCap,
  };
}
