import { NextResponse } from "next/server";
import { generatePersonalQuizFromNotes } from "@/lib/ai/personal-quiz-from-notes";
import { NOTES_FOCUS_BUCKET_ID } from "@/lib/notes/notes-focus-bucket";
import { resolveFocusDestination } from "@/lib/notes/resolve-focus-destination";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 180;

const MIN_CORPUS = 20;
const MAX_CORPUS = 8_000;

function countForCorpus(len: number): number {
  if (len < 120) return 3;
  if (len < 600) return 4;
  return 6;
}

/**
 * POST /api/notes/focus-questions
 * Turn a notes selection / section into private focus cards (SRS).
 *
 * DELETE /api/notes/focus-questions
 * Remove notes-only focus cards (no course material) for this user.
 */
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
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const b = body as {
    excerpt?: unknown;
    materialId?: unknown;
    moduleId?: unknown;
    noteId?: unknown;
    liveSessionId?: unknown;
    tutorSessionId?: unknown;
  };

  const excerpt = typeof b.excerpt === "string" ? b.excerpt.trim() : "";
  if (excerpt.length < MIN_CORPUS) {
    return NextResponse.json(
      { error: "Select a bit more of the note first." },
      { status: 400 }
    );
  }

  const dest = await resolveFocusDestination(supabase, user.id, {
    materialId: typeof b.materialId === "string" ? b.materialId : undefined,
    moduleId:
      typeof b.moduleId === "number" && Number.isFinite(b.moduleId)
        ? b.moduleId
        : undefined,
    noteId: typeof b.noteId === "string" ? b.noteId : undefined,
    liveSessionId:
      typeof b.liveSessionId === "string" ? b.liveSessionId : undefined,
    tutorSessionId:
      typeof b.tutorSessionId === "string" ? b.tutorSessionId : undefined,
  });
  if ("error" in dest) {
    return NextResponse.json({ error: dest.error }, { status: dest.status });
  }

  let items;
  try {
    items = await generatePersonalQuizFromNotes(
      excerpt.slice(0, MAX_CORPUS),
      countForCorpus(excerpt.length)
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Generation failed.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (items.length === 0) {
    return NextResponse.json(
      { error: "Could not build questions from that note." },
      { status: 400 }
    );
  }

  const preview = excerpt.replace(/\s+/g, " ").slice(0, 500);
  const rows = items.map((item) => ({
    user_id: user.id,
    material_id: dest.materialId,
    module_id: dest.moduleId,
    item,
    source_note_id: dest.sourceNoteId,
    source_excerpt: preview,
    source_label: dest.sourceLabel.slice(0, 200),
  }));

  const { data: inserted, error: insErr } = await supabase
    .from("user_personal_quiz_items")
    .insert(rows)
    .select("id, item, created_at");

  if (insErr) {
    console.error("[notes/focus-questions insert]", insErr);
    return NextResponse.json(
      { error: "Could not save questions." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    count: inserted?.length ?? items.length,
    items: inserted ?? [],
    materialId: dest.materialId,
    moduleId: dest.moduleId,
    sourceLabel: dest.sourceLabel,
    attachedToCourse: Boolean(dest.materialId),
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("user_personal_quiz_items")
    .delete()
    .eq("user_id", user.id)
    .is("material_id", null);

  if (error) {
    console.error("[notes/focus-questions delete]", error);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, bucket: NOTES_FOCUS_BUCKET_ID });
}
