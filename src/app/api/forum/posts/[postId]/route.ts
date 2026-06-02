import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

/** Load one thread plus its comments (and whether the viewer has upvoted). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: post } = await supabase
    .from("forum_posts")
    .select(
      "id, user_id, author_name, category, title, body, vote_count, comment_count, pinned, view_count, created_at"
    )
    .eq("id", postId)
    .maybeSingle();

  if (!post) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Count this read (SECURITY DEFINER fn bypasses RLS so anon readers count too).
  await supabase.rpc("forum_bump_views", { p_post_id: postId });
  post.view_count = (post.view_count ?? 0) + 1;

  const { data: comments } = await supabase
    .from("forum_comments")
    .select("id, post_id, user_id, author_name, body, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  let voted = false;
  if (user) {
    const { data: vote } = await supabase
      .from("forum_post_votes")
      .select("post_id")
      .eq("post_id", postId)
      .eq("user_id", user.id)
      .maybeSingle();
    voted = Boolean(vote);
  }

  return NextResponse.json({ post, comments: comments ?? [], voted });
}

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
