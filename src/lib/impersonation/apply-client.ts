import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getImpersonationSecret,
  verifyImpersonationCookie,
  type ImpersonationPayload,
} from "./cookie.ts";
import { isValidImpersonator } from "./guard.ts";

function actingAuthUser(payload: ImpersonationPayload): User {
  const now = new Date().toISOString();
  return {
    id: payload.targetId,
    aud: "authenticated",
    role: "authenticated",
    email: payload.targetEmail,
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
    is_anonymous: false,
  };
}

function withImpersonatedAuth<C extends SupabaseClient>(
  client: C,
  actingUser: User
): C {
  const getUser = async () => ({
    data: { user: actingUser },
    error: null,
  });
  client.auth.getUser = getUser as typeof client.auth.getUser;
  return client;
}

/**
 * When a valid impersonation cookie is present and the session user is the
 * admin who started it, swap `getUser()` to the target and use the service
 * role so RLS (still the admin JWT) does not hide their rows.
 */
export async function applyImpersonationOverride<C extends SupabaseClient>(
  sessionClient: C,
  cookieValue: string | undefined
): Promise<C> {
  const secret = getImpersonationSecret();
  const payload = await verifyImpersonationCookie(cookieValue, secret);
  if (!payload) return sessionClient;

  const {
    data: { user },
  } = await sessionClient.auth.getUser();
  if (!isValidImpersonator(user, payload)) return sessionClient;

  const admin = createAdminClient();
  if (!admin) return sessionClient;

  return withImpersonatedAuth(admin, actingAuthUser(payload)) as C;
}
