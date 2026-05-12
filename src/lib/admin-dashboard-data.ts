import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AdminActivityItem = {
  id: string;
  kind: "course_created" | "user_signed_up";
  title: string;
  detail: string;
  at: string;
};

export async function countAllAuthUsers(admin: SupabaseClient): Promise<number> {
  let total = 0;
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[admin] listUsers count", error);
      return total;
    }
    const users = data.users;
    total += users.length;
    if (users.length < perPage) break;
    page += 1;
    if (page > 200) break;
  }
  return total;
}

/**
 * Recent platform events derived from `courses` and Auth users (no audit table).
 * Sorted by time, most recent first.
 */
export async function fetchRecentAdminActivity(
  admin: SupabaseClient
): Promise<AdminActivityItem[]> {
  const [{ data: recentCourses }, { data: userList, error: userErr }] =
    await Promise.all([
      admin
        .from("courses")
        .select("id, title, created_at")
        .order("created_at", { ascending: false })
        .limit(24),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    ]);

  if (userErr) {
    console.error("[admin] listUsers activity", userErr);
  }

  const items: AdminActivityItem[] = [];

  for (const c of recentCourses ?? []) {
    if (!c?.id || !c.created_at) continue;
    const title =
      typeof c.title === "string" && c.title.trim().length > 0
        ? c.title.trim()
        : "Untitled course";
    items.push({
      id: `course-${c.id}-${c.created_at}`,
      kind: "course_created",
      title,
      detail: "Course created",
      at: c.created_at,
    });
  }

  const usersSorted = [...(userList?.users ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  for (const u of usersSorted.slice(0, 24)) {
    if (!u.created_at) continue;
    const email = typeof u.email === "string" ? u.email.trim() : "";
    items.push({
      id: `user-${u.id}-${u.created_at}`,
      kind: "user_signed_up",
      title: email || "New account",
      detail: "User signed up",
      at: u.created_at,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items.slice(0, 10);
}

/** One row for the admin “User directory” table (Auth email + profile fields). */
export type AdminUserRow = {
  id: string;
  email: string;
  signedUpAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  displayName: string | null;
  username: string | null;
  onboardingCompletedAt: string | null;
};

type ProfileDirRow = {
  id: string;
  display_name: string | null;
  username?: string | null;
  onboarding_completed_at?: string | null;
};

/**
 * All Auth users with sign-in email and optional `profiles` fields.
 * Uses the service-role client only (server-side admin page).
 */
export async function fetchAdminUserDirectory(
  admin: SupabaseClient
): Promise<{ users: AdminUserRow[]; error: string | null }> {
  const allAuth: User[] = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[admin] listUsers directory", error);
      return { users: [], error: error.message };
    }
    allAuth.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
    if (page > 200) break;
  }

  const profileMap = new Map<string, ProfileDirRow>();
  const ids = allAuth.map((u) => u.id);
  const chunkSize = 150;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const full = await admin
      .from("profiles")
      .select("id, display_name, username, onboarding_completed_at")
      .in("id", chunk);

    let rows: ProfileDirRow[] | null = null;
    if (
      full.error &&
      /username|onboarding_completed_at|schema cache/i.test(
        full.error.message ?? ""
      )
    ) {
      const minimal = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", chunk);
      if (minimal.error) {
        console.error("[admin] profiles directory chunk", minimal.error);
        continue;
      }
      rows = (minimal.data ?? []) as ProfileDirRow[];
    } else if (full.error) {
      console.error("[admin] profiles directory chunk", full.error);
      continue;
    } else {
      rows = (full.data ?? []) as ProfileDirRow[];
    }

    for (const row of rows ?? []) {
      if (row?.id) profileMap.set(row.id, row);
    }
  }

  const users: AdminUserRow[] = allAuth.map((u) => {
    const pr = profileMap.get(u.id);
    const email = typeof u.email === "string" ? u.email.trim() : "";
    return {
      id: u.id,
      email: email.length > 0 ? email : "—",
      signedUpAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      emailConfirmedAt: u.email_confirmed_at ?? null,
      displayName: pr?.display_name ?? null,
      username: pr?.username ?? null,
      onboardingCompletedAt: pr?.onboarding_completed_at ?? null,
    };
  });

  users.sort(
    (a, b) =>
      new Date(b.signedUpAt).getTime() - new Date(a.signedUpAt).getTime()
  );

  return { users, error: null };
}
