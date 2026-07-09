import { NextResponse } from "next/server";
import {
  buildLiveNotesStudyContext,
  extractLiveNotesEmphasis,
} from "@/lib/live-notes/notes-emphasis";
import {
  createIngestJobFromText,
  ensureExamGroupForCourse,
} from "@/lib/notes/create-ingest-job-from-text";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/voice-tutor/uuid";

type Params = { params: Promise<{ noteId: string }> };

/**
 * POST /api/notes/[noteId]/to-course
 *
 * Converts a standalone note into a course build (review transcript first).
 * Idempotent when ingest_job_id is already set.
 *
 * Body: { courseTitle?: string, courseId?: string }
 */
export async function POST(request: Request, ctx: Params) {
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
    .select(
      "id, title, content_json, content_text, course_id, ingest_job_id"
    )
    .eq("id", noteId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (note.ingest_job_id && note.course_id) {
    return NextResponse.json({
      jobId: note.ingest_job_id,
      courseId: note.course_id,
      redirect: `/dashboard/courses/${note.course_id}/study/build?pdfJobs=${note.ingest_job_id}`,
    });
  }

  let body: { courseTitle?: unknown; courseId?: unknown };
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }

  let courseId =
    typeof body.courseId === "string" && isUuid(body.courseId)
      ? body.courseId
      : null;

  const courseTitle =
    typeof body.courseTitle === "string" && body.courseTitle.trim()
      ? body.courseTitle.trim().slice(0, 200)
      : (note.title as string)?.trim() || "Notes course";

  if (!courseId) {
    const { data: maxRow } = await supabase
      .from("courses")
      .select("sort_order")
      .eq("user_id", user.id)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder =
      typeof maxRow?.sort_order === "number" ? maxRow.sort_order + 1 : 0;

    const { data: courseRow, error: courseErr } = await supabase
      .from("courses")
      .insert({
        user_id: user.id,
        title: courseTitle,
        description: "",
        sort_order: nextOrder,
      })
      .select("id")
      .single();

    if (courseErr || !courseRow) {
      console.error("[notes/to-course] course insert", courseErr);
      return NextResponse.json(
        { error: "Could not create a course." },
        { status: 500 }
      );
    }
    courseId = courseRow.id as string;
  } else {
    const { data: owned } = await supabase
      .from("courses")
      .select("id")
      .eq("id", courseId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!owned) {
      return NextResponse.json({ error: "Course not found." }, { status: 404 });
    }
  }

  const examGroupId = await ensureExamGroupForCourse(
    supabase,
    user.id,
    courseId
  );
  if (!examGroupId) {
    return NextResponse.json(
      { error: "Could not find a section for this course." },
      { status: 500 }
    );
  }

  const emphasis = extractLiveNotesEmphasis(note.content_json);
  const studyContext = buildLiveNotesStudyContext({
    emphasis,
    lectureTitle: courseTitle,
  });

  const result = await createIngestJobFromText(supabase, {
    userId: user.id,
    courseId,
    examGroupId,
    title: courseTitle,
    body: (note.content_text as string) || "",
    studyContext: studyContext || undefined,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  await supabase
    .from("user_notes")
    .update({
      course_id: courseId,
      ingest_job_id: result.jobId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", noteId)
    .eq("user_id", user.id);

  return NextResponse.json({
    jobId: result.jobId,
    courseId,
    redirect: `/dashboard/courses/${courseId}/study/build?pdfJobs=${result.jobId}&section=${examGroupId}`,
  });
}
