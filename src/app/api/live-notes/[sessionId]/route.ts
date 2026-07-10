import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = { params: Promise<{ sessionId: string }> };

/**
 * GET /api/live-notes/[sessionId]
 *   Session state for surface hydration (status, title, rolling summary,
 *   duration, linked ingest job).
 *
 * PATCH /api/live-notes/[sessionId]
 *   Update mutable session fields while recording.
 *   Body: { status?: "recording" | "paused", title?, durationSeconds? }
 *   Completion goes through POST .../complete, never here.
 *
 * DELETE /api/live-notes/[sessionId]
 *   Remove the session and transcript segments (any status).
 */
export async function GET(_request: Request, ctx: Params) {
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
    .select(
      "id, course_id, exam_group_id, title, status, started_at, ended_at, rolling_summary, duration_seconds, ingest_job_id"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: lastSegment } = await supabase
    .from("live_lecture_segments")
    .select("seq, at_ms")
    .eq("session_id", sessionId)
    .order("seq", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    session: {
      id: session.id,
      courseId: session.course_id,
      examGroupId: session.exam_group_id,
      title: session.title,
      status: session.status,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      rollingSummary: session.rolling_summary ?? "",
      durationSeconds: session.duration_seconds ?? 0,
      ingestJobId: session.ingest_job_id,
      lastSegmentSeq: lastSegment?.seq ?? -1,
      lastSegmentAtMs: lastSegment?.at_ms ?? 0,
    },
  });
}

export async function PATCH(request: Request, ctx: Params) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as {
    status?: unknown;
    title?: unknown;
    durationSeconds?: unknown;
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (b.status === "recording" || b.status === "paused") {
    patch.status = b.status;
  } else if (b.status !== undefined) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (typeof b.title === "string" && b.title.trim()) {
    patch.title = b.title.trim().slice(0, 200);
  }
  if (
    typeof b.durationSeconds === "number" &&
    Number.isFinite(b.durationSeconds) &&
    b.durationSeconds >= 0
  ) {
    patch.duration_seconds = Math.min(
      24 * 60 * 60,
      Math.round(b.durationSeconds)
    );
  }

  // Title-only renames are allowed on any non-deleted session (including
  // completed). Status / duration changes stay limited to live sessions.
  const titleOnly =
    typeof patch.title === "string" &&
    b.status === undefined &&
    b.durationSeconds === undefined;

  let query = supabase
    .from("live_lecture_sessions")
    .update(patch)
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (!titleOnly) {
    // Ended sessions are immutable for status / duration through this route.
    query = query.in("status", ["recording", "paused"]);
  }

  const { data, error } = await query
    .select("id, status, user_note_id, title")
    .maybeSingle();

  if (error) {
    console.error("[live-notes] patch session", error);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: "Session not found or already ended." },
      { status: 404 }
    );
  }

  // Keep the linked standalone note title in sync when the lecture is renamed.
  if (
    typeof patch.title === "string" &&
    typeof data.user_note_id === "string" &&
    data.user_note_id
  ) {
    await supabase
      .from("user_notes")
      .update({
        title: patch.title,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.user_note_id)
      .eq("user_id", user.id);
  }

  return NextResponse.json({ ok: true, status: data.status, title: data.title });
}

/**
 * DELETE /api/live-notes/[sessionId]
 *   Remove a live lecture session and its transcript segments (cascade).
 *   Allowed in any status — including active recording/paused sessions.
 */
export async function DELETE(_request: Request, ctx: Params) {
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

  const { error } = await supabase
    .from("live_lecture_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[live-notes] delete session", error);
    return NextResponse.json({ error: "Could not delete session." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
