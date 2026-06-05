import { NextResponse } from "next/server";
import { searchProfilesForFriendAdd } from "@/lib/messaging/profiles";
import { createClient } from "@/lib/supabase/server";

/** GET — suggestions while adding a friend (@username or display name). */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const query = (url.searchParams.get("u") ?? "").trim().replace(/^@/, "");
  if (query.length < 2) {
    return NextResponse.json({ suggestions: [] });
  }

  const rows = await searchProfilesForFriendAdd(supabase, user.id, query);
  const suggestions = rows.map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
  }));

  return NextResponse.json({ suggestions });
}
