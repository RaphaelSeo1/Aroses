import type { PlanTier } from "@/lib/billing/plans";

/**
 * Serializable plan usage for the home sidebar (and similar surfaces).
 * Every `*Cap` is `null` when unlimited (app admin).
 */
export type PlanUsageSummary = {
  tier: PlanTier;

  /** Pages of course material read by the course builder this period. */
  sourcePagesUsed: number;
  sourcePagesCap: number | null;

  lectureMinutesUsed: number;
  lectureMinutesCap: number | null;

  voiceUsedSeconds: number;
  voiceCapSeconds: number | null;

  chatMessagesUsed: number;
  chatMessagesCap: number | null;

  extraQuestionsUsed: number;
  extraQuestionsCap: number | null;

  periodStart: string;
  periodEnd: string | null;
};
