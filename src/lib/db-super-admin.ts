import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * True when migration `025_app_super_admins.sql` is applied and this user is in
 * `app_super_admins`. Used for cross-owner checks after RLS returns a row.
 */
export async function fetchIsDbSuperAdmin(
  supabase: SupabaseClient
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_app_super_admin");
  if (error) {
    return false;
  }
  return Boolean(data);
}
