import { NextResponse } from "next/server";
import { parseCoursePayload } from "@/lib/ai/course-payload";
import { generateAdditionalModuleQuizItems } from "@/lib/ai/expand-module-quiz";
import { createClient } from "@/lib/supabase/server";
import type { CoursePayload } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = {
  params: Promise<{ materialId: string; moduleId: string }>;
};

export async function POST(request: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdParam } = await ctx.params;

  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const moduleId = Number(moduleIdParam);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }

  let body: { count?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body ok */
  }

  const countRaw = body.count;
  const count =
    typeof countRaw === "number" && Number.isFinite(countRaw)
      ? Math.floor(countRaw)
      : 8;

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

  const mod = payload.modules.find((m) => m.id === moduleId);
  if (!mod) {
    return NextResponse.json({ error: "Module not found." }, { status: 404 });
  }

  let newItems;
  try {
    newItems = await generateAdditionalModuleQuizItems(mod, count);
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Could not generate quiz questions. Try again.",
      },
      { status: 502 }
    );
  }

  mod.quiz = [...mod.quiz, ...newItems];

  const { error: saveErr } = await supabase
    .from("study_materials")
    .update({ course_payload: payload })
    .eq("id", materialId)
    .eq("user_id", user.id);

  if (saveErr) {
    console.error(saveErr);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    added: newItems.length,
    totalQuizItems: mod.quiz.length,
  });
}
