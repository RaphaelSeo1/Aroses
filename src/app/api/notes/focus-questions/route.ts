import { NextResponse } from "next/server";
import {
  countPersonalQuizTypes,
  generatePersonalQuizFromNotes,
} from "@/lib/ai/personal-quiz-from-notes";
import {
  NOTES_FOCUS_BUCKET_ID,
  parseNotesFocusBucketNoteId,
} from "@/lib/notes/notes-focus-bucket";
import { softDeleteFocusQuestionsForNote } from "@/lib/notes/soft-delete-focus";
import { isUuid } from "@/lib/voice-tutor/uuid";
import { insertPersonalQuizItems } from "@/lib/notes/personal-quiz-insert";
import { resolveFocusDestination } from "@/lib/notes/resolve-focus-destination";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 180;

const MIN_CORPUS = 20;
const MAX_CORPUS = 8_000;

/**
 * POST /api/notes/focus-questions
 * Turn a notes selection / section into private focus cards (SRS).
 *
 * DELETE /api/notes/focus-questions
 * Soft-delete notes-focus cards for this user (appear under Deleted on Review).
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
        : typeof b.moduleId === "string" && Number.isFinite(Number(b.moduleId))
          ? Number(b.moduleId)
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

  const { data: existingRows, error: existingError } = await supabase
    .from("user_personal_quiz_items")
    .select("item")
    .eq("user_id", user.id);
  if (existingError) {
    console.error("[notes/focus-questions counts]", existingError);
  }

  let items;
  try {
    items = await generatePersonalQuizFromNotes(
      excerpt.slice(0, MAX_CORPUS),
      {
        existingCounts: countPersonalQuizTypes(existingRows ?? []),
      }
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
  const inserted = await insertPersonalQuizItems(
    supabase,
    items.map((item) => ({
      user_id: user.id,
      material_id: dest.materialId,
      module_id: dest.moduleId,
      item,
      source_note_id: dest.sourceNoteId,
      source_excerpt: preview,
      source_label: dest.sourceLabel.slice(0, 200),
    }))
  );

  if (!inserted.ok) {
    return NextResponse.json(
      { error: inserted.message },
      { status: inserted.needsMigration ? 503 : 500 }
    );
  }

  return NextResponse.json({
    count: inserted.rows.length,
    items: inserted.rows,
    materialId: dest.materialId,
    moduleId: dest.moduleId,
    sourceLabel: dest.sourceLabel,
    attachedToCourse: Boolean(dest.materialId),
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteIdParam = new URL(request.url).searchParams.get("noteId");
  const bucketParam = new URL(request.url).searchParams.get("bucket");
  const noteFromBucket = parseNotesFocusBucketNoteId(bucketParam);

  if (noteIdParam && isUuid(noteIdParam)) {
    const result = await softDeleteFocusQuestionsForNote(
      supabase,
      user.id,
      noteIdParam
    );
    if (result === "fail") {
      return NextResponse.json({ error: "Could not delete." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      bucket: `note:${noteIdParam.toLowerCase()}`,
      permanent: result === "hard",
    });
  }
  if (noteFromBucket) {
    const result = await softDeleteFocusQuestionsForNote(
      supabase,
      user.id,
      noteFromBucket
    );
    if (result === "fail") {
      return NextResponse.json({ error: "Could not delete." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      bucket: bucketParam,
      permanent: result === "hard",
    });
  }

  const result = await softDeleteFocusQuestionsForNote(
    supabase,
    user.id,
    null
  );
  if (result === "fail") {
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    bucket: NOTES_FOCUS_BUCKET_ID,
    permanent: result === "hard",
  });
}
