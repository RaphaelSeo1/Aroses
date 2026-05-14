import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ jobId: string }> };

/** Delete a failed ingest job row so it never shows in the warning banner again. */
export async function DELETE(_req: Request, { params }: Params) {
  const { jobId } = await params;
  if (!UUID_RE.test(jobId)) {
    return NextResponse.json({ error: "Invalid job id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  // Verify the job belongs to the requesting user and is failed before deleting.
  const { data: job } = await admin
    .from("pdf_ingest_jobs")
    .select("id, user_id, status")
    .eq("id", jobId)
    .maybeSingle();

  if (!job) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (job.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (job.status !== "failed") {
    return NextResponse.json(
      { error: "Only failed jobs can be dismissed." },
      { status: 400 }
    );
  }

  await admin.from("pdf_ingest_jobs").delete().eq("id", jobId);

  return NextResponse.json({ ok: true });
}
