import { NextResponse } from "next/server";
import { assertCanStartLectureRecording } from "@/lib/billing/lecture-recording-cap";
import { hasCourseEdit } from "@/lib/collaboration/api-guards";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import { isUuid } from "@/lib/voice-tutor/uuid";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/live-notes
 *   Start a live lecture capture session for a course.
 *   Body: { courseId, examGroupId?, title? } → { sessionId }
 *
 * GET /api/live-notes?courseId=...
 *   List this user's in-flight (recording/paused) sessions for a course so
 *   the course page can offer "Resume or finish" after a closed tab.
 */
export async function POST(request: Request) {
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
  const b = body as { courseId?: unknown; examGroupId?: unknown; title?: unknown };
  if (typeof b.courseId !== "string" || !isUuid(b.courseId)) {
    return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
  }
  const examGroupId =
    typeof b.examGroupId === "string" && isUuid(b.examGroupId)
      ? b.examGroupId
      : null;

  const canEdit = await hasCourseEdit(supabase, user.id, b.courseId);
  if (!canEdit) {
    return NextResponse.json({ error: "Course not found" }, { status: 403 });
  }

  if (examGroupId) {
    const { data: groupOwn } = await supabase
      .from("exam_groups")
      .select("id")
      .eq("id", examGroupId)
      .eq("course_id", b.courseId)
      .maybeSingle();
    if (!groupOwn) {
      return NextResponse.json(
        { error: "Invalid section for this course." },
        { status: 403 }
      );
    }
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
    typeof b.title === "string" && b.title.trim()
      ? b.title.trim().slice(0, 200)
      : `Live lecture — ${new Date().toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`;

  const { data: row, error } = await supabase
    .from("live_lecture_sessions")
    .insert({
      user_id: user.id,
      course_id: b.courseId,
      exam_group_id: examGroupId,
      title,
      status: "recording",
    })
    .select("id")
    .single();

  if (error || !row) {
    console.error("[live-notes] insert session", error);
    return NextResponse.json(
      {
        error:
          "Could not start the session. Apply migration 079_live_lecture_sessions.sql in Supabase, then try again.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ sessionId: row.id }, { status: 201 });
}

export async function GET(request: Request) {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!courseId || !isUuid(courseId)) {
    return NextResponse.json({ error: "Invalid courseId" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("live_lecture_sessions")
    .select("id, title, status, started_at, duration_seconds")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .in("status", ["recording", "paused"])
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    // Unmigrated database — treat as "no sessions" so the course page renders.
    return NextResponse.json({ sessions: [] });
  }

  return NextResponse.json({ sessions: data ?? [] });
}
