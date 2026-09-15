import { NextResponse } from "next/server";
import { fetchUnreadMessageCount } from "@/lib/messaging/unread-count";
import { WIDGET_SUPABASE_TIMEOUT_MS } from "@/lib/supabase/bounded-fetch";
import { createClient } from "@/lib/supabase/server";

/** GET — unread message count for navbar badge. */
export async function GET() {
  const supabase = await createClient({ timeoutMs: WIDGET_SUPABASE_TIMEOUT_MS });
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ count: 0 });
  }

  try {
    const count = await fetchUnreadMessageCount(supabase, user.id);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
