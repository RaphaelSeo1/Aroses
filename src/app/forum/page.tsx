import { AppHeader } from "@/components/AppHeader";
import { ForumApp } from "@/components/forum/ForumApp";
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
      "id, user_id, author_name, category, title, body, vote_count, comment_count, pinned, view_count, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const list = (posts ?? []) as ForumPost[];

  let votedPostIds: string[] = [];
  let isAdmin = false;
  if (user) {
    if (list.length > 0) {
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
    // Matches the DB pin permission (is_app_super_admin); the select-self RLS
    // policy lets a user read only their own admin row.
    const { data: adminRow } = await supabase
      .from("app_super_admins")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    isAdmin = Boolean(adminRow);
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
      <ForumApp
        initialPosts={list}
        votedPostIds={votedPostIds}
        currentUserId={user?.id ?? null}
        isAdmin={isAdmin}
      />
    </>
  );
}
