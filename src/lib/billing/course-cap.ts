import "server-only";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import {
  courseGenerationCap,
  isPaidTier,
  PLANS,
  type PlanTier,
} from "@/lib/billing/plans";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";
import type { GenerationReason } from "@/lib/billing/generation-usage-ledger";
import {
  additionalMaterialIdempotencyKey,
  initialGenerationIdempotencyKey,
  jobGenerationIdempotencyKey,
} from "@/lib/billing/generation-usage-ledger";

export const COURSE_CAP_CODE = "course_generation_cap_reached";
export const COURSE_GENERATION_CAP_CODE = "course_generation_cap_reached";
export const SOURCE_PAGE_CAP_CODE = "source_page_cap_reached";
export const GENERATION_METERING_UNAVAILABLE_CODE =
  "generation_metering_unavailable";
export const PAID_GENERATION_REQUIRED_CODE = "paid_plan_required";

export type CourseCapOk = {
  ok: true;
  tier: PlanTier;
  used: number;
  cap: number | null;
};

export type CourseCapBlocked = {
  ok: false;
  status: 402 | 503;
  code: string;
  error: string;
  tier: PlanTier;
  used: number;
  cap: number;
};

function resetLabel(iso: string | null): string {
  if (!iso) return "your next billing period";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "your next billing period";
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

export function courseGenerationCapMessage(opts: {
  tier: PlanTier;
  cap: number;
  periodEnd: string | null;
}): string {
  const planName = PLANS[opts.tier].name;
  if (!isPaidTier(opts.tier) || opts.cap <= 0) {
    return "Choose a plan to generate an AI course.";
  }
  return `You've used all ${opts.cap} AI course generations included with ${planName} for this billing period. Your allowance resets on ${resetLabel(opts.periodEnd)}, or you can upgrade for a higher limit.`;
}

export function sourcePageCapMessage(opts: {
  remaining: number;
  needed: number;
  periodEnd: string | null;
}): string {
  return `You have ${opts.remaining} source pages remaining this billing period. This material contains ${opts.needed} pages. Remove some source material or upgrade your plan.`;
}

type UsageRpcRow = {
  id?: string;
  course_generation_units?: number;
  source_page_units?: number;
  status?: string;
};

function firstRpcRow(data: unknown): UsageRpcRow | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as UsageRpcRow) ?? null;
  return data as UsageRpcRow;
}

export async function getGenerationUsageTotals(
  userId: string,
  periodStart: string
): Promise<{ courseGenerations: number; sourcePages: number } | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin.rpc("get_subscription_generation_usage", {
    p_user_id: userId,
    p_period_start: periodStart,
  });
  if (error) {
    console.error("[billing] get_subscription_generation_usage", error);
    return null;
  }
  const row = firstRpcRow(data);
  return {
    courseGenerations: Number(row?.course_generation_units ?? 0),
    sourcePages: Number(row?.source_page_units ?? 0),
  };
}

/**
 * Empty course shells are not metered. This remains for older call sites that
 * gated `courses` inserts; it only requires a paid plan (unpaid traffic is
 * also blocked by the app proxy). Generation credits are reserved in
 * process-pdf / the ingest runner.
 */
