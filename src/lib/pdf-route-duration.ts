/**
 * Must match the numeric literal `maxDuration` in `src/app/api/process-pdf/route.ts`.
 * **300** = Vercel Pro (long PDF + AI runs). On **Hobby**, change both files to **60**.
 */
export const PDF_PROCESS_MAX_DURATION_SEC = 300;

/** Anthropic client timeout: stay below the serverless wall minus PDF/DB overhead. */
export function getPdfAnthropicTimeoutMs(): number {
  return Math.max(45_000, PDF_PROCESS_MAX_DURATION_SEC * 1000 - 40_000);
}
