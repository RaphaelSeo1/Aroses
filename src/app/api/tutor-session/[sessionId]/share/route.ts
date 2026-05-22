import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tutor-session/[sessionId]/share
 *   Toggles a public share token for the recap.
 *
 *   Body: { enabled: boolean, rotate?: boolean }
 *     - enabled=true  → ensure a token exists; rotate=true forces
 *                       a brand-new token (invalidating any old link).
 *     - enabled=false → null the token out (link stops working).
 *
 *   Response: { shareToken: string | null, shareUrl: string | null }
 *
 * Only the recap is shared — the public viewer at
 * /share/session/[token] returns title + metadata + recap_markdown
 * only, never the transcript, uploads, or live notes.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

function generateToken(): string {
  // 18 random bytes → 24-ish chars base64url. Easy to type if needed
  // but long enough to be unguessable.
  return randomBytes(18)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function GET(_req: Request, ctx: Params) {
  // Returns the current share state without modifying it. Useful
  // for the recap view's "Share" toggle to read its initial state.
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data, error } = await supabase
    .from("tutor_sessions")
    .select("user_id, share_token")
    .eq("id", sessionId)
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
          shareToken: null,
          shareUrl: null,
        },
        { status: 200 }
      );
    }
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!data || data.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    shareToken: data.share_token,
    shareUrl: data.share_token ? `/share/session/${data.share_token}` : null,
  });
}

export async function POST(request: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
  }
  let body: { enabled?: unknown; rotate?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const enabled = body.enabled === true;
  const rotate = body.rotate === true;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const { data: row } = await supabase
    .from("tutor_sessions")
    .select("user_id, share_token")
    .eq("id", sessionId)
    .maybeSingle();
  if (!row || row.user_id !== user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let nextToken: string | null = row.share_token ?? null;
  if (!enabled) {
    nextToken = null;
  } else if (!nextToken || rotate) {
    // Generate + retry on (very unlikely) collision.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const candidate = generateToken();
      const { error } = await supabase
        .from("tutor_sessions")
        .update({
          share_token: candidate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionId)
        .eq("user_id", user.id);
      if (!error) {
        nextToken = candidate;
        break;
      }
      if (attempt === 3) {
        const missingCol =
          error.code === "42703" ||
          (error.message ?? "").includes("share_token");
        return NextResponse.json(
          {
            error: missingCol
              ? "Sharing is not enabled on this database yet. Apply migration 037_tutor_session_share.sql in Supabase."
              : "Couldn't generate share link",
          },
          { status: missingCol ? 503 : 500 }
        );
      }
    }
    return NextResponse.json({
      shareToken: nextToken,
      shareUrl: nextToken ? `/share/session/${nextToken}` : null,
    });
  } else {
    // Already enabled, not rotating — no-op.
    return NextResponse.json({
      shareToken: nextToken,
      shareUrl: nextToken ? `/share/session/${nextToken}` : null,
    });
  }

  // Disable path: clear the token.
  const { error } = await supabase
    .from("tutor_sessions")
    .update({
      share_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json({ error: "Disable failed" }, { status: 500 });
  }
  return NextResponse.json({ shareToken: null, shareUrl: null });
}
