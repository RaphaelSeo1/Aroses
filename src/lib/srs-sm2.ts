/**
 * SM-2-style spaced repetition with a 4-button rating (Anki-style).
 *
 * Ratings:
 *   "again" — got it wrong / blanked            (red)
 *   "hard"  — got it right but it was a struggle (orange)
 *   "good"  — got it right with reasonable effort (green)
 *   "easy"  — instant and confident             (blue)
 *
 * Per-card persisted state ({@link SrsCardState}) plus a `due_at` timestamp
 * and an append-only `review_history` log live in the database. This file
 * is the single source of truth for how a rating transforms that state.
 *
 * The numbers below match the spec the product owner wrote, with two
 * pragmatic clamps:
 *   - Ease never goes below 1.3 (standard Anki floor).
 *   - First-review intervals: Again→1d, Hard→1d, Good→1d, Easy→4d.
 *     The spec implies "prev * ease * 1.3" for Easy, but the very first
 *     review has prev=0; 4 days matches Anki's default and feels right.
 *
 * Same-session re-show for "Again" is the caller's job — the *persisted*
 * interval is still 1 day, but the in-memory session loop should requeue
 * the card before the session ends. See `SrsReviewSession`.
 */

export type SrsRating = "again" | "hard" | "good" | "easy";

export type SrsCardState = {
  /** Ease factor, default 2.5, floor 1.3. */
  ease: number;
  /** Persisted interval in days. Sub-day "Again" still stores 1d. */
  intervalDays: number;
  /** Successful reviews in a row (Again resets to 0). */
  reps: number;
};

export type SrsScheduleResult = {
  next: SrsCardState;
  dueAt: Date;
  /** Milliseconds from `now` until the card is due again. */
  intervalMs: number;
};

export type SrsRatingPreview = {
  rating: SrsRating;
  intervalMs: number;
  /** Human-readable preview, e.g. "1 min", "2 d", "1 mo". */
  label: string;
};

export const SRS_DEFAULT_STATE: SrsCardState = {
  ease: 2.5,
  intervalDays: 0,
  reps: 0,
};

const MS_PER_DAY = 86_400_000;
const AGAIN_INTRA_SESSION_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Apply a 4-button rating to a card. Pure function (injectable `now`).
 */
export function applyRating(
  prev: SrsCardState,
  rating: SrsRating,
  now: Date = new Date()
): SrsScheduleResult {
  const prevReps = Math.max(0, Math.floor(prev.reps ?? 0));
  const prevInterval = Math.max(0, prev.intervalDays ?? 0);
  const prevEase = clampEase(prev.ease ?? 2.5);

  let ease = prevEase;
  let intervalDays: number;
  let reps: number;
  let intervalMs: number;

  switch (rating) {
    case "again": {
      ease = clampEase(prevEase - 0.2);
      reps = 0;
      intervalDays = 1; // persisted floor; session loop re-shows sooner
      intervalMs = AGAIN_INTRA_SESSION_MS;
      break;
    }
    case "hard": {
      ease = clampEase(prevEase - 0.15);
      reps = prevReps + 1;
      // 1.2x previous interval; first review starts at 1 day.
      intervalDays = prevInterval > 0 ? Math.max(1, prevInterval * 1.2) : 1;
      intervalMs = intervalDays * MS_PER_DAY;
      break;
    }
    case "good": {
      // Ease unchanged on "good" — matches the spec.
      ease = prevEase;
      reps = prevReps + 1;
      if (prevReps === 0) intervalDays = 1;
      else if (prevReps === 1) intervalDays = 6;
      else intervalDays = Math.max(1, prevInterval * prevEase);
      intervalMs = intervalDays * MS_PER_DAY;
      break;
    }
    case "easy": {
      ease = clampEase(prevEase + 0.15);
      reps = prevReps + 1;
      if (prevReps === 0) intervalDays = 4;
      else intervalDays = Math.max(1, prevInterval * ease * 1.3);
      intervalMs = intervalDays * MS_PER_DAY;
      break;
    }
    default: {
      const _exhaust: never = rating;
      throw new Error(`Unknown rating: ${String(_exhaust)}`);
    }
  }

  const dueAt = new Date(now.getTime() + intervalMs);
  return { next: { ease, intervalDays, reps }, dueAt, intervalMs };
}

/**
 * Compute preview labels for all four ratings so the review UI can show
 * "Again 10m · Hard 2d · Good 4d · Easy 10d" next to the buttons.
 */
export function previewRatings(
  prev: SrsCardState,
  now: Date = new Date()
): Record<SrsRating, SrsRatingPreview> {
  const ratings: SrsRating[] = ["again", "hard", "good", "easy"];
  const out = {} as Record<SrsRating, SrsRatingPreview>;
  for (const rating of ratings) {
    const { intervalMs } = applyRating(prev, rating, now);
    out[rating] = { rating, intervalMs, label: formatIntervalShort(intervalMs) };
  }
  return out;
}

/**
 * Short human label for a time delta, optimized for compact button captions.
 * Examples: "10m", "2h", "4d", "1mo", "1.5y".
 */
export function formatIntervalShort(ms: number): string {
  if (ms < 60_000) return "<1m";
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d`;
  const months = days / 30;
  if (months < 12) return `${Math.round(months)}mo`;
  const years = months / 12;
  // 1 decimal for years, but trim trailing .0
  const rounded = Math.round(years * 10) / 10;
  return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}y`;
}

function clampEase(ease: number): number {
  if (!Number.isFinite(ease)) return 2.5;
  return Math.max(1.3, ease);
}

// ---------- Legacy binary adapter -------------------------------------------
//
// `/api/record-attempt` historically called `schedulePersonalCard(prev,
// correct, now)`. Until that path is migrated to the new endpoint we map
// binary outcomes onto ratings:
//   - correct => "good"
//   - wrong   => "again"

/** @deprecated Use {@link applyRating} with an explicit rating. */
export function schedulePersonalCard(
  prev: SrsCardState,
  correct: boolean,
  now: Date
): { next: SrsCardState; dueAt: Date } {
  const rating: SrsRating = correct ? "good" : "again";
  const { next, dueAt } = applyRating(prev, rating, now);
  return { next, dueAt };
}
