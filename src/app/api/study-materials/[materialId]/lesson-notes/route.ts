import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readFiniteInt(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return Number.NaN;
}

type Params = { params: Promise<{ materialId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const moduleId = Number(searchParams.get("moduleId"));
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "moduleId required." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ notes: [] });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const lessonIndexRaw = searchParams.get("lessonIndex");
  const lessonFilter =
    lessonIndexRaw != null ? Number(lessonIndexRaw) : Number.NaN;

  let q = supabase
    .from("user_lesson_notes")
    .select("id, lesson_index, highlight_excerpt, note_body, updated_at")
    .eq("material_id", materialId)
    .eq("module_id", moduleId);

  if (Number.isFinite(lessonFilter)) {
    q = q.eq("lesson_index", lessonFilter);
  }

  const { data, error } = await q.order("lesson_index", { ascending: true });

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not load notes." }, { status: 500 });
  }

  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ok = await canAccessStudyMaterial(supabase, user.id, materialId);
  if (!ok) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const b = body as {
    moduleId?: unknown;
    lessonIndex?: unknown;
    highlightExcerpt?: unknown;
    noteBody?: unknown;
  };

  const moduleId = readFiniteInt(b.moduleId);
  const lessonIndex = readFiniteInt(b.lessonIndex);
  if (!Number.isFinite(moduleId) || !Number.isFinite(lessonIndex)) {
    return NextResponse.json({ error: "Invalid module or lesson." }, { status: 400 });
  }

  const highlightExcerpt =
    typeof b.highlightExcerpt === "string" ? b.highlightExcerpt.trim() : "";
  const noteBody = typeof b.noteBody === "string" ? b.noteBody.trim() : "";

  if (highlightExcerpt.length === 0 && noteBody.length === 0) {
    return NextResponse.json(
      { error: "Add a highlight or note." },
      { status: 400 }
    );
  }

  const { data: row, error } = await supabase
    .from("user_lesson_notes")
    .upsert(
      {
        user_id: user.id,
        material_id: materialId,
        module_id: moduleId,
        lesson_index: lessonIndex,
        highlight_excerpt: highlightExcerpt,
        note_body: noteBody,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,material_id,module_id,lesson_index" }
    )
    .select("id, lesson_index, highlight_excerpt, note_body, updated_at")
    .single();

  if (error) {
    console.error("[lesson-notes POST]", error.code, error.message, error.details);
    const hint =
      error.code === "42501" || error.code === "42P01"
        ? "Confirm Supabase migrations 016 and 017 are applied."
        : undefined;
    return NextResponse.json(
      { error: "Could not save note.", hint },
      { status: 500 }
    );
  }

  return NextResponse.json({ note: row });
}

export async function PATCH(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
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
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const b = body as {
    id?: unknown;
    highlightExcerpt?: unknown;
    noteBody?: unknown;
  };
  const id = typeof b.id === "string" ? b.id : "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const patch: Record<string, string> = {};
  if (typeof b.highlightExcerpt === "string") {
    patch.highlight_excerpt = b.highlightExcerpt.trim();
  }
  if (typeof b.noteBody === "string") {
    patch.note_body = b.noteBody.trim();
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  const { data: row, error } = await supabase
    .from("user_lesson_notes")
    .update(patch)
    .eq("id", id)
    .eq("material_id", materialId)
    .select("id, lesson_index, highlight_excerpt, note_body, updated_at")
    .maybeSingle();

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not update." }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  return NextResponse.json({ note: row });
}

export async function DELETE(request: Request, ctx: Params) {
  const { materialId } = await ctx.params;
  if (!UUID_RE.test(materialId)) {
    return NextResponse.json({ error: "Invalid material id." }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id") ?? "";
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_lesson_notes")
    .delete()
    .eq("id", id)
    .eq("material_id", materialId);

  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
