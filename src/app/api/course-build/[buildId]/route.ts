import { NextResponse } from "next/server";
import type { CourseModule } from "@/types/course";
import { buildStatusView, type StepView } from "@/lib/course-build/status-view";
import { UUID_RE } from "@/lib/study-ingest/path";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Build progress for the build screen. Read-only: it never claims or runs
 * work, so polling it can't start or duplicate AI calls.
 * `?have=1,2` skips finished modules the screen already has.
 */
export async function GET(request: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;
  if (!UUID_RE.test(buildId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: build } = await supabase
    .from("course_builds")
    .select(
      "id, status, course_id, exam_group_id, material_id, plan, source_pages, error_code, error_message, cancel_requested_at, first_module_at, completed_at, created_at"
    )
    .eq("id", buildId)
    .maybeSingle();
  if (!build) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const loadSteps = async () => {
    const withPreview = await supabase
      .from("course_build_steps")
      .select("kind, ordinal, status, attempts, run_after, rate_limited_count, last_error, preview")
      .eq("build_id", buildId);
    if (!withPreview.error) return withPreview;
    // Before migration 116 there is no live preview column.
    return supabase.from("course_build_steps").select("kind, ordinal, status, attempts, run_after").eq("build_id", buildId);
  };

  const [{ data: steps }, { data: figureSteps }, { data: sources }, material] = await Promise.all([
    loadSteps(),
    supabase
      .from("course_build_steps")
      .select("figures:output->figures")
      .eq("build_id", buildId)
      .eq("kind", "figures")
      .eq("status", "done"),
    supabase.from("course_build_sources").select("label, kind, page_count").eq("build_id", buildId).order("position"),
    build.material_id
      ? supabase.from("study_materials").select("id, file_name, course_payload").eq("id", build.material_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const have = new Set(
    (new URL(request.url).searchParams.get("have") ?? "")
      .split(",")
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0)
  );
  const payload = (material.data?.course_payload ?? null) as { title?: string; modules?: CourseModule[] } | null;

  return NextResponse.json(
    buildStatusView({
      build,
      steps: ((steps ?? []) as Array<Omit<StepView, "preview"> & { preview?: StepView["preview"] }>).map((s) => ({
        ...s,
        preview: s.preview ?? null,
      })),
      sources: sources ?? [],
      materialTitle: payload?.title ?? material.data?.file_name ?? null,
      modules: (payload?.modules ?? []).filter((m) => !have.has(m.id)),
      figuresFound: ((figureSteps ?? []) as Array<{ figures: unknown }>).reduce(
        (n, s) => n + (Array.isArray(s.figures) ? s.figures.length : 0),
        0
      ),
    }),
    { headers: { "Cache-Control": "no-store" } }
  );
}
