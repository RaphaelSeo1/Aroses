import { applyImpersonationOverride } from "@/lib/impersonation/apply-client";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation/cookie";
import { cookies } from "next/headers";
import { createSessionClient } from "@/lib/supabase/session-client";

export { createSessionClient } from "@/lib/supabase/session-client";

/**
 * Product data client. When an admin is viewing as a user, `getUser()`
 * returns that user and queries use the service role scoped by their id.
 */
export async function createClient(options?: { timeoutMs?: number }) {
  const session = await createSessionClient(options);
  const cookieStore = await cookies();
  return applyImpersonationOverride(
    session,
    cookieStore.get(IMPERSONATION_COOKIE)?.value
  );
}
