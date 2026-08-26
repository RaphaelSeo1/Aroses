import { notFound, redirect } from "next/navigation";
import {
  LiveNotesSurface,
  type LiveNotesInitialSession,
} from "@/components/live-notes/LiveNotesSurface";
import { loadNoteInstruction } from "@/lib/load-note-instruction";
import { loadSessionDeckMeta } from "@/lib/live-notes/slide-pages";
import { fetchCourseForDashboard } from "@/lib/supabase/fetch-course-dashboard";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string; sessionId: string }>;
};

export default async function LiveNotesSessionPage({ params }: Props) {
  const { courseId, sessionId } = await params;
  if (!UUID_RE.test(courseId) || !UUID_RE.test(sessionId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/dashboard/courses/${courseId}/live-notes/${sessionId}`)}`
    );
  }

  // RLS scopes the row to its owner.
  const { data: session } = await supabase
    .from("live_lecture_sessions")
    .select(
      "id, course_id, title, status, duration_seconds, ingest_job_id"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.course_id !== courseId) notFound();

  const course = await fetchCourseForDashboard(supabase, courseId, user.id);
  if (!course) notFound();

  const { data: segments } = await supabase
    .from("live_lecture_segments")
    .select("seq, text, at_ms")
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .limit(5_000);

  const initialSegments = (segments ?? []).map((s) => ({
    seq: s.seq as number,
    text: s.text as string,
    atMs: (s.at_ms as number) ?? 0,
  }));

  const initialSession: LiveNotesInitialSession = {
    id: session.id,
    courseId,
    title:
      typeof session.title === "string" && session.title.trim()
        ? session.title.trim()
        : "Live lecture",
    status: session.status as LiveNotesInitialSession["status"],
    durationSeconds:
      typeof session.duration_seconds === "number"
        ? session.duration_seconds
        : 0,
    ingestJobId:
      typeof session.ingest_job_id === "string" ? session.ingest_job_id : null,
    lastSegmentSeq:
      initialSegments.length > 0
        ? initialSegments[initialSegments.length - 1].seq
        : -1,
    // Separate graceful read: a missing column (pre-migration) resolves to "".
    noteInstruction: await loadNoteInstruction(
      supabase,
      "live_lecture_sessions",
      { id: sessionId, user_id: user.id }
    ),
    ...(await loadSessionDeckMeta(supabase, sessionId).then((m) => ({
      slidesFileName: m.fileName,
      slidesPageCount: m.pageCount,
    }))),
  };

  return (
    <LiveNotesSurface
      session={initialSession}
      courseTitle={course.title?.trim() || "Course"}
      initialSegments={initialSegments}
    />
  );
}
