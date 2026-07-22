import { NextResponse } from "next/server";
import { suggestProfilesSameSchool } from "@/lib/messaging/profiles";
import { createClient } from "@/lib/supabase/server";

/** GET — same-school people you might know (friend suggestions). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("school_name")
    .eq("id", user.id)
    .maybeSingle();
  const schoolName =
    typeof profile?.school_name === "string" && profile.school_name.trim()
      ? profile.school_name.trim()
      : null;

  if (!schoolName) {
    return NextResponse.json({
      schoolName: null,
      suggestions: [],
    });
  }

  const rows = await suggestProfilesSameSchool(supabase, user.id, 12);
  return NextResponse.json({
    schoolName,
    suggestions: rows.map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      avatarUrl: p.avatar_url,
      schoolName: p.school_name,
    })),
  });
}
