import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getGenerationUsageTotals,
  releaseGenerationUsage,
  reserveCourseGeneration,
  SOURCE_PAGE_CAP_CODE,
} from "@/lib/billing/course-cap";
import { sourcePagesUsedUpMessage } from "@/lib/billing/limit-messages";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import { isPaidTier, sourcePageCap } from "@/lib/billing/plans";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildRunOptions } from "./billing.ts";
import { readCourseBuildConfig } from "./config.ts";
import { createCourseBuild, type NewBuildSource } from "./create-build.ts";
import { languageByCode } from "./language.ts";
import { runCourseBuild } from "./drive.ts";
import { dailyCapUsdForTier } from "./pricing.ts";

/** The after() window of the route that starts a build (its maxDuration is 300 s). */
const FIRST_RUN_MS = 270_000;

/** The Language menu's code as the name stored on the build; null for Match my files. */
export function outputLanguageName(code: unknown): string | null {
  return languageByCode(code)?.name ?? null;
}

export type StartResult =
  | { ok: true; buildId: string }
  | { ok: false; status: number; error: string; code?: string };

export type StartInput = {
  userId: string;
  email: string | null;
  courseId: string;
  examGroupId: string;
  sources: NewBuildSource[];
  outputLanguage: string | null;
  studyGoal: string | null;
};

const METERING_DOWN: StartResult = {
  ok: false,
  status: 503,
  code: "generation_metering_unavailable",
  error: "Billing is temporarily unavailable. Try again in a moment.",
};

/** Plan checks that don't need the build: paid plan and pages left this period. */
export async function checkCanBuild(userId: string, email: string | null): Promise<StartResult | null> {
  if (!readCourseBuildConfig().enabled) {
    return { ok: false, status: 503, code: "course_build_disabled", error: "Course building is turned off right now. Try again later." };
  }
  const sub = await getUserSubscription(userId);
  const unlimited = await isUnlimitedPlanMeterUser(userId, email);
  if (unlimited) return null;
  if (!isPaidTier(sub.tier)) {
    return { ok: false, status: 402, code: "paid_plan_required", error: "Choose a plan to build a course." };
  }
  const period = resolveBillingPeriod(sub);
  const totals = await getGenerationUsageTotals(userId, period.startIso);
  if (!totals) return METERING_DOWN;
  const cap = sourcePageCap(sub.tier);
  if (totals.sourcePages >= cap) {
    return {
      ok: false,
      status: 402,
      code: SOURCE_PAGE_CAP_CODE,
      error: sourcePagesUsedUpMessage({ tier: sub.tier, cap, periodEnd: period.endIso }),
    };
  }
  return null;
}

/**
 * Reserves the course generation, creates the build and starts working it
 * after the response is sent. The build keeps going if the tab closes; the
 * cron sweep picks up anything this run doesn't finish.
 */
export async function startCourseBuild(input: StartInput): Promise<StartResult> {
  const admin = createAdminClient();
  if (!admin) return METERING_DOWN;
  const config = readCourseBuildConfig();
  const buildId = randomUUID();

  const reserved = await reserveCourseGeneration({
    userId: input.userId,
    email: input.email,
    courseId: input.courseId,
    jobId: buildId,
  });
  if (!reserved.ok) return { ok: false, status: reserved.status, code: reserved.code, error: reserved.error };
  const dailyCapUsd = dailyCapUsdForTier(reserved.tier, config, { unlimited: reserved.unlimited });

  try {
    await createCourseBuild(
      admin,
      {
        id: buildId,
        userId: input.userId,
        courseId: input.courseId,
        examGroupId: input.examGroupId,
        sources: input.sources,
        estimatedPages: 0,
        dailyCapUsd,
        outputLanguage: input.outputLanguage,
        studyGoal: input.studyGoal,
        usageReservationId: reserved.reservationId,
      },
      config
    );
  } catch (err) {
    console.error("[course-build] create", err);
    await releaseGenerationUsage(reserved.reservationId);
    await admin.from("course_builds").delete().eq("id", buildId);
    return { ok: false, status: 500, error: "We couldn't start the build. Try again in a moment." };
  }

  kickCourseBuild(buildId);
  return { ok: true, buildId };
}

/** Works the build in this function's after() window. Safe to call twice: one worker wins the lease. */
export function kickCourseBuild(buildId: string) {
  after(async () => {
    try {
      await runCourseBuild(buildId, { ...buildRunOptions, deadlineAt: Date.now() + FIRST_RUN_MS });
    } catch (err) {
      console.error("[course-build] run", buildId, err);
    }
  });
}

/** The build's sources, re-created for a retry (files are kept in storage). */
export async function sourcesForRetry(admin: SupabaseClient, buildId: string): Promise<NewBuildSource[]> {
  const [{ data: sources }, { data: steps }] = await Promise.all([
    admin
      .from("course_build_sources")
      .select("id, position, kind, label, storage_path, source_url, ref_id")
      .eq("build_id", buildId)
      .order("position", { ascending: true }),
    admin.from("course_build_steps").select("input").eq("build_id", buildId).eq("kind", "extract"),
  ]);
  const textBySource = new Map<string, string>();
  for (const s of steps ?? []) {
    const inp = (s.input ?? {}) as { sourceId?: string; text?: unknown };
    if (inp.sourceId && typeof inp.text === "string") textBySource.set(inp.sourceId, inp.text);
  }
  return (sources ?? []).map((s) => ({
    kind: s.kind,
    label: s.label,
    storagePath: s.storage_path,
    sourceUrl: s.source_url,
    refId: s.ref_id,
    text: textBySource.get(s.id) ?? null,
  }));
}
