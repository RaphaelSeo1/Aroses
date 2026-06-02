import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

export async function DELETE(
  _request: Request,
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

  // RLS restricts deletes to the owner; scope the match defensively anyway.
  const { error } = await supabase
    .from("forum_posts")
    .delete()
    .eq("id", postId)
    .eq("user_id", user.id);

  if (error) {
    console.error("[forum] delete post failed", error);
    return NextResponse.json({ error: "Could not delete." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
