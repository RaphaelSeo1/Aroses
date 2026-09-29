/**
 * Models for the live lecture notes pipeline (OpenAI chat completions).
 *
 * - `liveNotesModel()` — everything that runs DURING the lecture: slide-deck
 *   seed drafts and every incremental live-notes call (append / revise /
 *   delete are one call). Cheap and fast; the final build repairs slips.
 * - `liveNotesFinalModel()` — the one source-grounded canonical rebuild on
 *   Finish (and the manual "rebuild notes" route).
 *
 * Read at call time so an env change applies without a code change.
 */

export const DEFAULT_LIVE_NOTES_MODEL = "gpt-5.6-luna";
export const DEFAULT_LIVE_NOTES_FINAL_MODEL = "gpt-5.6-sol";

export function liveNotesModel(): string {
  return process.env.LIVE_NOTES_MODEL?.trim() || DEFAULT_LIVE_NOTES_MODEL;
}

export function liveNotesFinalModel(): string {
  return (
    process.env.LIVE_NOTES_FINAL_MODEL?.trim() || DEFAULT_LIVE_NOTES_FINAL_MODEL
  );
}
