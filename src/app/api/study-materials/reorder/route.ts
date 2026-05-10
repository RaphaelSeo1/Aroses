import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
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

  const courseId = (body as { courseId?: unknown }).courseId;
  const examGroupId = (body as { examGroupId?: unknown }).examGroupId;
  const materialIds = (body as { materialIds?: unknown }).materialIds;

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid courseId." }, { status: 400 });
  }
  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json({ error: "Invalid examGroupId." }, { status: 400 });
  }
  if (!Array.isArray(materialIds) || materialIds.length === 0) {
    return NextResponse.json(
      { error: "materialIds must be a non-empty array." },
      { status: 400 }
    );
  }

  const ids = materialIds.filter((id): id is string => typeof id === "string");
  if (ids.length !== materialIds.length || ids.some((id) => !UUID_RE.test(id))) {
    return NextResponse.json({ error: "Invalid material ids." }, { status: 400 });
  }

  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    return NextResponse.json({ error: "Duplicate material ids." }, { status: 400 });
  }

  const { data: courseOk } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!courseOk) {
    return NextResponse.json({ error: "Course not found." }, { status: 403 });
  }

  const { data: groupOk } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!groupOk) {
    return NextResponse.json({ error: "Exam group not found." }, { status: 403 });
  }

  const { data: rows, error: fetchErr } = await supabase
    .from("study_materials")
    .select("id")
    .eq("course_id", courseId)
    .eq("exam_group_id", examGroupId)
    .eq("user_id", user.id)
    .in("id", ids);

  if (fetchErr) {
    console.error(fetchErr);
    return NextResponse.json({ error: "Could not verify materials." }, { status: 500 });
  }

  if (!rows || rows.length !== ids.length) {
    return NextResponse.json(
      { error: "Some materials were not found or are not in this group." },
      { status: 403 }
    );
  }

  const { data: allInGroup, error: allErr } = await supabase
    .from("study_materials")
    .select("id")
    .eq("course_id", courseId)
    .eq("exam_group_id", examGroupId)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (allErr) {
    console.error(allErr);
    return NextResponse.json({ error: "Could not verify materials." }, { status: 500 });
  }

  const allIds = (allInGroup ?? []).map((r) => r.id);
  const submitted = new Set(ids);
  const missingFromClient = allIds.filter((id) => !submitted.has(id));
  const fullOrder = [...ids, ...missingFromClient];

  for (let i = 0; i < fullOrder.length; i++) {
    const { error } = await supabase
      .from("study_materials")
      .update({ sort_order: i })
      .eq("id", fullOrder[i])
      .eq("user_id", user.id)
      .eq("course_id", courseId)
      .eq("exam_group_id", examGroupId);
    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Could not save order." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
