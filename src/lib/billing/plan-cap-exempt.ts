import "server-only";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * True when this account must not be limited by Stripe plan meters
 * (courses, lecture recordings, voice). All `isAppAdminEnvUser` admins
 * qualify; DB `app_super_admins` stay exempt too.
 */
export async function isUnlimitedPlanMeterUser(
  userId: string,
  email?: string | null
): Promise<boolean> {
  if (isAppAdminEnvUser({ id: userId, email })) return true;

  const admin = createAdminClient();
  if (!admin) return false;

  if (!email) {
    const { data } = await admin.auth.admin.getUserById(userId);
    const lookedUp = data.user?.email ?? null;
    if (isAppAdminEnvUser({ id: userId, email: lookedUp })) return true;
  }

  const { data } = await admin
    .from("app_super_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}
