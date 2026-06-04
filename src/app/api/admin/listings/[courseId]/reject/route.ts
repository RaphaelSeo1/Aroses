import { NextResponse } from "next/server";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { logActivity } from "@/lib/activity-log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAppAdminEnvUser(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const reason =
    typeof (body as { reason?: unknown }).reason === "string"
      ? (body as { reason: string }).reason.trim()
      : "";
  if (reason.length < 8) {
    return NextResponse.json(
      { error: "Provide a rejection reason (at least 8 characters)." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Server misconfigured." }, { status: 503 });
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("course_listings")
    .update({
      status: "rejected",
      reviewed_by: user.id,
      reviewed_at: now,
      rejection_reason: reason,
      approved_at: null,
      updated_at: now,
    })
    .eq("course_id", courseId)
    .eq("status", "pending_review")
    .select("course_id")
    .maybeSingle();

  if (error) {
    console.error("[admin listing reject]", error);
    return NextResponse.json({ error: "Could not reject." }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Listing not pending review." }, { status: 404 });
  }

  await logActivity({
    userId: user.id,
    type: "listing_rejected",
    summary: `Rejected marketplace listing`,
    metadata: { courseId, reason },
  });

  return NextResponse.json({ ok: true });
}
