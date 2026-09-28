import { NextResponse } from "next/server";
import { checkCanBuild, sourcesForRetry, startCourseBuild } from "@/lib/course-build/start";
import { UUID_RE } from "@/lib/study-ingest/path";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Starts a fresh build from a failed or canceled build's sources. */
export async function POST(_request: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;
  if (!UUID_RE.test(buildId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: old } = await supabase
    .from("course_builds")
    .select("id, status, course_id, exam_group_id, output_language, study_goal")
    .eq("id", buildId)
    .maybeSingle();
  if (!old) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (old.status !== "failed" && old.status !== "canceled") {
    return NextResponse.json({ error: "Only a failed or canceled build can be retried." }, { status: 409 });
  }
  if (!old.exam_group_id) {
    return NextResponse.json({ error: "That section was deleted. Start a new build instead." }, { status: 409 });
  }

  const blocked = await checkCanBuild(user.id, user.email ?? null);
  if (blocked && !blocked.ok) {
    return NextResponse.json({ error: blocked.error, code: blocked.code }, { status: blocked.status });
  }
  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Try again in a moment." }, { status: 503 });
  const sources = await sourcesForRetry(admin, buildId);
  if (sources.length === 0) return NextResponse.json({ error: "Nothing to rebuild from." }, { status: 409 });

  const started = await startCourseBuild({
    userId: user.id,
    email: user.email ?? null,
    courseId: old.course_id,
    examGroupId: old.exam_group_id,
    sources,
    outputLanguage: old.output_language,
    studyGoal: old.study_goal,
  });
  if (!started.ok) return NextResponse.json({ error: started.error, code: started.code }, { status: started.status });
  return NextResponse.json({ buildId: started.buildId, courseId: old.course_id }, { status: 202 });
}
