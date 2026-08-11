import type { PlanTier } from "@/lib/billing/plans";

/** Serializable plan usage for the home sidebar (and similar surfaces). */
export type PlanUsageSummary = {
  tier: PlanTier;
  coursesUsed: number;
  /** `null` = unlimited (Premium). */
  coursesCap: number | null;
  voiceUsedSeconds: number;
  voiceCapSeconds: number;
  recordingsUsed: number;
  recordingsCap: number;
};
