import { NextResponse } from "next/server";
import type { CoursePayload } from "@/types/course";
import {
  parseCoursePayload,
  renumberModules,
} from "@/lib/ai/course-payload";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = {
  params: Promise<{ materialId: string; moduleId: string }>;
};

export async function PATCH(request: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdParam } = await ctx.params;

  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const moduleId = Number(moduleIdParam);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
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

  const title =
    typeof (body as { title?: unknown }).title === "string"
      ? (body as { title: string }).title.trim()
      : "";
  if (title.length < 1 || title.length > 200) {
    return NextResponse.json(
      { error: "Title must be 1–200 characters." },
      { status: 400 }
    );
  }

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", materialId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let payload: CoursePayload;
  try {
    payload = parseCoursePayload(row.course_payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Stored course data is invalid." },
      { status: 500 }
    );
  }

  const mod = payload.modules.find((m) => m.id === moduleId);
  if (!mod) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  mod.title = title;

  const { error: saveErr } = await supabase
    .from("study_materials")
    .update({ course_payload: payload })
    .eq("id", materialId)
    .eq("user_id", user.id);

  if (saveErr) {
    console.error(saveErr);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdParam } = await ctx.params;

  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const moduleId = Number(moduleIdParam);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("id", materialId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let payload: CoursePayload;
  try {
    payload = parseCoursePayload(row.course_payload);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Stored course data is invalid." },
      { status: 500 }
    );
  }

  const filtered = payload.modules.filter((m) => m.id !== moduleId);
  if (filtered.length === payload.modules.length) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  if (filtered.length === 0) {
    return NextResponse.json(
      { error: "You must keep at least one module." },
      { status: 400 }
    );
  }

  payload.modules = renumberModules(filtered);

  const { error: saveErr } = await supabase
    .from("study_materials")
    .update({ course_payload: payload })
    .eq("id", materialId)
    .eq("user_id", user.id);

  if (saveErr) {
    console.error(saveErr);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  await supabase
    .from("module_completion")
    .delete()
    .eq("material_id", materialId)
    .eq("user_id", user.id);

  await supabase
    .from("question_attempts")
    .delete()
    .eq("material_id", materialId)
    .eq("user_id", user.id);

  return NextResponse.json({ ok: true });
}
