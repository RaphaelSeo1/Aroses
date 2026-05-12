import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Columns we never drop when retrying upserts. `study_focus` is optional here so
 * a DB missing migration 015 can still complete onboarding after stripping it.
 * The gate only needs `onboarding_completed_at` (and a valid profile row).
 */
const ONBOARDING_UPSERT_REQUIRED = new Set([
  "id",
  "birthday",
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
  const mCache = /Could not find the '([^']+)' column in the schema cache/i.exec(
    message
  );
  if (mCache?.[1]) return mCache[1];
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

/** Postgres / PostgREST “blocked by policy” (not a missing-column issue). */
export function looksLikeRowLevelSecurityError(
  message: string | undefined
): boolean {
  return /row-level security|violates row-level security policy|permission denied for table|42501/i.test(
    message ?? ""
  );
}

export function looksLikeJwtExpired(message: string | undefined): boolean {
  return /JWT expired|jwt expired|Invalid JWT|invalid jwt|invalid claim|PGRST301/i.test(
    message ?? ""
  );
}

/**
 * Missing onboarding-related columns (026 / partial schema). Excludes RLS noise.
 */
export function looksLikeMissingProfilesOnboardingMigration(
  message: string | undefined
): boolean {
  if (!message || looksLikeRowLevelSecurityError(message)) return false;
  if (looksLikeProfilesMissingOnboardingCore(message)) return true;
  if (!/42703|does not exist|could not find|schema cache/i.test(message)) {
    return false;
  }
  return /\b(onboarding_completed_at|study_goals|referral_source|onboarding_persona|username|school_name|study_focus)\b/i.test(
    message
  );
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
