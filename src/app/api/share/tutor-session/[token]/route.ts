import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/share/tutor-session/[token]
 *
 * Public, anonymous read of a shared tutor-session recap. NO AUTH.
 * The student opted into sharing by toggling the share switch on
 * the recap view — the resulting token is the bearer.
 *
 * Returns ONLY public-safe fields:
 *   - title, modeTag, durationSeconds, startedAt, endedAt
 *   - recapMarkdown
 *   - recapGeneratedAt
 *
 * NEVER returns: transcript, uploads, live notes, user_id, the
 * student's stored discussion summary, anything personal beyond
 * what's already inside the recap markdown they wrote.
 *
 * Implementation uses the admin client because the row's RLS only
 * lets the owner read. The check that a row exists is the token
 * itself — opaque, 24-char base64url, generated via crypto.randomBytes.
 */

type Params = { params: Promise<{ token: string }> };

const TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function GET(_req: Request, ctx: Params) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 });
  }
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 }
    );
  }
  const { data, error } = await admin
    .from("tutor_sessions")
    .select(
      "title, mode_tag, duration_seconds, started_at, ended_at, recap_markdown, recap_generated_at, recap_status, share_token"
    )
    .eq("share_token", token)
    .maybeSingle();
  if (error) {
    const missingCol =
      error.code === "42703" ||
      (error.message ?? "").includes("share_token");
    if (missingCol) {
      return NextResponse.json(
        {
          error:
            "Sharing is not enabled on this database yet. Apply migration 037_tutor_session_share.sql in Supabase.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (data.recap_status !== "ready" || !data.recap_markdown) {
    return NextResponse.json(
      { error: "Recap isn't ready yet" },
      { status: 404 }
    );
  }
  return NextResponse.json({
    title: data.title,
    modeTag: data.mode_tag,
    durationSeconds: data.duration_seconds,
    startedAt: data.started_at,
    endedAt: data.ended_at,
    recapMarkdown: data.recap_markdown,
    recapGeneratedAt: data.recap_generated_at,
  });
}
