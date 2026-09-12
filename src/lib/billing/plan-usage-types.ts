import type { PlanTier } from "@/lib/billing/plans";

/** Serializable plan usage for the home sidebar (and similar surfaces). */
export type PlanUsageSummary = {
  tier: PlanTier;
  coursesUsed: number;
  /** `null` = unlimited (Premium or app admin). */
  coursesCap: number | null;
  voiceUsedSeconds: number;
  /** `null` = unlimited (app admin). */
  voiceCapSeconds: number | null;
  recordingsUsed: number;
  /** `null` = unlimited (app admin). */
  recordingsCap: number | null;
};
