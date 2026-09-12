import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createBoundedSupabaseFetch } from "@/lib/supabase/bounded-fetch";

/**
 * Cookie-backed Supabase session for the real signed-in user.
 * Does not apply impersonation — use `createClient` for product data.
 */
export async function createSessionClient(options?: { timeoutMs?: number }) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(options?.timeoutMs
        ? {
            global: {
              fetch: createBoundedSupabaseFetch(options.timeoutMs),
            },
          }
        : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options: cookieOptions }) =>
              cookieStore.set(name, value, cookieOptions)
            );
          } catch {
            /* ignore when called from Server Component */
          }
        },
      },
    }
  );
}
