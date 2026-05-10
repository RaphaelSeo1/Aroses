/**
 * Simplified SM-2 spacing for personal cards (binary correct / incorrect).
 * Correct answers map to quality 4; incorrect to a lapse (relearn).
 */

export type SrsCardState = {
  ease: number;
  intervalDays: number;
  reps: number;
};

export type SrsScheduleResult = {
  next: SrsCardState;
  dueAt: Date;
};

function adjustEase(ease: number, quality: number): number {
  const delta =
    0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02);
  return Math.max(1.3, ease + delta);
}

/**
 * @param prev - Persisted state before this answer
 * @param correct - Whether the learner answered correctly
 * @param now - Current time (injectable for tests)
 */
export function schedulePersonalCard(
  prev: SrsCardState,
  correct: boolean,
  now: Date
): SrsScheduleResult {
  if (!correct) {
    const ease = Math.max(1.3, prev.ease - 0.2);
    const dueSoon = new Date(now.getTime() + 10 * 60 * 1000);
    return {
      next: { ease, intervalDays: 1, reps: 0 },
      dueAt: dueSoon,
    };
  }

  const quality = 4;
  const ease = adjustEase(prev.ease, quality);
  let intervalDays: number;
  const repsBefore = prev.reps;

  if (repsBefore === 0) {
    intervalDays = 1;
  } else if (repsBefore === 1) {
    intervalDays = 6;
  } else {
    intervalDays = Math.max(1, Math.round(prev.intervalDays * ease));
  }

  const reps = repsBefore + 1;

  const dueAt = new Date(now.getTime() + intervalDays * 86400000);
  return {
    next: { ease, intervalDays, reps },
    dueAt,
  };
}

