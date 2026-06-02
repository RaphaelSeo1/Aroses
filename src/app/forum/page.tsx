import { AppHeader } from "@/components/AppHeader";
import { ForumBoard } from "@/components/forum/ForumBoard";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import type { ForumPost } from "@/types/forum";

export const metadata = {
  title: `Forum — ${APP_NAME}`,
  description:
    "Community forum: request courses, share feedback, and discuss with other learners.",
};

export default async function ForumPage() {
  const { supabase, user } = await getServerAuth();

  const { data: posts } = await supabase
    .from("forum_posts")
    .select(
      "id, user_id, author_name, category, title, body, vote_count, comment_count, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (posts ?? []) as ForumPost[];

  let votedPostIds: string[] = [];
  if (user && list.length > 0) {
    const { data: votes } = await supabase
      .from("forum_post_votes")
      .select("post_id")
      .eq("user_id", user.id)
      .in(
        "post_id",
        list.map((p) => p.id)
      );
    votedPostIds = (votes ?? []).map((v) => v.post_id as string);
  }

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
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            Community
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Forum
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            Request the courses you want, share feedback, and talk with other
            learners. Upvote the ideas you’d like us to build next.
          </p>

          <ForumBoard
            initialPosts={list}
            votedPostIds={votedPostIds}
            currentUserId={user?.id ?? null}
          />
        </div>
      </main>
    </>
  );
}
