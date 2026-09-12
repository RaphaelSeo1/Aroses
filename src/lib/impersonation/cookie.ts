/**
 * Signed impersonation cookie (Edge-safe: Web Crypto only).
 *
 * Payload is HMAC-SHA256 signed. The real admin session stays in Supabase
 * auth cookies; this only records who they are viewing as.
 */

export const IMPERSONATION_COOKIE = "aroses_impersonate";
export const IMPERSONATION_MAX_AGE_SEC = 60 * 60 * 8;

export type ImpersonationPayload = {
  v: 1;
  adminId: string;
  targetId: string;
  targetEmail: string;
  iat: number;
  exp: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export function getImpersonationSecret(): string | null {
  const a = process.env.IMPERSONATION_COOKIE_SECRET?.trim();
  const b = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const c = process.env.SUPABASE_SECRET_KEY?.trim();
  return a || b || c || null;
}

export function impersonationCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: IMPERSONATION_MAX_AGE_SEC,
  };
}

export function clearImpersonationCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge: 0;
} {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  };
}

function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (let i = 0; i < view.length; i++) {
    bin += String.fromCharCode(view[i]!);
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
    const bin = atob(padded + pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret) as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    utf8(data) as BufferSource
  );
  return bytesToBase64Url(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

export function buildImpersonationPayload(input: {
  adminId: string;
  targetId: string;
  targetEmail: string;
  nowMs?: number;
  maxAgeSec?: number;
}): ImpersonationPayload {
  const nowSec = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const maxAge = input.maxAgeSec ?? IMPERSONATION_MAX_AGE_SEC;
  return {
    v: 1,
    adminId: input.adminId.trim(),
    targetId: input.targetId.trim(),
    targetEmail: input.targetEmail.trim().toLowerCase(),
    iat: nowSec,
    exp: nowSec + maxAge,
  };
}

function isPayloadShape(value: unknown): value is ImpersonationPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    typeof v.adminId === "string" &&
    isUuid(v.adminId) &&
    typeof v.targetId === "string" &&
    isUuid(v.targetId) &&
    typeof v.targetEmail === "string" &&
    v.targetEmail.length > 0 &&
    v.targetEmail.length <= 320 &&
    typeof v.iat === "number" &&
    typeof v.exp === "number"
  );
}

export async function signImpersonationCookie(
  payload: ImpersonationPayload,
  secret: string
): Promise<string> {
  const body = bytesToBase64Url(utf8(JSON.stringify(payload)));
  const sig = await hmacSha256(secret, body);
  return `${body}.${sig}`;
}

export async function verifyImpersonationCookie(
  raw: string | undefined | null,
  secret: string | null,
  nowMs = Date.now()
): Promise<ImpersonationPayload | null> {
  if (!raw || !secret) return null;
  const trimmed = raw.trim();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;
  const body = trimmed.slice(0, dot);
  const sig = trimmed.slice(dot + 1);
  const expected = await hmacSha256(secret, body);
  if (!timingSafeEqual(sig, expected)) return null;

  const bytes = base64UrlToBytes(body);
  if (!bytes) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!isPayloadShape(parsed)) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (parsed.exp <= nowSec || parsed.iat > nowSec + 60) return null;
  return parsed;
}
