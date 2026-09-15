import { NextResponse } from "next/server";
import { isMissingAuthSessionError } from "@/lib/auth/public-routes";
import { fetchSocialBadgeCounts } from "@/lib/messaging/social-badge-counts";
import { WIDGET_SUPABASE_TIMEOUT_MS } from "@/lib/supabase/bounded-fetch";
import { createClient } from "@/lib/supabase/server";
import { decideWidgetAuth } from "@/lib/supabase/widget-auth";

export const runtime = "nodejs";

const EMPTY_COUNTS = {
  unreadMessages: 0,
  pendingFriendRequests: 0,
  total: 0,
};

/** Badge counts for Social: unread DMs + incoming friend requests. */
export async function GET() {
  const supabase = await createClient({ timeoutMs: WIDGET_SUPABASE_TIMEOUT_MS });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  const auth = decideWidgetAuth(user, authError);
  if (auth !== "proceed" || !user) {
    if (authError && !isMissingAuthSessionError(authError)) {
      console.error("[social/badge-counts] auth unavailable:", authError.message);
    }
    if (auth === "unavailable") {
      return NextResponse.json(
        { error: "Authentication service temporarily unavailable." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    return NextResponse.json(EMPTY_COUNTS);
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
