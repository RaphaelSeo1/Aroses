import { NextResponse } from "next/server";
import { searchProfilesByUsernamePrefix } from "@/lib/messaging/profiles";
import { parseUsername } from "@/lib/onboarding";
import { createClient } from "@/lib/supabase/server";

/** GET — username prefix suggestions while adding a friend. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const raw = url.searchParams.get("u") ?? "";
  const parsed = parseUsername(raw.replace(/^@/, ""));
  if (!parsed || parsed.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const rows = await searchProfilesByUsernamePrefix(supabase, parsed);
  const suggestions = rows
    .filter((p) => p.id !== user.id)
    .map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
    }));

  return NextResponse.json({ suggestions });
}
