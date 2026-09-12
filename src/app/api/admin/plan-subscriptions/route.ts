import { NextResponse } from "next/server";
import { requireAppAdminUser } from "@/lib/app-admin-env";
import { loadAdminPlanSubscriptions } from "@/lib/billing/admin-plan-subscriptions";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const gate = requireAppAdminUser(user);
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  const subscriptions = await loadAdminPlanSubscriptions();
  return NextResponse.json({ subscriptions });
}
