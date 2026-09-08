import { NextResponse } from "next/server";
import { fetchSocialBadgeCounts } from "@/lib/messaging/social-badge-counts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Badge counts for Social: unread DMs + incoming friend requests. */
export async function GET() {
  const supabase = await createClient({ timeoutMs: 5_000 });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) {
    console.error("[social/badge-counts] auth unavailable:", authError.message);
    return NextResponse.json(
      { error: "Authentication service temporarily unavailable." },
      { status: 503, headers: { "Retry-After": "5" } }
    );
  }
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const counts = await fetchSocialBadgeCounts(supabase, user.id);
    return NextResponse.json(counts);
  } catch (err) {
    console.error("[social/badge-counts]", err);
    return NextResponse.json(
      { unreadMessages: 0, pendingFriendRequests: 0, total: 0 },
      { status: 200 }
    );
  }
}
