import type { SupabaseClient } from "@supabase/supabase-js";
import type { CourseBuildConfig } from "./config.ts";
import { TEXT_KINDS, type SourceKind } from "./handlers.ts";
import { buildSpendCapUsd } from "./pricing.ts";

export type NewBuildSource = {
  kind: SourceKind;
  label: string;
  /** Object path in the upload bucket, for file sources. */
  storagePath?: string | null;
  /** Full text, for pasted text, transcripts, notes and sessions. */
  text?: string | null;
  sourceUrl?: string | null;
  refId?: string | null;
};

export type NewBuild = {
  /** Chosen up front when billing needs the id before the row exists. */
  id?: string;
  userId: string;
  courseId: string;
  examGroupId: string;
  sources: NewBuildSource[];
  /** Page estimate used for the spend cap until extraction counts the real pages. */
  estimatedPages: number;
  dailyCapUsd: number;
  outputLanguage?: string | null;
  studyGoal?: string | null;
  usageReservationId?: string | null;
};

/**
 * Inserts the build, its sources and its first steps (one extract per source,
 * then the plan). The plan step adds the module and finalize steps.
 */
export async function createCourseBuild(
  admin: SupabaseClient,
  input: NewBuild,
  config: CourseBuildConfig
): Promise<string> {
  if (input.sources.length === 0) throw new Error("a build needs at least one source");

  const { data: build, error } = await admin
    .from("course_builds")
    .insert({
      ...(input.id ? { id: input.id } : {}),
      user_id: input.userId,
      course_id: input.courseId,
      exam_group_id: input.examGroupId,
      output_language: input.outputLanguage ?? null,
      study_goal: input.studyGoal?.trim() || null,
      source_pages: Math.max(0, Math.round(input.estimatedPages)),
      spend_cap_usd: buildSpendCapUsd(input.estimatedPages, config),
      daily_cap_usd: input.dailyCapUsd,
      usage_reservation_id: input.usageReservationId ?? null,
    })
    .select("id")
    .single();
  if (error || !build) throw new Error(`create course build: ${error?.message ?? "no row"}`);
  const buildId = String(build.id);

  const { data: sources, error: srcErr } = await admin
    .from("course_build_sources")
    .insert(
      input.sources.map((s, position) => ({
        build_id: buildId,
        user_id: input.userId,
        position,
        kind: s.kind,
        label: s.label.slice(0, 200),
        storage_path: s.storagePath ?? null,
        source_url: s.sourceUrl ?? null,
        ref_id: s.refId ?? null,
      }))
    )
    .select("id, position");
  if (srcErr || !sources) throw new Error(`create build sources: ${srcErr?.message ?? "no rows"}`);

  const byPosition = new Map(sources.map((s) => [s.position as number, String(s.id)]));
  const steps = input.sources.map((s, position) => ({
    build_id: buildId,
    kind: "extract",
    ordinal: position,
    wave: 0,
    max_attempts: config.maxStepAttempts,
    input: {
      sourceId: byPosition.get(position),
      ...(typeof s.text === "string" ? { text: s.text } : TEXT_KINDS.has(s.kind) && !s.storagePath ? { text: "" } : {}),
    },
  }));
  steps.push({ build_id: buildId, kind: "plan", ordinal: 0, wave: 1, max_attempts: config.maxStepAttempts, input: {} as never });
  // Figures run beside the plan so module writers know which figures exist.
  input.sources.forEach((s, position) => {
    if (s.kind !== "pdf") return;
    steps.push({
      build_id: buildId,
      kind: "figures",
      ordinal: position,
      wave: 1,
      max_attempts: 1,
      input: { sourceId: byPosition.get(position) } as never,
    });
  });
  const { error: stepErr } = await admin.from("course_build_steps").insert(steps);
  if (stepErr) throw new Error(`create build steps: ${stepErr.message}`);

  return buildId;
}
