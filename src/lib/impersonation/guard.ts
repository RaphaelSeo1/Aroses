import { isAppAdminEnvUser } from "../app-admin-env.ts";
import type { ImpersonationPayload } from "./cookie.ts";

export type ImpersonationActor = {
  id: string;
  email?: string | null;
};

export type StartImpersonationGate =
  | { ok: true }
  | { ok: false; status: 403 | 409; error: string };

/**
 * Start is allowed only for a real app admin who is not already viewing as
 * someone else. Nested impersonation is rejected.
 */
export function canStartImpersonationSession(input: {
  realUser: ImpersonationActor | null | undefined;
  existingPayload: ImpersonationPayload | null;
}): StartImpersonationGate {
  const user = input.realUser;
  if (!user || !isAppAdminEnvUser(user)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (
    input.existingPayload &&
    input.existingPayload.adminId === user.id
  ) {
    return {
      ok: false,
      status: 409,
      error: "Already viewing as a user. Exit first.",
    };
  }
  return { ok: true };
}

/** Cookie is usable only when the live session is the admin who started it. */
export function isValidImpersonator(
  realUser: ImpersonationActor | null | undefined,
  payload: ImpersonationPayload | null
): boolean {
  if (!realUser || !payload) return false;
  if (!isAppAdminEnvUser(realUser)) return false;
  return realUser.id === payload.adminId;
}

export function parseImpersonateTarget(body: unknown):
  | { ok: true; query: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Invalid JSON." };
  }
  const record = body as { email?: unknown; userId?: unknown };
  const userId =
    typeof record.userId === "string" ? record.userId.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim() : "";
  const query = userId || email;
  if (!query) {
    return { ok: false, error: "Enter an email or user id." };
  }
  return { ok: true, query };
}

/**
 * Who the product should treat as the current viewer after the real session
 * has already been verified.
 */
export function resolveProxyViewer(input: {
  realUser: ImpersonationActor;
  impersonation: ImpersonationPayload | null;
}): {
  viewerId: string;
  viewerEmail: string | null;
  isImpersonating: boolean;
  allowAdminHub: boolean;
} {
  const { realUser, impersonation } = input;
  if (isValidImpersonator(realUser, impersonation) && impersonation) {
    return {
      viewerId: impersonation.targetId,
      viewerEmail: impersonation.targetEmail,
      isImpersonating: true,
      allowAdminHub: false,
    };
  }
  return {
    viewerId: realUser.id,
    viewerEmail: realUser.email ?? null,
    isImpersonating: false,
    allowAdminHub: isAppAdminEnvUser(realUser),
  };
}
