import type { PlanTier } from "@/lib/billing/plans";

/** Serializable plan usage for the home sidebar (and similar surfaces). */
export type PlanUsageSummary = {
  tier: PlanTier;

  courseGenerationsUsed: number;
  courseGenerationsCap: number | null;

  sourcePagesUsed: number;
  sourcePagesCap: number | null;

  voiceUsedSeconds: number;
  /** `null` = unlimited (app admin). */
  voiceCapSeconds: number | null;

  recordingsUsed: number;
  /** `null` = unlimited (app admin). */
  recordingsCap: number | null;

  periodStart: string;
  periodEnd: string | null;

  /**
   * @deprecated Use courseGenerationsUsed. Kept so older UI does not crash
   * during rolling deploys.
   */
  coursesUsed: number;
  /** @deprecated Use courseGenerationsCap. */
  coursesCap: number | null;
};
