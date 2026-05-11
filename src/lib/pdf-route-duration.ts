/**
 * Must match the numeric literal `maxDuration` in `src/app/api/process-pdf/route.ts`.
 *
 * - **Vercel Hobby**: keep at **60** (required for deploy).
 * - **Vercel Pro**: set both this and `route.ts` `maxDuration` to **300** for reliable PDF builds.
 */
export const PDF_PROCESS_MAX_DURATION_SEC = 60;

/** Anthropic client timeout: stay below the serverless wall minus PDF/DB overhead. */
export function getPdfAnthropicTimeoutMs(): number {
  return Math.max(45_000, PDF_PROCESS_MAX_DURATION_SEC * 1000 - 40_000);
}
