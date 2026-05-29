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
