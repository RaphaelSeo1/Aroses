import type { ComponentProps } from "react";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { fetchSocialBadgeCounts } from "@/lib/messaging/social-badge-counts";
import { fetchSrsDueCountsForUser } from "@/lib/srs-due-counts-server";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

type Props = ComponentProps<typeof HeaderNavLoggedIn>;

/**
 * Server-rendered nav with due-review + social badge counts baked in so
 * badges appear on first paint (no client fetch delay / layout shift).
 */
export async function HeaderNavLoggedInServer(props: Props) {
  const { supabase, user } = await getServerAuth();

  const [initialDueCounts, initialSocialCounts, profileRes] = user
    ? await Promise.all([
        fetchSrsDueCountsForUser(supabase, user.id),
        fetchSocialBadgeCounts(supabase, user.id),
        supabase
          .from("profiles")
          .select("display_name, avatar_url")
          .eq("id", user.id)
          .maybeSingle(),
      ])
    : [null, null, null];

  const profile = profileRes?.data as
    | { display_name: string | null; avatar_url: string | null }
    | null
    | undefined;

  return (
    <HeaderNavLoggedIn
      {...props}
      initialDueCounts={initialDueCounts ?? undefined}
      initialSocialCounts={initialSocialCounts ?? undefined}
      displayName={profile?.display_name ?? null}
      email={user?.email ?? null}
      avatarUrl={profile?.avatar_url ?? null}
    />
  );
}