export async function assertCanCreateCourse(
  userId: string,
  opts?: { email?: string | null }
): Promise<CourseCapOk | CourseCapBlocked> {
  const sub = await getUserSubscription(userId);
  const tier = sub.tier;
  const unlimited = await isUnlimitedPlanMeterUser(userId, opts?.email);
  const period = resolveBillingPeriod(sub);
  const cap = unlimited ? null : courseGenerationCap(tier);

  if (!unlimited && !isPaidTier(tier)) {
    return {
      ok: false,
      status: 402,
      code: PAID_GENERATION_REQUIRED_CODE,
      error: "Choose a plan to generate an AI course.",
      tier,
      used: 0,
      cap: 0,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return { ok: true, tier, used: 0, cap };
  }

  const totals = await getGenerationUsageTotals(userId, period.startIso);
  const used = totals?.courseGenerations ?? 0;
  return { ok: true, tier, used, cap };
}

export type GenerationReserveOk = {
  ok: true;
  reservationId: string;
  reason: GenerationReason;
  generationUnits: number;
  tier: PlanTier;
  used: number;
  cap: number;
  periodStart: string;
  periodEnd: string | null;
  unlimited: boolean;
};

export type GenerationReserveBlocked = CourseCapBlocked;

async function courseAlreadyHasInitialGeneration(
  userId: string,
  courseId: string
): Promise<boolean | null> {
  const admin = createAdminClient();
  if (!admin) return null;

  const { data: usage, error: usageErr } = await admin
    .from("subscription_generation_usage")
    .select("id")
    .eq("course_id", courseId)
    .eq("generation_reason", "initial")
    .in("status", ["reserved", "completed"])
    .gt("course_generation_units", 0)
    .limit(1)
    .maybeSingle();
  if (!usageErr && usage?.id) return true;

  const { count, error } = await admin
    .from("study_materials")
    .select("id", { count: "exact", head: true })
    .eq("course_id", courseId);
  if (error) {
    console.error("[billing] study_materials count", error);
    return null;
  }
  return (count ?? 0) > 0;
}

export async function reserveCourseGeneration(opts: {
  userId: string;
  email?: string | null;
  courseId: string;
  jobId: string | null;
}): Promise<GenerationReserveOk | GenerationReserveBlocked> {
  const sub = await getUserSubscription(opts.userId);
  const tier = sub.tier;
  const period = resolveBillingPeriod(sub);
  const unlimited = await isUnlimitedPlanMeterUser(opts.userId, opts.email);
  const cap = unlimited ? Number.MAX_SAFE_INTEGER : courseGenerationCap(tier);

  if (!unlimited && !isPaidTier(tier)) {
    return {
      ok: false,
      status: 402,
      code: PAID_GENERATION_REQUIRED_CODE,
      error: "Choose a plan to generate an AI course.",
      tier,
      used: 0,
      cap: 0,
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      tier,
      used: 0,
      cap: courseGenerationCap(tier),
    };
  }

  const already = await courseAlreadyHasInitialGeneration(
    opts.userId,
    opts.courseId
  );
  if (already == null) {
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      tier,
      used: 0,
      cap: courseGenerationCap(tier),
    };
  }

  const reason: GenerationReason = already
    ? "additional_material"
    : "initial";
  const generationUnits = reason === "initial" ? 1 : 0;
  const idempotencyKey = opts.jobId
    ? reason === "initial"
      ? initialGenerationIdempotencyKey(opts.courseId)
      : additionalMaterialIdempotencyKey(opts.jobId)
    : reason === "initial"
      ? initialGenerationIdempotencyKey(opts.courseId)
      : jobGenerationIdempotencyKey(`${opts.courseId}:${Date.now()}`);

  const { data, error } = await admin.rpc("reserve_course_generation", {
    p_user_id: opts.userId,
    p_course_id: opts.courseId,
    p_job_id: opts.jobId,
    p_period_start: period.startIso,
    p_period_end: period.endIso,
    p_tier: tier,
    p_reason: reason,
    p_generation_units: generationUnits,
    p_idempotency_key: idempotencyKey,
    p_cap: unlimited ? null : cap,
  });

  if (error) {
    const msg = error.message ?? "";
    if (/course_generation_cap_reached/i.test(msg)) {
      const totals = await getGenerationUsageTotals(
        opts.userId,
        period.startIso
      );
      const used = totals?.courseGenerations ?? cap;
      return {
        ok: false,
        status: 402,
        code: COURSE_GENERATION_CAP_CODE,
        error: courseGenerationCapMessage({
          tier,
          cap: courseGenerationCap(tier),
          periodEnd: period.endIso,
        }),
        tier,
        used,
        cap: courseGenerationCap(tier),
      };
    }
    console.error("[billing] reserve_course_generation", error);
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      tier,
      used: 0,
      cap: courseGenerationCap(tier),
    };
  }

  const row = firstRpcRow(data);
  const reservationId = typeof row?.id === "string" ? row.id : "";
  if (!reservationId) {
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      tier,
      used: 0,
      cap: courseGenerationCap(tier),
    };
  }

  const totals = await getGenerationUsageTotals(opts.userId, period.startIso);
  return {
    ok: true,
    reservationId,
    reason,
    generationUnits,
    tier,
    used: totals?.courseGenerations ?? generationUnits,
    cap: courseGenerationCap(tier),
    periodStart: period.startIso,
    periodEnd: period.endIso,
    unlimited,
  };
}

