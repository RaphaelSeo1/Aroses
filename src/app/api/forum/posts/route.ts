import { NextResponse } from "next/server";
import { resolveForumAuthorName } from "@/lib/forum/author-name";
import { createRouteHandlerSupabase } from "@/lib/supabase/route-handler-client";
import {
  forumDocToPlainText,
  sanitizeForumDoc,
} from "@/lib/forum/rich-text";
import { isForumCategory } from "@/types/forum";

const TITLE_MAX = 140;
const BODY_MAX = 8000;
/** Cap on the serialized rich body so a single post can't bloat the table. */
const BODY_RICH_MAX_BYTES = 400_000;

export async function POST(request: Request) {
  const supabase = await createRouteHandlerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in to post." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    title?: unknown;
    body?: unknown;
    bodyRich?: unknown;
    category?: unknown;
  };
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const category = isForumCategory(b.category) ? b.category : "general";

  // Prefer the rich (TipTap JSON) body when present: sanitize it (strips unsafe
  // link/image URLs) and derive the plain-text mirror used for search/previews.
  // Fall back to a plain-text `body` for clients that don't send rich content.
  const bodyRich = sanitizeForumDoc(b.bodyRich);
  let postBody: string;
  if (bodyRich) {
    if (JSON.stringify(bodyRich).length > BODY_RICH_MAX_BYTES) {
      return NextResponse.json(
        { error: "Post body is too long." },
        { status: 400 }
      );
    }
    postBody = forumDocToPlainText(bodyRich);
  } else {
    postBody = typeof b.body === "string" ? b.body.trim() : "";
  }

  if (title.length < 3) {
    return NextResponse.json(
      { error: "Give your post a title (at least 3 characters)." },
      { status: 400 }
    );
  }
  if (title.length > TITLE_MAX) {
    return NextResponse.json(
      { error: `Title is too long (max ${TITLE_MAX} characters).` },
      { status: 400 }
    );
  }
  if (postBody.length > BODY_MAX) {
    return NextResponse.json(
      { error: "Post body is too long." },
      { status: 400 }
    );
  }

  const authorName = await resolveForumAuthorName(supabase, user);

  const { data: post, error } = await supabase
    .from("forum_posts")
    .insert({
      user_id: user.id,
      author_name: authorName,
      category,
      title,
      body: postBody,
      body_rich: bodyRich,
    })
    .select("id, user_id, author_name, category, title, body, body_rich, vote_count, comment_count, pinned, view_count, created_at")
    .single();

  if (error || !post) {
    console.error("[forum] create post failed", error);
    return NextResponse.json(
      { error: "Could not create post. Try again." },
      { status: 500 }
    );
  }

  return NextResponse.json({ post });
}
