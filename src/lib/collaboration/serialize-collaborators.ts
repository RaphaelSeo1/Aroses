import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CollaboratorListItem,
  CourseCollaboratorRow,
} from "@/lib/collaboration/types";

type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
};

export async function enrichCollaboratorRows(
  supabase: SupabaseClient,
  rows: CourseCollaboratorRow[]
): Promise<CollaboratorListItem[]> {
  const userIds = [
    ...new Set(
      rows.map((r) => r.user_id).filter((id): id is string => Boolean(id))
    ),
  ];

  const profileById = new Map<string, ProfileRow>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", userIds);

    for (const p of profiles ?? []) {
      profileById.set(p.id, p as ProfileRow);
    }
  }

  return rows.map((row) => {
    const profile = row.user_id ? profileById.get(row.user_id) : undefined;
    return {
      id: row.id,
      userId: row.user_id,
      invitedEmail: row.invited_email,
      role: row.role,
      status: row.status,
      displayName: profile?.display_name ?? null,
      username: profile?.username ?? null,
      invitedAt: row.created_at,
      acceptedAt: row.accepted_at,
    };
  });
}