export async function reserveSourcePages(opts: {
  userId: string;
  reservationId: string;
  sourcePageUnits: number;
  cap: number;
  periodStart: string;
  periodEnd: string | null;
}): Promise<
  | { ok: true }
  | { ok: false; status: 402 | 503; code: string; error: string; remaining: number; needed: number }
> {
  const admin = createAdminClient();
  if (!admin) {
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      remaining: 0,
      needed: opts.sourcePageUnits,
    };
  }

  const { error } = await admin.rpc("reserve_source_pages", {
    p_reservation_id: opts.reservationId,
    p_user_id: opts.userId,
    p_source_page_units: opts.sourcePageUnits,
    p_cap: opts.cap,
    p_period_start: opts.periodStart,
  });

  if (error) {
    const msg = error.message ?? "";
    if (/source_page_cap_reached/i.test(msg)) {
      const totals = await getGenerationUsageTotals(
        opts.userId,
        opts.periodStart
      );
      const used = totals?.sourcePages ?? 0;
      const remaining = Math.max(0, opts.cap - used);
      return {
        ok: false,
        status: 402,
        code: SOURCE_PAGE_CAP_CODE,
        error: sourcePageCapMessage({
          remaining,
          needed: opts.sourcePageUnits,
          periodEnd: opts.periodEnd,
        }),
        remaining,
        needed: opts.sourcePageUnits,
      };
    }
    console.error("[billing] reserve_source_pages", error);
    return {
      ok: false,
      status: 503,
      code: GENERATION_METERING_UNAVAILABLE_CODE,
      error:
        "Billing metering is temporarily unavailable. Try again in a moment.",
      remaining: 0,
      needed: opts.sourcePageUnits,
    };
  }

  return { ok: true };
}

export async function finalizeGenerationUsage(
  reservationId: string | null | undefined
): Promise<void> {
  if (!reservationId) return;
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.rpc("finalize_generation_usage", {
    p_reservation_id: reservationId,
  });
  if (error) {
    console.error("[billing] finalize_generation_usage", error);
  }
}

export async function releaseGenerationUsage(
  reservationId: string | null | undefined
): Promise<void> {
  if (!reservationId) return;
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin.rpc("release_generation_usage", {
    p_reservation_id: reservationId,
  });
  if (error) {
    console.error("[billing] release_generation_usage", error);
  }
}

export async function lookupReservationIdForJob(
  jobId: string
): Promise<string | null> {
  const admin = createAdminClient();
  if (!admin) return null;
  const { data, error } = await admin
    .from("pdf_ingest_jobs")
    .select("usage_reservation_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!error && data) {
    const id = (data as { usage_reservation_id?: unknown }).usage_reservation_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  const { data: usage } = await admin
    .from("subscription_generation_usage")
    .select("id")
    .eq("job_id", jobId)
    .in("status", ["reserved", "completed"])
    .limit(1)
    .maybeSingle();
  return typeof usage?.id === "string" && usage.id.length > 0 ? usage.id : null;
}

export async function finalizeUsageForJob(jobId: string): Promise<void> {
  const id = await lookupReservationIdForJob(jobId);
  await finalizeGenerationUsage(id);
}

export async function releaseUsageForJob(jobId: string): Promise<void> {
  const id = await lookupReservationIdForJob(jobId);
  await releaseGenerationUsage(id);
}
