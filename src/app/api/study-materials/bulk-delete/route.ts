import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_IDS = 80;

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
  const rawIds = (body as { materialIds?: unknown }).materialIds;

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid courseId." }, { status: 400 });
  }
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    return NextResponse.json({ error: "materialIds must be a non-empty array." }, { status: 400 });
  }
  if (rawIds.length > MAX_IDS) {
    return NextResponse.json(
      { error: `At most ${MAX_IDS} materials per request.` },
      { status: 400 }
    );
  }

  const materialIds = rawIds.filter(
    (x): x is string => typeof x === "string" && UUID_RE.test(x)
  );
  if (materialIds.length !== rawIds.length) {
    return NextResponse.json({ error: "Invalid material id in list." }, { status: 400 });
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

  const { data: owned, error: selErr } = await supabase
    .from("study_materials")
    .select("id")
    .in("id", materialIds)
    .eq("course_id", courseId)
    .eq("user_id", user.id);

  if (selErr) {
    console.error(selErr);
    return NextResponse.json({ error: "Could not verify materials." }, { status: 500 });
  }

  if (!owned || owned.length !== materialIds.length) {
    return NextResponse.json(
      { error: "Some materials were not found in this course." },
      { status: 403 }
    );
  }

  const { error: delErr } = await supabase
    .from("study_materials")
    .delete()
    .in("id", materialIds)
    .eq("user_id", user.id)
    .eq("course_id", courseId);

  if (delErr) {
    console.error(delErr);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, deleted: materialIds.length });
}
