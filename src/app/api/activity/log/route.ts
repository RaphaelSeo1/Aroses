import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  CLIENT_LOGGABLE_EVENTS,
  logActivity,
  type ActivityEventType,
} from "@/lib/activity-log";

export const runtime = "nodejs";

/**
 * POST /api/activity/log
 *
 * Lets the signed-in browser report client-only audit events (e.g. logging
 * out, which has no server round-trip otherwise). Only an allowlisted set of
 * event types is accepted, and the actor is always taken from the verified
 * session — never from the request body — so this can't be used to forge
 * activity for other users.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as { type?: unknown };
  if (typeof b.type !== "string" || !CLIENT_LOGGABLE_EVENTS.has(b.type)) {
    return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
  }

  await logActivity({
    userId: user.id,
    type: b.type as ActivityEventType,
  });

  return NextResponse.json({ ok: true });
}
