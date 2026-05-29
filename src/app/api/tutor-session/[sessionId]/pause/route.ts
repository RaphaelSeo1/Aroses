import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/tutor-session/[sessionId]/pause
 * Marks an active session as paused (inactivity timeout).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ sessionId: string }> };

export async function POST(_req: Request, ctx: Params) {
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
    .update({
      status: "paused",
      updated_at: new Date().toISOString(),
    })
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .in("status", ["active", "paused"])
    .select("id, status")
    .maybeSingle();

  if (error) {
    console.error("[tutor-session pause]", error);
    return NextResponse.json({ error: "Pause failed" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or already ended" }, { status: 404 });
  }

  console.log("[tutor-inactivity] session paused", { sessionId });

  return NextResponse.json({ ok: true, status: data.status });
}
