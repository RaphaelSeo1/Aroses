import { isAppAdminEnvUser } from "../app-admin-env.ts";
import {
  courseCap,
  lectureRecordingCap,
  voiceCapSeconds,
  type PlanTier,
} from "./plans.ts";

/** Caps shown/enforced for a user. `null` = unlimited. */
export type PlanMeterCaps = {
  unlimited: boolean;
  coursesCap: number | null;
  voiceCapSeconds: number | null;
  recordingsCap: number | null;
};

/**
 * App admins (`isAppAdminEnvUser`) get unlimited voice, courses, and
 * lecture recordings regardless of their Stripe tier.
 */
export function resolvePlanMeterCaps(
  user: { id: string; email?: string | null },
  tier: PlanTier
): PlanMeterCaps {
  if (isAppAdminEnvUser(user)) {
    return {
      unlimited: true,
      coursesCap: null,
      voiceCapSeconds: null,
      recordingsCap: null,
    };
  }
  return {
    unlimited: false,
    coursesCap: courseCap(tier),
    voiceCapSeconds: voiceCapSeconds(tier),
    recordingsCap: lectureRecordingCap(tier),
  };
}
