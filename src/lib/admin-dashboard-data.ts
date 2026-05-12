import type { SupabaseClient } from "@supabase/supabase-js";

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
