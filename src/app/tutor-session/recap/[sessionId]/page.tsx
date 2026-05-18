import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { TutorRecapView } from "@/components/tutor-session/TutorRecapView";
import { createClient } from "@/lib/supabase/server";
import type {
  TutorSessionModeTag,
  TutorSessionRecapStatus,
} from "@/types/tutor-session";

type Params = { params: Promise<{ sessionId: string }> };

export default async function TutorSessionRecapPage({ params }: Params) {
  const { sessionId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/tutor-session/recap/${sessionId}`);
  }
  const { data } = await supabase
    .from("tutor_sessions")
    .select(
      "id, user_id, title, mode_tag, duration_seconds, started_at, ended_at, recap_markdown, recap_status, recap_generated_at"
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (!data || data.user_id !== user.id) {
    notFound();
  }
  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <TutorRecapView
        sessionId={data.id}
        initial={{
          title: data.title,
          modeTag: (data.mode_tag as TutorSessionModeTag) || null,
          durationSeconds: data.duration_seconds,
          startedAt: data.started_at,
          endedAt: data.ended_at,
          recapMarkdown: data.recap_markdown,
          recapStatus: data.recap_status as TutorSessionRecapStatus,
          recapGeneratedAt: data.recap_generated_at,
        }}
      />
    </>
  );
}
