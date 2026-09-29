import { tf } from "@/lib/i18n/format";
import type { Dictionary } from "@/locales";
import {
  PLANS,
  hasEarlyAccess,
  type PlanLimits,
  type PlanTier,
} from "@/lib/billing/plans";

type BillingCopy = Dictionary["billing"];

export function planDisplayName(t: BillingCopy, tier: PlanTier): string {
  const names: Record<PlanTier, string> = {
    free: t.planFree,
    lite: t.planLite,
    student: t.planStudent,
    plus: t.planPlus,
    pro: t.planPro,
    max: t.planMax,
  };
  return names[tier];
}

/** "1 hour", "3 hours", "1.5 hours" from minutes. */
export function hoursLabel(t: BillingCopy, minutes: number): string {
  const hours = Math.round((minutes / 60) * 10) / 10;
  return hours === 1 ? t.hoursOne : tf(t.hoursMany, { hours });
}

/**
 * Card copy for a plan. Highlights are built from the plan's numbers so the
 * cards can't drift from what's enforced.
 */
export function planCardCopy(
  t: BillingCopy,
  tier: PlanTier,
  limits: PlanLimits = PLANS[tier].limits
): { name: string; tagline: string; includes: string | null; highlights: string[] } {
  const taglines: Record<PlanTier, string> = {
    free: t.planFreeTag,
    lite: t.planLiteTag,
    student: t.planStudentTag,
    plus: t.planPlusTag,
    pro: t.planProTag,
    max: t.planMaxTag,
  };
  const includes: Record<PlanTier, string | null> = {
    free: null,
    lite: t.planLiteIncludes,
    student: t.planStudentIncludes,
    plus: t.planPlusIncludes,
    pro: t.planProIncludes,
    max: t.planMaxIncludes,
  };
  const name = planDisplayName(t, tier);
  if (tier === "free") {
    return {
      name,
      tagline: taglines.free,
      includes: null,
      highlights: [t.planFreeHighlight1, t.planFreeHighlight2, t.planFreeHighlight3],
    };
  }
  const highlights = [
    tf(t.planHighlightPages, { pages: limits.sourcePages.toLocaleString("en-US") }),
    tf(t.planHighlightLecture, { hours: hoursLabel(t, limits.lectureMinutes) }),
    tf(t.planHighlightVoice, { minutes: limits.voiceMinutes }),
    tf(t.planHighlightExtraQuestions, { count: limits.extraQuestionClicks }),
    tf(t.planHighlightPdfs, { count: limits.maxPdfsPerCourse }),
  ];
  if (tier === "lite") highlights.push(t.planHighlightCore);
  if (hasEarlyAccess(tier)) highlights.push(t.planHighlightEarlyAccess);
  return { name, tagline: taglines[tier], includes: includes[tier], highlights };
}
