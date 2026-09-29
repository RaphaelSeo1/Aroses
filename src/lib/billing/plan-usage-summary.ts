import "server-only";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import { chatLimitResetsAt } from "@/lib/billing/chat-limits";
import { getGenerationUsageTotals } from "@/lib/billing/course-cap";
import { getLectureAllowance } from "@/lib/billing/lecture-recording-cap";
import { resolvePlanMeterCaps } from "@/lib/billing/plan-meter-caps";
import { planMeterGet } from "@/lib/billing/plan-meter-store";
import type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { createAdminClient } from "@/lib/supabase/admin";

export type { PlanUsageSummary } from "@/lib/billing/plan-usage-types";

/** Chat messages counted this period (0 before migration 117 or on a new period). */
async function chatMessagesUsed(userId: string, periodStart: string): Promise<number> {
  const admin = createAdminClient();
  if (!admin) return 0;
  const { data, error } = await admin
    .from("chat_message_usage")
    .select("messages_used, period_start")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return 0;
  const stored = Date.parse(String(data.period_start));
  if (!Number.isFinite(stored) || stored < Date.parse(periodStart)) return 0;
  return Math.max(0, Number(data.messages_used) || 0);
}

/**
 * Snapshot of metered plan usage for the current billing period. Course
 * pages come from the usage ledger — never from COUNT(*) on courses.
 */
export async function getPlanUsageSummary(
  userId: string,
  opts?: { email?: string | null }
): Promise<PlanUsageSummary> {
  const [sub, lecture, voice] = await Promise.all([
    getUserSubscription(userId),
    getLectureAllowance(userId, opts),
    checkVoiceAllowance(userId, opts),
  ]);

  const tier = sub.tier;
  const period = resolveBillingPeriod(sub);
  const meters = resolvePlanMeterCaps({ id: userId, email: opts?.email }, tier);
  const unlimited = meters.unlimited || voice.unlimited || lecture.unlimited;

  const [totals, chatUsed, extraUsed] = await Promise.all([
    getGenerationUsageTotals(userId, period.startIso),
    chatMessagesUsed(userId, period.startIso),
    planMeterGet(userId, "extra_questions", period.startIso),
  ]);

  const voiceUsedSeconds =
    process.env.NODE_ENV === "development" && !unlimited
      ? 0
      : Math.max(0, voice.usedSeconds);

  return {
    tier,
    sourcePagesUsed: Math.max(0, totals?.sourcePages ?? 0),
    sourcePagesCap: unlimited ? null : meters.sourcePagesCap,
    lectureMinutesUsed: Math.floor(lecture.usedSeconds / 60),
    lectureMinutesCap:
      unlimited || meters.lectureCapSeconds == null
        ? null
        : Math.round(meters.lectureCapSeconds / 60),
    voiceUsedSeconds,
    voiceCapSeconds: unlimited ? null : meters.voiceCapSeconds,
    chatMessagesUsed: chatUsed,
    chatMessagesCap: unlimited ? null : meters.chatMessagesCap,
    extraQuestionsUsed: Math.round(extraUsed ?? 0),
    extraQuestionsCap: unlimited ? null : meters.extraQuestionsCap,
    periodStart: period.startIso,
    periodEnd: period.endIso ?? chatLimitResetsAt(period),
  };
}
