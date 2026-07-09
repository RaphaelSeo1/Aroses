import { NextResponse } from "next/server";
import { syncLiveSessionToStandaloneNote } from "@/lib/live-notes/sync-standalone-note";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * POST /api/live-notes/[sessionId]/finish
 *
 * End a standalone-note capture: sync notes to user_notes, mark the session
 * completed (no course build). Course live lectures use .../complete instead.
 */
export async function POST(_request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!isUuid(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }

  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select("id, user_id, user_note_id, status")
    .eq("id", sessionId)
    .maybeSingle();

  if (!session || session.user_id !== user.id) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }
  if (!session.user_note_id) {
    return NextResponse.json(
      { error: "This session is not linked to a standalone note." },
      { status: 409 }
    );
  }

  const noteId = session.user_note_id as string;

  if (session.status === "completed") {
    return NextResponse.json({
      redirect: `/notes/doc/${noteId}`,
    });
  }

  const synced = await syncLiveSessionToStandaloneNote(
    supabase,
    sessionId,
    user.id
  );

  await supabase
    .from("live_lecture_sessions")
    .update({
      status: "completed",
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);

  return NextResponse.json({
    redirect: `/notes/doc/${synced?.noteId ?? noteId}`,
  });
}
