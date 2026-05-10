import { NextResponse } from "next/server";
import type { CoursePayload, KeyTerm } from "@/types/course";
import { parseCoursePayload } from "@/lib/ai/course-payload";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_CONTENT = 400_000;

function parseKeyTermsPatch(raw: unknown): KeyTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: KeyTerm[] = [];
  for (const x of raw) {
    if (
      x &&
      typeof x === "object" &&
      typeof (x as { term?: unknown }).term === "string" &&
      typeof (x as { definition?: unknown }).definition === "string"
    ) {
      const term = (x as { term: string }).term.trim();
      const definition = (x as { definition: string }).definition.trim();
      if (term.length > 0 && definition.length > 0) out.push({ term, definition });
    }
  }
  return out;
}

function parseExamplesPatch(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type Params = {
  params: Promise<{
    materialId: string;
    moduleId: string;
    lessonIndex: string;
  }>;
};

export async function PATCH(request: Request, ctx: Params) {
  const { materialId, moduleId: moduleIdParam, lessonIndex: lessonIndexParam } =
    await ctx.params;

  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const moduleId = Number(moduleIdParam);
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "Invalid module id." }, { status: 400 });
  }

  const lessonIndex = Number(lessonIndexParam);
  if (!Number.isInteger(lessonIndex) || lessonIndex < 0) {
    return NextResponse.json({ error: "Invalid lesson index." }, { status: 400 });
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

  const b = body as {
    content?: unknown;
    title?: unknown;
    key_terms?: unknown;
    examples?: unknown;
  };

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

  if (lessonIndex >= mod.lessons.length) {
    return NextResponse.json({ error: "Lesson not found." }, { status: 404 });
  }

  const lesson = mod.lessons[lessonIndex];
  let changed = false;

  if (typeof b.title === "string") {
    const t = b.title.trim();
    if (t.length < 1 || t.length > 400) {
      return NextResponse.json(
        { error: "Title must be 1–400 characters." },
        { status: 400 }
      );
    }
    lesson.title = t;
    changed = true;
  }

  if (typeof b.content === "string") {
    if (b.content.length > MAX_CONTENT) {
      return NextResponse.json(
        { error: `Content must be at most ${MAX_CONTENT} characters.` },
        { status: 400 }
      );
    }
    lesson.content = b.content;
    changed = true;
  }

  if (b.key_terms !== undefined) {
    lesson.key_terms = parseKeyTermsPatch(b.key_terms);
    changed = true;
  }

  if (b.examples !== undefined) {
    lesson.examples = parseExamplesPatch(b.examples);
    changed = true;
  }

  if (!changed) {
    return NextResponse.json(
      { error: "Nothing to update. Send title, content, key_terms, and/or examples." },
      { status: 400 }
    );
  }

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
