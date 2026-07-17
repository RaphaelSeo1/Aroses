import { NextResponse } from "next/server";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ noteId: string }> };

/**
 * POST /api/notes/[noteId]/record
 *
 * Open (or create) the live-notes surface for a standalone note. Reuses the
 * active session when present; otherwise reopens the latest session for this
 * note so the transcript is preserved across stop → record-again. Only creates
 * a new session when the note has never been recorded (counts against the
 * monthly lecture-recording cap).
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

  const { data: active } = await supabase
    .from("live_lecture_sessions")
    .select("id")
    .eq("user_note_id", noteId)
    .eq("user_id", user.id)
    .in("status", ["recording", "paused"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (active?.id) {
    return NextResponse.json({
      sessionId: active.id,
      redirect: `/notes/doc/${noteId}/record/${active.id}`,
    });
  }

  // Keep one continuous transcript per note: reopen the latest session
  // instead of starting a blank one after Stop.
  const { data: latest } = await supabase
    .from("live_lecture_sessions")
    .select("id, status")
    .eq("user_note_id", noteId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest?.id) {
    if (latest.status !== "recording" && latest.status !== "paused") {
      const { error: reopenErr } = await supabase
        .from("live_lecture_sessions")
        .update({
          status: "paused",
          updated_at: new Date().toISOString(),
        })
        .eq("id", latest.id)
        .eq("user_id", user.id);
      if (reopenErr) {
        console.error("[notes/record] reopen", reopenErr);
        return NextResponse.json(
          { error: "Could not reopen this note's recording session." },
          { status: 500 }
        );
      }
    }
    return NextResponse.json({
      sessionId: latest.id,
      redirect: `/notes/doc/${noteId}/record/${latest.id}`,
    });
  }

  const cap = await assertCanStartLectureRecording(user.id);
  if (!cap.ok) {
    return NextResponse.json(
      {
        error: cap.error,
        code: cap.code,
        used: cap.used,
        cap: cap.cap,
      },
      { status: cap.status }
    );
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
      status: "paused",
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
