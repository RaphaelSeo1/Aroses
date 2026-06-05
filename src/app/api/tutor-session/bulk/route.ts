import { NextResponse } from "next/server";
import { generateCombinedSessionNotes } from "@/lib/ai/tutor-session";
import { createClient } from "@/lib/supabase/server";
import type { TutorSessionModeTag } from "@/types/tutor-session";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_BULK = 25;

type Body = {
  action?: unknown;
  sessionIds?: unknown;
};

async function deleteSessionWithUploads(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sessionId: string,
  userId: string
): Promise<boolean> {
  const { data: uploads } = await supabase
    .from("tutor_session_uploads")
    .select("storage_path")
    .eq("session_id", sessionId);
  if (uploads && uploads.length > 0) {
    const paths = uploads.map((u) => u.storage_path).filter(Boolean);
    if (paths.length > 0) {
      await supabase.storage.from("tutor-session-uploads").remove(paths);
    }
  }

  const { error } = await supabase
    .from("tutor_sessions")
    .delete()
    .eq("id", sessionId)
    .eq("user_id", userId);
  return !error;
}

/** POST — bulk delete or combine session notes. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action;
  if (action !== "delete" && action !== "combine") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  if (!Array.isArray(body.sessionIds) || body.sessionIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one session." },
      { status: 400 }
    );
  }

  const sessionIds = body.sessionIds
    .filter((id): id is string => typeof id === "string" && UUID_RE.test(id))
    .slice(0, MAX_BULK);

  if (sessionIds.length === 0) {
    return NextResponse.json({ error: "Invalid session ids" }, { status: 400 });
  }

  const { data: rows, error: fetchErr } = await supabase
    .from("tutor_sessions")
    .select(
      "id, title, mode_tag, started_at, duration_seconds, recap_markdown, live_notes_text, status"
    )
    .eq("user_id", user.id)
    .in("id", sessionIds);

  if (fetchErr) {
    console.error("[tutor-session bulk fetch]", fetchErr);
    return NextResponse.json({ error: "Could not load sessions" }, { status: 500 });
  }

  const owned = rows ?? [];
  if (owned.length === 0) {
    return NextResponse.json({ error: "No matching sessions" }, { status: 404 });
  }

  if (action === "delete") {
    let deleted = 0;
    for (const row of owned) {
      const ok = await deleteSessionWithUploads(supabase, row.id, user.id);
      if (ok) deleted += 1;
    }
    return NextResponse.json({ deleted, sessionIds: owned.map((r) => r.id) });
  }

  if (owned.length < 2) {
    return NextResponse.json(
      { error: "Select at least two sessions to combine notes." },
      { status: 400 }
    );
  }

  const withContent = owned.filter(
    (r) =>
      (typeof r.recap_markdown === "string" && r.recap_markdown.trim().length > 0) ||
      (typeof r.live_notes_text === "string" && r.live_notes_text.trim().length > 0)
  );

  if (withContent.length === 0) {
    return NextResponse.json(
      {
        error:
          "None of the selected sessions have recaps or notes to combine. End sessions first or pick ones with content.",
      },
      { status: 422 }
    );
  }

  const ordered = [...withContent].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at)
  );

  try {
    const markdown = await generateCombinedSessionNotes({
      sessions: ordered.map((r) => ({
        title: r.title,
        modeTag: (r.mode_tag as TutorSessionModeTag) || null,
        startedAt: r.started_at,
        durationSeconds: r.duration_seconds,
        recapMarkdown: r.recap_markdown,
        liveNotesText: r.live_notes_text,
      })),
    });
    return NextResponse.json({
      markdown,
      sessionCount: ordered.length,
      sessionTitles: ordered.map((r) => r.title),
    });
  } catch (e) {
    console.error("[tutor-session bulk combine]", e);
    return NextResponse.json(
      { error: "Could not combine notes. Try again." },
      { status: 502 }
    );
  }
}
