import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

/**
 * Pin / unpin a thread. Restricted to super admins by RLS
 * (the "Admins manage forum posts" update policy uses is_app_super_admin()),
 * so a non-admin's update simply affects no rows.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    raw = {};
  }
  const pinned = Boolean((raw as { pinned?: unknown }).pinned);

  const { data, error } = await supabase
    .from("forum_posts")
    .update({ pinned })
    .eq("id", postId)
    .select("id, pinned");

  if (error) {
    console.error("[forum] pin failed", error);
    return NextResponse.json({ error: "Could not update." }, { status: 500 });
  }
  if (!data || data.length === 0) {
    // No row updated → caller isn't an admin (or post is gone).
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  return NextResponse.json({ ok: true, pinned });
}
