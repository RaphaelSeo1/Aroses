import { createAdminClient } from "@/lib/supabase/admin";

/** Resolve an auth user id from email (service role). */
export async function lookupUserIdByEmail(
  email: string
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const admin = createAdminClient();
  if (!admin) return null;

  let page = 1;
  const perPage = 200;
  while (page <= 25) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data.users.length) break;
    const hit = data.users.find(
      (u) => u.email?.trim().toLowerCase() === normalized
    );
    if (hit) return hit.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}
