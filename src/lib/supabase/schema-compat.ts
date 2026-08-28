/** PostgREST / Postgres errors when a migration column is not applied yet. */
export function isMissingDbColumnError(
  err: { code?: string; message?: string } | null | undefined,
  ...columnHints: string[]
): boolean {
  if (!err) return false;
  const code = err.code ?? "";
  if (code === "42703" || code === "PGRST204") return true;
  const msg = (err.message ?? "").toLowerCase();
  if (msg.includes("schema cache")) return true;
  for (const hint of columnHints) {
    if (msg.includes(hint.toLowerCase())) return true;
  }
  return false;
}

/** Best-effort parse of the offending column name from a Postgres/PostgREST error. */
export function missingColumnFromError(
  err: { message?: string } | null | undefined
): string | null {
  const msg = err?.message ?? "";
  const patterns = [
    /column\s+(?:[\w]+\.)?([a-z_]+)\s+does not exist/i,
    /could not find the '([a-z_]+)' column/i,
    /column "([a-z_]+)"/i,
  ];
  for (const re of patterns) {
    const m = msg.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

/** Postgres NOT NULL violation (e.g. material_id before migration 106). */
export function isNotNullViolation(
  err: { code?: string; message?: string } | null | undefined,
  ...columnHints: string[]
): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  const isNn =
    err.code === "23502" ||
    msg.includes("null value in column") ||
    msg.includes("violates not-null");
  if (!isNn) return false;
  if (columnHints.length === 0) return true;
  return columnHints.some((h) => msg.includes(h.toLowerCase()));
}
