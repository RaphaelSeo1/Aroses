import { isAppAdminEnvUser } from "../app-admin-env.ts";
import {
  courseGenerationCap,
  lectureRecordingCap,
  sourcePageCap,
  voiceCapSeconds,
  type PlanTier,
} from "./plans.ts";

/** Caps shown/enforced for a user. `null` = unlimited (app admin). */
export type PlanMeterCaps = {
  unlimited: boolean;
  /** @deprecated Alias of courseGenerationsCap (not owned-course count). */
  coursesCap: number | null;
  courseGenerationsCap: number | null;
  sourcePagesCap: number | null;
  voiceCapSeconds: number | null;
  recordingsCap: number | null;
};

/**
 * App admins (`isAppAdminEnvUser`) get unlimited voice, generations,
 * source pages, and lecture recordings regardless of their Stripe tier.
 */
export function resolvePlanMeterCaps(
  user: { id: string; email?: string | null },
  tier: PlanTier
): PlanMeterCaps {
  if (isAppAdminEnvUser(user)) {
    return {
      unlimited: true,
      coursesCap: null,
      courseGenerationsCap: null,
      sourcePagesCap: null,
      voiceCapSeconds: null,
      recordingsCap: null,
    };
  }
  const gens = courseGenerationCap(tier);
  return {
    unlimited: false,
    coursesCap: gens,
    courseGenerationsCap: gens,
    sourcePagesCap: sourcePageCap(tier),
    voiceCapSeconds: voiceCapSeconds(tier),
    recordingsCap: lectureRecordingCap(tier),
  };
}
