import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  TutorSessionModeTag,
  TutorSessionRecapStatus,
  TutorSessionStatus,
  TutorSessionSummary,
} from "@/types/tutor-session";

/**
 * GET /api/tutor-sessions
 *
 * Returns the current user's past tutor sessions, newest first.
 * Lightweight — no transcripts or notes, just summary fields + a
 * short recap preview for the card.
 *
 * Query params:
 *   - limit? (default 50, max 100)
 *
 * Search / filter is deferred to a follow-up; the basic chrono list
 * is enough for the MVP library page.
 */

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 50));

  const { data, error } = await supabase
    .from("tutor_sessions")
    .select(
      "id, title, topic, mode_tag, status, started_at, ended_at, duration_seconds, recap_status, recap_markdown"
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[tutor-sessions list]", error);
    return NextResponse.json({ error: "List failed" }, { status: 500 });
  }

  const sessions: TutorSessionSummary[] = (data ?? []).map((r) => {
    // Pull the first ~140 chars of body text from the recap (skipping
    // the H1 + metadata block) for the card preview.
    let recapPreview: string | null = null;
    if (typeof r.recap_markdown === "string" && r.recap_markdown.length > 0) {
      // Skip H1 line and any leading blockquote/metadata.
      const lines = r.recap_markdown.split(/\r?\n/);
      const startIdx = lines.findIndex(
        (l, i) => i > 0 && l.trim() && !l.startsWith("#") && !l.startsWith(">")
      );
      const body = startIdx >= 0 ? lines.slice(startIdx).join(" ") : r.recap_markdown;
      recapPreview = body
        .replace(/[#*`>_\-]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
    }
    return {
      id: r.id,
      title: r.title,
      topic: r.topic ?? "",
      modeTag: (r.mode_tag as TutorSessionModeTag) || null,
      status: r.status as TutorSessionStatus,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      durationSeconds: r.duration_seconds,
      recapStatus: r.recap_status as TutorSessionRecapStatus,
      recapPreview,
    };
  });

  return NextResponse.json({ sessions });
}
