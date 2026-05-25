import type { ComponentProps } from "react";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { fetchSrsDueCountsForUser } from "@/lib/srs-due-counts-server";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

type Props = ComponentProps<typeof HeaderNavLoggedIn>;

/**
 * Server-rendered nav with due-review counts baked in so the badge
 * appears on first paint (no client fetch delay / layout shift).
 */
export async function HeaderNavLoggedInServer(props: Props) {
  const { supabase, user } = await getServerAuth();
  const initialDueCounts = user
    ? await fetchSrsDueCountsForUser(supabase, user.id)
    : null;

  return (
    <HeaderNavLoggedIn
      {...props}
      initialDueCounts={initialDueCounts ?? undefined}
    />
  );
}
