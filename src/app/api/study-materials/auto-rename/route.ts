import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  dedupeSectionLabels,
  deriveFileStemFromPayload,
  finalizeMaterialSectionLabel,
} from "@/lib/study-material-display-name";

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

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid courseId." }, { status: 400 });
  }
  if (typeof examGroupId !== "string" || !UUID_RE.test(examGroupId)) {
    return NextResponse.json({ error: "Invalid examGroupId." }, { status: 400 });
  }

  const { data: courseOk } = await supabase
    .from("courses")
    .select("id")
    .eq("id", courseId)
    .maybeSingle();

  if (!courseOk) {
    return NextResponse.json({ error: "Course not found." }, { status: 403 });
  }

  const { data: groupOk } = await supabase
    .from("exam_groups")
    .select("id")
    .eq("id", examGroupId)
    .eq("course_id", courseId)
    .maybeSingle();

  if (!groupOk) {
    return NextResponse.json({ error: "Section not found." }, { status: 403 });
  }

  const { data: rows, error: listErr } = await supabase
    .from("study_materials")
    .select("id, file_name, course_payload")
    .eq("course_id", courseId)
    .eq("exam_group_id", examGroupId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  if (listErr) {
    console.error(listErr);
    return NextResponse.json({ error: "Could not load builds." }, { status: 500 });
  }

  if (!rows?.length) {
    return NextResponse.json({ error: "No builds in this group." }, { status: 400 });
  }

  const stems: string[] = [];
  let fromPayload = 0;

  for (const row of rows) {
    const fromContent = deriveFileStemFromPayload(row.course_payload);
    if (fromContent) {
      stems.push(fromContent);
      fromPayload++;
      continue;
    }

    const fallback = finalizeMaterialSectionLabel(row.file_name, 180);
    stems.push(fallback.length > 0 ? fallback : "Lecture");
  }

  const fileNames = dedupeSectionLabels(stems);

  for (let i = 0; i < rows.length; i++) {
    const { error } = await supabase
      .from("study_materials")
      .update({ file_name: fileNames[i] })
      .eq("id", rows[i].id);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Could not rename builds." }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    renamed: rows.length,
    namedFromCourseContent: fromPayload,
  });
}
