import type { PostgrestError } from "@supabase/supabase-js";

/** Columns we must keep for onboarding completion (gate reads `onboarding_completed_at`). */
const ONBOARDING_UPSERT_REQUIRED = new Set([
  "id",
  "birthday",
  "study_focus",
  "onboarding_completed_at",
]);

/**
 * If PostgREST/Postgres reports an unknown column on `profiles`, returns that
 * column name so the caller can drop it and retry (partial migrations).
 */
export function parseProfilesMissingColumnName(
  message: string | undefined
): string | null {
  if (!message) return null;
  const m1 = /column "([^"]+)" (?:of relation "\w+" )?does not exist/i.exec(
    message
  );
  if (m1?.[1]) return m1[1];
  const m2 = /Could not find the '([^']+)' column of 'profiles'/i.exec(message);
  if (m2?.[1]) return m2[1];
  const m3 = /Could not find the '([^']+)' column/i.exec(message);
  if (m3?.[1] && /profiles/i.test(message)) return m3[1];
  return null;
}

export function stripOptionalProfileColumn(
  row: Record<string, unknown>,
  column: string
): Record<string, unknown> | null {
  if (ONBOARDING_UPSERT_REQUIRED.has(column) || !(column in row)) {
    return null;
  }
  const { [column]: _removed, ...rest } = row;
  return rest;
}

export function looksLikeProfilesMissingOnboardingCore(
  message: string | undefined
): boolean {
  if (!message) return false;
  const m = message;
  if (/onboarding_completed_at/i.test(m) && /does not exist|42703|could not find/i.test(m)) {
    return true;
  }
  if (/42703/.test(m) && /onboarding_completed_at/i.test(m)) return true;
  return false;
}

export function looksLikeUsernameConstraintError(
  message: string | undefined
): boolean {
  return /unique|duplicate|profiles_username_lower_key/i.test(message ?? "");
}

/**
 * Retries `profiles` upsert after dropping columns Postgres says are missing.
 */
export async function upsertProfileWithOptionalColumnFallback(
  upsert: (
    row: Record<string, unknown>
  ) => Promise<{ error: PostgrestError | null }>,
  initialRow: Record<string, unknown>,
  maxAttempts = 12
): Promise<{ ok: true } | { ok: false; error: PostgrestError }> {
  let row: Record<string, unknown> = { ...initialRow };
  for (let i = 0; i < maxAttempts; i++) {
    const { error } = await upsert(row);
    if (!error) return { ok: true };
    if (looksLikeUsernameConstraintError(error.message)) {
      return { ok: false, error };
    }
    const missing = parseProfilesMissingColumnName(error.message);
    if (!missing) {
      return { ok: false, error };
    }
    const next = stripOptionalProfileColumn(row, missing);
    if (!next) {
      return { ok: false, error };
    }
    row = next;
  }
  const { error } = await upsert(row);
  if (!error) return { ok: true };
  return { ok: false, error };
}
