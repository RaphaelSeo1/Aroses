import Link from "next/link";
import { notFound } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ForumComments } from "@/components/forum/ForumComments";
import { ForumDeletePost } from "@/components/forum/ForumDeletePost";
import { ForumVoteButton } from "@/components/forum/ForumVoteButton";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import {
  FORUM_CATEGORY_BADGE,
  FORUM_CATEGORY_LABELS,
  type ForumComment,
  type ForumPost,
} from "@/types/forum";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ postId: string }> };

export async function generateMetadata({ params }: Props) {
  const { postId } = await params;
  if (!UUID_RE.test(postId)) return { title: `Forum — ${APP_NAME}` };
  const { supabase } = await getServerAuth();
  const { data: post } = await supabase
    .from("forum_posts")
    .select("title")
    .eq("id", postId)
    .maybeSingle();
  if (!post) return { title: `Forum — ${APP_NAME}` };
  return { title: `${post.title} — Forum — ${APP_NAME}` };
}

export default async function ForumPostPage({ params }: Props) {
  const { postId } = await params;
  if (!UUID_RE.test(postId)) notFound();

  const { supabase, user } = await getServerAuth();

  const { data: postRow } = await supabase
    .from("forum_posts")
    .select(
      "id, user_id, author_name, category, title, body, vote_count, comment_count, created_at"
    )
    .eq("id", postId)
    .maybeSingle();

  if (!postRow) notFound();
  const post = postRow as ForumPost;

  const { data: commentRows } = await supabase
    .from("forum_comments")
    .select("id, post_id, user_id, author_name, body, created_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  const comments = (commentRows ?? []) as ForumComment[];

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

  const createdAt = new Date(post.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedInServer />
          ) : (
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/forum">Forum</HeaderNavLink>
              <HeaderNavLink href="/login">Log in</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                Sign up
              </HeaderNavLink>
            </>
          )
        }
      />
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <Link
            href="/forum"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-brand dark:text-zinc-400 dark:hover:text-brand-soft"
          >
            <span aria-hidden>←</span> Back to forum
          </Link>

          <article className="mt-5 flex items-start gap-4 rounded-2xl border border-zinc-200/90 bg-white/95 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
            <ForumVoteButton
              postId={post.id}
              initialCount={post.vote_count}
              initialVoted={voted}
              isAuthenticated={Boolean(user)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${FORUM_CATEGORY_BADGE[post.category]}`}
                >
                  {FORUM_CATEGORY_LABELS[post.category]}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-500">
                  {post.author_name} · {createdAt}
                </span>
                {user?.id === post.user_id ? (
                  <span className="ml-auto">
                    <ForumDeletePost postId={post.id} />
                  </span>
                ) : null}
              </div>
              <h1 className="mt-2 text-2xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
                {post.title}
              </h1>
              {post.body ? (
                <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
                  {post.body}
                </p>
              ) : null}
            </div>
          </article>

          <ForumComments
            postId={post.id}
            initialComments={comments}
            currentUserId={user?.id ?? null}
          />
        </div>
      </main>
    </>
  );
}
