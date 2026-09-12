import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { applyImpersonationOverride } from "@/lib/impersonation/apply-client";
import { IMPERSONATION_COOKIE } from "@/lib/impersonation/cookie";

/**
 * Supabase browser session for App Route Handlers (cookie read/write).
 * Honors admin view-as the same way `createClient` does.
 */
export async function createRouteHandlerSupabase() {
  const cookieStore = await cookies();
  const session = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
  return applyImpersonationOverride(
    session,
    cookieStore.get(IMPERSONATION_COOKIE)?.value
  );
}
