import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ groupId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { groupId } = await params;
  if (!UUID_RE.test(groupId)) {
    return NextResponse.json({ error: "Invalid groupId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name =
    typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name.trim()
      : "";

  if (name.length < 1 || name.length > 120) {
    return NextResponse.json(
      { error: "Section name must be 1–120 characters." },
      { status: 400 }
    );
  }

  // Verify the requesting user owns the course that owns this group.
  const admin = createAdminClient();
  const reader = admin ?? supabase;

  const { data: group } = await reader
    .from("exam_groups")
    .select("id, course_id")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const { data: course } = await reader
    .from("courses")
    .select("user_id")
    .eq("id", group.course_id)
    .maybeSingle();

  if (!course || course.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const writer = admin ?? supabase;
  const { error } = await writer
    .from("exam_groups")
    .update({ name })
    .eq("id", groupId);

  if (error) {
    console.error("[exam-groups PATCH]", error);
    return NextResponse.json({ error: "Could not rename section." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { groupId } = await params;
  if (!UUID_RE.test(groupId)) {
    return NextResponse.json({ error: "Invalid groupId" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const reader = admin ?? supabase;

  // Load the section + verify ownership via the parent course.
  const { data: group } = await reader
    .from("exam_groups")
    .select("id, course_id")
    .eq("id", groupId)
    .maybeSingle();

  if (!group) {
    return NextResponse.json({ error: "Section not found" }, { status: 404 });
  }

  const { data: course } = await reader
    .from("courses")
    .select("user_id")
    .eq("id", group.course_id)
    .maybeSingle();

  if (!course || course.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Refuse to delete the last remaining section — a course must always have
  // at least one section as the home for new uploads.
  const { count: siblingCount } = await reader
    .from("exam_groups")
    .select("id", { count: "exact", head: true })
    .eq("course_id", group.course_id);

  if ((siblingCount ?? 0) <= 1) {
    return NextResponse.json(
      {
        error:
          "You can't delete the only section. Add another section first, then delete this one.",
      },
      { status: 400 }
    );
  }

  // FK relationships in migrations 004 + 020 are ON DELETE CASCADE, so
  // study_materials, pdf_ingest_jobs, and their dependents go with the
  // section automatically. We don't need to clean them up by hand.
  const writer = admin ?? supabase;
  const { error } = await writer
    .from("exam_groups")
    .delete()
    .eq("id", groupId);

  if (error) {
    console.error("[exam-groups DELETE]", error);
    return NextResponse.json(
      { error: "Could not delete section." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
