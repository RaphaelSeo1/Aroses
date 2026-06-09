import { NextResponse } from "next/server";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export const runtime = "nodejs";

/** Lightweight voice-cap probe for client UI (clear stale cap banners). */
export async function GET() {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const allowance = await checkVoiceAllowance(user.id, { email: user.email });
  return NextResponse.json({
    allowed: allowance.allowed,
    remainingSeconds: allowance.remainingSeconds,
  });
}
