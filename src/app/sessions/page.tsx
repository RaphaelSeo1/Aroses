import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { createClient } from "@/lib/supabase/server";
import { SessionsList } from "@/components/tutor-session/SessionsList";
import type {
  TutorSessionModeTag,
  TutorSessionRecapStatus,
  TutorSessionSummary,
} from "@/types/tutor-session";

/**
 * Sessions library page — all past tutor sessions for the current
 * user, newest first. Click a card → opens its recap.
 *
 * Server-loads the first page so the list is rendered immediately.
 * Search/filter UI is intentionally deferred; the basic chrono list
 * is enough for the MVP.
 */
export default async function SessionsLibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/sessions");
  }

  // Omit full recap_markdown — loading 100 long markdown blobs was
  // slowing this page; previews load on the recap view instead.
  const { data } = await supabase
    .from("tutor_sessions")
    .select(
      "id, title, topic, mode_tag, status, started_at, ended_at, duration_seconds, recap_status"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const sessions: TutorSessionSummary[] = (data ?? []).map((r) => {
    const recapPreview: string | null =
      typeof r.topic === "string" && r.topic.trim().length > 0
        ? r.topic.trim().slice(0, 180)
        : null;
    return {
      id: r.id,
      title: r.title,
      topic: r.topic ?? "",
      modeTag: (r.mode_tag as TutorSessionModeTag) || null,
      status: r.status,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSeconds: r.duration_seconds,
      recapStatus: r.recap_status as TutorSessionRecapStatus,
      recapPreview,
    };
  });

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
                Tutor Sessions
              </p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">
                Your sessions
              </h1>
              <p className="mt-2 text-sm text-zinc-600">
                Everything you&apos;ve worked on with Rose. Click any session to
                open its recap.
              </p>
            </div>
            <Link
              href="/tutor-session"
              className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:from-violet-700 hover:to-fuchsia-700"
            >
              + New session
            </Link>
          </div>

          <div className="mt-8">
            <SessionsList sessions={sessions} />
          </div>
        </div>
      </main>
    </>
  );
}
