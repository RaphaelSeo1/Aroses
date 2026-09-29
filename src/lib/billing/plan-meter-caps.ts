import { isAppAdminEnvUser } from "../app-admin-env.ts";
import { chatLimitForTier } from "./chat-limits.ts";
import {
  courseGenerationCap,
  extraQuestionCap,
  lectureCapSeconds,
  sourcePageCap,
  voiceCapSeconds,
  type PlanTier,
} from "./plans.ts";

/** Caps shown/enforced for a user. `null` = unlimited (app admin) or not counted. */
export type PlanMeterCaps = {
  unlimited: boolean;
  /** Only unpaid accounts count builds (0); paid tiers are limited by pages. */
  courseGenerationsCap: number | null;
  sourcePagesCap: number | null;
  lectureCapSeconds: number | null;
  voiceCapSeconds: number | null;
  chatMessagesCap: number | null;
  extraQuestionsCap: number | null;
};

/**
 * App admins (`isAppAdminEnvUser`) get unlimited everything regardless of
 * their Stripe tier.
 */
export function resolvePlanMeterCaps(
  user: { id: string; email?: string | null },
  tier: PlanTier
): PlanMeterCaps {
  if (isAppAdminEnvUser(user)) {
    return {
      unlimited: true,
      courseGenerationsCap: null,
      sourcePagesCap: null,
      lectureCapSeconds: null,
      voiceCapSeconds: null,
      chatMessagesCap: null,
      extraQuestionsCap: null,
    };
  }
  return {
    unlimited: false,
    courseGenerationsCap: courseGenerationCap(tier),
    sourcePagesCap: sourcePageCap(tier),
    lectureCapSeconds: lectureCapSeconds(tier),
    voiceCapSeconds: voiceCapSeconds(tier),
    chatMessagesCap: chatLimitForTier(tier).monthlyMessages,
    extraQuestionsCap: extraQuestionCap(tier),
  };
}
