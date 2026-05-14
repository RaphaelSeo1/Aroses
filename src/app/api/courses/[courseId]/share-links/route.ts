import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ courseId: string }> };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 32-character URL-safe token (~190 bits of entropy). */
function newToken(): string {
  return randomBytes(24).toString("base64url");
}

/** GET — list active share links for a course (owner only). */
export async function GET(_request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("course_shares")
    .select("id, token, created_at, revoked_at")
    .eq("course_id", courseId)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42P01" || msg.includes("course_shares")) {
      // Migration not applied yet — return empty list gracefully.
      return NextResponse.json({ shares: [] });
    }
    console.error("[share-links GET]", error);
    return NextResponse.json({ error: "Could not load share links." }, { status: 500 });
  }

  return NextResponse.json({ shares: data ?? [] });
}

/** POST — create a new share link (owner only). */
export async function POST(_request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  // Verify the caller owns the course (RLS would block otherwise, but we want
  // a clean 403 instead of a generic insert error).
  const { data: courseRow, error: courseErr } = await supabase
    .from("courses")
    .select("id, user_id")
    .eq("id", courseId)
    .maybeSingle();
  if (courseErr || !courseRow) {
    return NextResponse.json({ error: "Course not found." }, { status: 404 });
  }
  if (courseRow.user_id !== user.id) {
    return NextResponse.json({ error: "Not your course." }, { status: 403 });
  }

  const token = newToken();
  const { data, error } = await supabase
    .from("course_shares")
    .insert({ course_id: courseId, user_id: user.id, token })
    .select("id, token, created_at, revoked_at")
    .single();

  if (error) {
    const msg = error.message ?? "";
    if (error.code === "42P01" || msg.includes("course_shares")) {
      return NextResponse.json(
        { error: "Share links aren't enabled yet — run migration 029." },
        { status: 503 }
      );
    }
    console.error("[share-links POST]", error);
    return NextResponse.json({ error: "Could not create link." }, { status: 500 });
  }

  return NextResponse.json({ share: data });
}
