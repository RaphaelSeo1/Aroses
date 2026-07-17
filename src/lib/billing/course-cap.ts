import "server-only";
import { courseCap, PLANS, type PlanTier } from "@/lib/billing/plans";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";

export const COURSE_CAP_CODE = "course_cap_reached";

export type CourseCapOk = {
  ok: true;
  tier: PlanTier;
  used: number;
  cap: number | null;
};

export type CourseCapBlocked = {
  ok: false;
  status: 402;
  code: typeof COURSE_CAP_CODE;
  error: string;
  tier: PlanTier;
  used: number;
  cap: number;
};

/**
 * Gate creating a new owned course against the plan's `maxCourses`.
 * Call before every `courses` insert. Rebuilding materials on an existing
 * course is not gated here.
 */
export async function assertCanCreateCourse(
  userId: string
): Promise<CourseCapOk | CourseCapBlocked> {
  const sub = await getUserSubscription(userId);
  const tier = sub.tier;
  const cap = courseCap(tier);

  const admin = createAdminClient();
  if (!admin) {
    // No service role in this env — skip the hard gate rather than 500.
    return { ok: true, tier, used: 0, cap };
  }

  const { count, error } = await admin
    .from("courses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    console.error("[billing] course count", error);
    // Fail open on count errors so a metering blip never blocks study.
    return { ok: true, tier, used: 0, cap };
  }

  const used = count ?? 0;
  if (cap != null && used >= cap) {
    const planName = PLANS[tier].name;
    return {
      ok: false,
      status: 402,
      code: COURSE_CAP_CODE,
      error:
        tier === "student"
          ? `Your ${planName} plan includes up to ${cap} courses. Upgrade to Premium for unlimited course building.`
          : `Your ${planName} plan includes up to ${cap} courses. Delete a course or upgrade to create another.`,
      tier,
      used,
      cap,
    };
  }

  return { ok: true, tier, used, cap };
}
