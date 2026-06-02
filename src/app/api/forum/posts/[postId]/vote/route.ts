import { NextResponse } from "next/server";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";

/**
 * Toggle the current user's upvote on a post. Returns the new voted state and
 * the post's refreshed vote count (kept current by a DB trigger).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ postId: string }> }
) {
  const { postId } = await params;
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to vote." }, { status: 401 });
  }

  const { data: existing } = await supabase
    .from("forum_post_votes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", user.id)
    .maybeSingle();

  let voted: boolean;
  if (existing) {
    const { error } = await supabase
      .from("forum_post_votes")
      .delete()
      .eq("post_id", postId)
      .eq("user_id", user.id);
    if (error) {
      console.error("[forum] remove vote failed", error);
      return NextResponse.json({ error: "Could not update vote." }, { status: 500 });
    }
    voted = false;
  } else {
    const { error } = await supabase
      .from("forum_post_votes")
      .insert({ post_id: postId, user_id: user.id });
    if (error) {
      console.error("[forum] add vote failed", error);
      return NextResponse.json({ error: "Could not update vote." }, { status: 500 });
    }
    voted = true;
  }

  const { data: post } = await supabase
    .from("forum_posts")
    .select("vote_count")
    .eq("id", postId)
    .maybeSingle();

  return NextResponse.json({ voted, voteCount: post?.vote_count ?? 0 });
}
