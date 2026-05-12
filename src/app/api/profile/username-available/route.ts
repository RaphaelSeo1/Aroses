import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { parseUsername } from "@/lib/onboarding";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = url.searchParams.get("u") ?? "";
  const parsed = parseUsername(raw);
  if (!parsed) {
    return NextResponse.json({
      ok: true as const,
      available: false,
      reason: "invalid" as const,
    });
  }

  const { data, error } = await supabase.rpc("profile_username_available", {
    p_username: parsed,
  });

  if (error) {
    if (/profile_username_available|function|schema cache/i.test(error.message)) {
      return NextResponse.json(
        { error: "Username check is not available yet." },
        { status: 503 }
      );
    }
    console.error(error);
    return NextResponse.json({ error: "Could not check username." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true as const,
    available: Boolean(data),
    normalized: parsed,
  });
}
