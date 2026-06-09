/**
 * Structured logging for the mentored auto-generate notes flow.
 * Leave enabled until the feature is confirmed stable in production.
 *
 * Tutor sessions: POST /api/tutor-session/[id]/synthesize-notes (Sonnet).
 * Mentored lessons: POST /api/mentored/notes/[materialId]/generate-stream (Sonnet, SSE).
 */

export type AutoGenLogPayload = Record<string, unknown>;

export function autoGenLog(step: string, payload?: AutoGenLogPayload): void {
  if (payload !== undefined) {
    console.log(`AUTO-GENERATE: ${step}`, payload);
  } else {
    console.log(`AUTO-GENERATE: ${step}`);
  }
}

export function autoGenLogError(
  step: string,
  error: unknown,
  extra?: AutoGenLogPayload
): void {
  const err =
    error instanceof Error
      ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        }
      : error;
  console.error(`AUTO-GENERATE: ${step}`, { error: err, ...extra });
}
