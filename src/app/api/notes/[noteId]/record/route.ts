import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ noteId: string }> };

/**
 * POST /api/notes/[noteId]/record
 *
 * Start live audio capture for a standalone note — same Deepgram +
 * AI note flow as course live lectures, stored on a live_lecture_sessions
 * row linked via user_note_id.
 */
export async function POST(_request: Request, ctx: Params) {
  const { noteId } = await ctx.params;
  if (!isUuid(noteId)) {
    return NextResponse.json({ error: "Invalid note id" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: note } = await supabase
    .from("user_notes")
    .select("id, title, content_json, content_text")
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("live_lecture_sessions")
    .select("id")
    .eq("user_note_id", noteId)
    .eq("user_id", user.id)
    .in("status", ["recording", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return NextResponse.json({
      sessionId: existing.id,
      redirect: `/notes/doc/${noteId}/record/${existing.id}`,
    });
  }

  const title =
    typeof note.title === "string" && note.title.trim()
      ? note.title.trim().slice(0, 200)
      : "Untitled note";

  const { data: row, error } = await supabase
    .from("live_lecture_sessions")
    .insert({
      user_id: user.id,
      user_note_id: noteId,
      course_id: null,
      title,
      status: "recording",
      notes_json: note.content_json,
      notes_text:
        typeof note.content_text === "string" ? note.content_text : "",
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[notes/record]", error);
    return NextResponse.json(
      {
        error:
          "Could not start recording. Apply migration 081_user_notes_live_capture.sql in Supabase, then try again.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      sessionId: row.id,
      redirect: `/notes/doc/${noteId}/record/${row.id}`,
    },
    { status: 201 }
  );
}
