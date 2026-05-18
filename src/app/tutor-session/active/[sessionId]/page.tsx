import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { TutorSessionRunner } from "@/components/tutor-session/TutorSessionRunner";
import { createClient } from "@/lib/supabase/server";
import type {
  TutorSessionMessage,
  TutorSessionModeTag,
  TutorSessionRecord,
  TutorSessionUpload,
} from "@/types/tutor-session";

type Params = { params: Promise<{ sessionId: string }> };

export default async function TutorSessionActivePage({ params }: Params) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/tutor-session/active/${sessionId}`);
  }

  const { data: sessionRow } = await supabase
    .from("tutor_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessionRow || sessionRow.user_id !== user.id) {
    notFound();
  }

  // If the session has already been ended, redirect to its recap
  // page rather than re-opening the live runner. Reopening an ended
  // session is a follow-up feature.
  if (sessionRow.status === "ended") {
    redirect(`/tutor-session/recap/${sessionId}`);
  }

  const { data: uploadRows } = await supabase
    .from("tutor_session_uploads")
    .select("id, file_name, file_kind, mime_type, size_bytes, summary, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const uploads: TutorSessionUpload[] = (uploadRows ?? []).map((u) => ({
    id: u.id,
    fileName: u.file_name,
    fileKind: u.file_kind as "pdf" | "image" | "text",
    mimeType: u.mime_type,
    sizeBytes: u.size_bytes,
    summary: u.summary,
    createdAt: u.created_at,
  }));

  const initial: TutorSessionRecord = {
    id: sessionRow.id,
    title: sessionRow.title,
    topic: sessionRow.topic,
    modeTag: (sessionRow.mode_tag as TutorSessionModeTag) || null,
    status: sessionRow.status,
    startedAt: sessionRow.started_at,
    endedAt: sessionRow.ended_at,
    durationSeconds: sessionRow.duration_seconds,
    referenceSummary: sessionRow.reference_summary ?? "",
    discussionSummary: sessionRow.discussion_summary ?? "",
    liveNotesJson: sessionRow.live_notes_json,
    liveNotesText: sessionRow.live_notes_text ?? "",
    recapMarkdown: sessionRow.recap_markdown,
    recapGeneratedAt: sessionRow.recap_generated_at,
    recapStatus: sessionRow.recap_status,
    createdAt: sessionRow.created_at,
    updatedAt: sessionRow.updated_at,
    uploads,
    transcript: Array.isArray(sessionRow.conversation_transcript)
      ? (sessionRow.conversation_transcript as TutorSessionMessage[])
      : [],
  };

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <TutorSessionRunner initial={initial} />
    </>
  );
}
