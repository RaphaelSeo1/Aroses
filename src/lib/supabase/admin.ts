import { createClient } from "@supabase/supabase-js";

/**
 * Server-only admin client (bypasses RLS). Only use after verifying the user
 * with the cookie-backed client.
 *
 * Accepts the usual manual env names and the names Vercel Marketplace syncs
 * from Supabase (`SUPABASE_SECRET_KEY`, `SUPABASE_URL`).
 */
export function createAdminClient() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim();
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
