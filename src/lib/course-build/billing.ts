import "server-only";
import { isUnlimitedPlanMeterUser } from "@/lib/billing/plan-cap-exempt";
import { resolveBillingPeriod } from "@/lib/billing/billing-period";
import {
  finalizeGenerationUsage,
  releaseGenerationUsage,
  reserveSourcePages,
} from "@/lib/billing/course-cap";
import { sourcePageCap } from "@/lib/billing/plans";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";
import { StepFatalError } from "./errors.ts";
import type { BuildRecord } from "./handlers.ts";
import type { TerminalEvent } from "./runner.ts";
import { removeBuildFigures } from "./supabase-build-data.ts";

/** Postgres int max: the RPC's "no cap" for unlimited accounts. */
const NO_PAGE_CAP = 2_147_483_647;

/**
 * Sets the build's source pages on its usage reservation once extraction has
 * counted them. Runs before the first AI call, so an over-limit upload costs
 * nothing.
 */
export async function reserveBuildPages(build: BuildRecord, pages: number): Promise<void> {
  if (!build.usageReservationId) {
    throw new StepFatalError("generation_metering_unavailable", "Billing is temporarily unavailable. Try again in a moment.");
  }
  const sub = await getUserSubscription(build.userId);
  const period = resolveBillingPeriod(sub);
  const unlimited = await isUnlimitedPlanMeterUser(build.userId);
  const res = await reserveSourcePages({
    userId: build.userId,
    reservationId: build.usageReservationId,
    sourcePageUnits: pages,
    cap: unlimited ? NO_PAGE_CAP : sourcePageCap(sub.tier),
    periodStart: period.startIso,
    periodEnd: period.endIso,
  });
  if (res.ok) return;
  if (res.status === 402) throw new StepFatalError(res.code, res.error);
  // Metering hiccup: a plain error is retried by the runner.
  throw new Error(res.error);
}

/**
 * Charges a finished build; a failed or canceled one is released, and its
 * half-written material and uploaded figures are removed so the course never
 * shows a partial.
 */
export async function settleBuildUsage(event: TerminalEvent): Promise<void> {
  if (event.status === "complete") {
    await finalizeGenerationUsage(event.usageReservationId);
    return;
  }
  await releaseGenerationUsage(event.usageReservationId);
  const admin = createAdminClient();
  if (!admin) return;
  const { error } = await admin
    .from("study_materials")
    .update({ deleted_at: new Date().toISOString() })
    .eq("build_id", event.buildId)
    .is("deleted_at", null);
  if (error) console.error("[course-build] hide partial material", event.buildId, error);
  await removeBuildFigures(admin, event.buildId).catch((err) =>
    console.error("[course-build] remove figures", event.buildId, err)
  );
}

export const buildRunOptions = {
  reservePages: reserveBuildPages,
  onTerminal: settleBuildUsage,
  log: (msg: string, extra?: Record<string, unknown>) => console.log(`[course-build] ${msg}`, extra ?? ""),
};
