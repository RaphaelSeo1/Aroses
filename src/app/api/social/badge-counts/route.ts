import { NextResponse } from "next/server";
import { fetchSocialBadgeCounts } from "@/lib/messaging/social-badge-counts";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Badge counts for Social: unread DMs + incoming friend requests. */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
