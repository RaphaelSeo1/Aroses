import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isUuid } from "./cookie.ts";

export type AuthUserLookup =
  | { ok: true; user: User }
  | { ok: false; status: 400 | 404 | 500; error: string };

/**
 * Resolve an Auth user by UUID or email via the service-role admin API.
 */
export async function findAuthUserByEmailOrId(
  admin: SupabaseClient,
  query: string
): Promise<AuthUserLookup> {
  const raw = query.trim();
  if (!raw) {
    return { ok: false, status: 400, error: "Enter an email or user id." };
  }

  if (isUuid(raw)) {
    const { data, error } = await admin.auth.admin.getUserById(raw);
    if (error || !data.user) {
      return { ok: false, status: 404, error: "User not found." };
    }
    return { ok: true, user: data.user };
  }

  const email = raw.toLowerCase();
  if (!email.includes("@") || email.length > 320) {
    return { ok: false, status: 400, error: "Enter an email or user id." };
  }

  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) {
      console.error("[impersonation] listUsers", error);
      return { ok: false, status: 500, error: "Could not look up users." };
    }
    const found = data.users.find(
      (u) => (u.email ?? "").trim().toLowerCase() === email
    );
    if (found) return { ok: true, user: found };
    if (data.users.length < 1000) break;
    page += 1;
    if (page > 50) break;
  }

  return { ok: false, status: 404, error: "User not found." };
}
