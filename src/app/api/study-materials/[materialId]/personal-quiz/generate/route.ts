import { NextResponse } from "next/server";
import { generatePersonalQuizFromNotes } from "@/lib/ai/personal-quiz-from-notes";
import { createClient } from "@/lib/supabase/server";
import { canAccessStudyMaterial } from "@/lib/supabase/study-material-access";
import type { CourseQuizItem } from "@/types/course";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ materialId: string }> };

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
    noteIds?: unknown;
    extraContext?: unknown;
    count?: unknown;
  };

  const moduleId = typeof b.moduleId === "number" ? b.moduleId : Number.NaN;
  if (!Number.isFinite(moduleId)) {
    return NextResponse.json({ error: "moduleId required." }, { status: 400 });
  }

  const count =
    typeof b.count === "number" && Number.isFinite(b.count)
      ? Math.floor(b.count)
      : 6;

  let corpus = "";
  if (Array.isArray(b.noteIds) && b.noteIds.length > 0) {
    const ids = b.noteIds.filter((x): x is string => typeof x === "string");
    if (ids.length === 0) {
      return NextResponse.json({ error: "Invalid note ids." }, { status: 400 });
    }
    const { data: notes, error } = await supabase
      .from("user_lesson_notes")
      .select("highlight_excerpt, note_body")
      .eq("material_id", materialId)
      .eq("module_id", moduleId)
      .eq("user_id", user.id)
      .in("id", ids);

    if (error) {
      console.error(error);
      return NextResponse.json({ error: "Could not load notes." }, { status: 500 });
    }

    corpus = (notes ?? [])
      .map((n) => {
        const parts = [n.highlight_excerpt?.trim(), n.note_body?.trim()].filter(
          Boolean
        );
        return parts.join("\n\n");
      })
      .filter(Boolean)
      .join("\n\n---\n\n");
  }

  const extra =
    typeof b.extraContext === "string" ? b.extraContext.trim() : "";
  if (extra.length > 0) {
    corpus = corpus ? `${corpus}\n\n---\n\n${extra}` : extra;
  }

  let items: CourseQuizItem[];
  try {
    items = await generatePersonalQuizFromNotes(corpus, count);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generation failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const rows = items.map((item) => ({
    user_id: user.id,
    material_id: materialId,
    module_id: moduleId,
    item,
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("user_personal_quiz_items")
    .insert(rows)
    .select("id, item, created_at");

  if (insErr) {
    console.error(insErr);
    return NextResponse.json({ error: "Could not save questions." }, { status: 500 });
  }

  return NextResponse.json({ items: inserted ?? [] });
}
