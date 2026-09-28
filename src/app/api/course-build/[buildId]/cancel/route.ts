import { NextResponse } from "next/server";
import { kickCourseBuild } from "@/lib/course-build/start";
import { UUID_RE } from "@/lib/study-ingest/path";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Asks the worker to stop. It aborts in-flight AI calls, releases billing and removes the partial material. */
export async function POST(_request: Request, ctx: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await ctx.params;
  if (!UUID_RE.test(buildId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: build } = await supabase.from("course_builds").select("id, status").eq("id", buildId).maybeSingle();
  if (!build) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (build.status !== "queued" && build.status !== "running") {
    return NextResponse.json({ status: build.status });
  }

  const admin = createAdminClient();
  if (!admin) return NextResponse.json({ error: "Try again in a moment." }, { status: 503 });
  const { error } = await admin
    .from("course_builds")
    .update({ cancel_requested_at: new Date().toISOString() })
    .eq("id", buildId)
    .in("status", ["queued", "running"]);
  if (error) return NextResponse.json({ error: "Couldn't cancel. Try again." }, { status: 500 });

  // If no worker holds the build right now, this run finishes the cancel; otherwise it backs off.
  kickCourseBuild(buildId);
  return NextResponse.json({ status: "canceling" });
}
