"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isQuizMcq, type CourseQuizItem } from "@/types/course";
import {
  applyRating,
  previewRatings,
  SRS_DEFAULT_STATE,
  type SrsCardState,
  type SrsRating,
} from "@/lib/srs-sm2";
import { tf } from "@/lib/i18n/format";
import { useT } from "@/lib/i18n/LocaleProvider";

/**
 * Flashcard-style review session driver. Implements:
 *   - Show question → reveal answer → rate 1-4 (Again/Hard/Good/Easy)
 *   - Keyboard shortcuts: Space/Enter to reveal, 1-4 to rate
 *   - Interval previews next to each rating button
 *   - "Again" loops the card back into the session (3-5 cards later)
 *   - Pause/Exit + summary screen
 *   - localStorage resume so a refresh doesn't lose your spot
 *
 * Card data must come from /api/srs/session (or be shaped equivalently).
 */

export type SrsSessionCard =
  | {
      kind: "module";
      cardKey: string;
      materialId: string;
      fileName: string;
      courseId: string | null;
      courseTitle: string | null;
      moduleId: number;
      moduleTitle: string;
      questionIndex: number;
      quizIndex: number;
      question: CourseQuizItem;
      srs: { ease: number; intervalDays: number; reps: number } | null;
      dueAt: string | null;
      isNew: boolean;
      reviewCount: number;
    }
  | {
      kind: "personal";
      cardKey: string;
      personalItemId: string;
      materialId: string;
      fileName: string;
      courseId: string | null;
      courseTitle: string | null;
      moduleId: number;
      moduleTitle: string;
      question: CourseQuizItem;
      srs: { ease: number; intervalDays: number; reps: number } | null;
      dueAt: string;
      isNew: boolean;
      reviewCount: number;
    };

export type SrsSessionSummary = {
  total: number;
  ratings: Record<SrsRating, number>;
  startedAt: number;
  finishedAt: number;
};

type Props = {
  /**
   * Stable identifier for this session so localStorage state is namespaced.
   * Pass something like `module-${materialId}` or `global-${userId}`.
   */
  sessionKey: string;
  cards: SrsSessionCard[];
  /** Show course-name chip on each card (true for global review). */
  showCourseBadge?: boolean;
  /** Title shown above the deck (e.g., "Module quiz review"). */
  heading?: string;
  /** Called when the deck is exhausted. */
  onComplete?: (summary: SrsSessionSummary) => void;
  /** Called when user clicks Exit early. */
  onExit?: () => void;
  /** When provided, shows a "Practice again" button on the summary screen. */
  onPracticeAgain?: () => void;
};

/**
 * Where in the upcoming queue an Again-rated card gets reinserted. A small
 * gap (3 cards) is enough to break recency without making the user wait
 * forever to see it again.
 */
const AGAIN_REINSERT_OFFSET = 3;

const RATING_COLORS: Record<
  SrsRating,
  { bg: string; ring: string; text: string; key: string }
> = {
  again: {
    bg: "bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/50",
    ring: "border-red-400 dark:border-red-700",
    text: "text-red-700 dark:text-red-300",
    key: "1",
  },
  hard: {
    bg: "bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/50",
    ring: "border-amber-400 dark:border-amber-700",
    text: "text-amber-800 dark:text-amber-300",
    key: "2",
  },
  good: {
    bg: "bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:hover:bg-emerald-900/50",
    ring: "border-emerald-400 dark:border-emerald-700",
    text: "text-emerald-800 dark:text-emerald-300",
    key: "3",
  },
  easy: {
    bg: "bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/40 dark:hover:bg-sky-900/50",
    ring: "border-sky-400 dark:border-sky-700",
    text: "text-sky-800 dark:text-sky-300",
    key: "4",
  },
};

function ratingLabel(
  rating: SrsRating,
  t: ReturnType<typeof useT>["review"]
): string {
  switch (rating) {
    case "again":
      return t.again;
    case "hard":
      return t.hard;
    case "good":
      return t.good;
    case "easy":
      return t.easy;
  }
}

type ResumeState = {
  queueKeys: string[]; // remaining card keys in order
  doneKeys: string[]; // finished card keys
  ratings: Record<SrsRating, number>;
  startedAt: number;
};

export function SrsReviewSession({
  sessionKey,
  cards,
  showCourseBadge = false,
  heading,
  onComplete,
  onExit,
  onPracticeAgain,
}: Props) {
  const t = useT();
  const storageKey = `aroses.srs.session.${sessionKey}`;

  // Build a lookup of all cards we know about (from the prop) so resume
  // can map saved keys back to live objects.
  const cardById = useMemo(() => {
    const m = new Map<string, SrsSessionCard>();
    for (const c of cards) m.set(c.cardKey, c);
    return m;
  }, [cards]);

  // Hydrate from localStorage if we have a prior session for this key whose
  // cards are still present.
  const initial = useMemo<{
    queue: SrsSessionCard[];
    done: SrsSessionCard[];
    ratings: Record<SrsRating, number>;
    startedAt: number;
  }>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw) as ResumeState;
          const queue = parsed.queueKeys
            .map((k) => cardById.get(k))
            .filter(Boolean) as SrsSessionCard[];
          const done = parsed.doneKeys
            .map((k) => cardById.get(k))
            .filter(Boolean) as SrsSessionCard[];
          if (queue.length > 0 || done.length > 0) {
            return {
              queue,
              done,
              ratings: { ...emptyRatings(), ...parsed.ratings },
              startedAt: parsed.startedAt || Date.now(),
            };
          }
        }
      } catch {
        /* corrupt save — fall through to fresh deck */
      }
    }
    return {
      queue: cards.slice(),
      done: [],
      ratings: emptyRatings(),
      startedAt: Date.now(),
    };
    // The deps are intentionally narrow — we only want to hydrate once per
    // mounted session (the parent's `key` prop is what triggers a fresh
    // session, not a re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [queue, setQueue] = useState<SrsSessionCard[]>(initial.queue);
  const [done, setDone] = useState<SrsSessionCard[]>(initial.done);
  const [ratings, setRatings] = useState<Record<SrsRating, number>>(
    initial.ratings
  );
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Per-card interactive answer state. Reset on each new card via the
  // effect below that watches `current?.cardKey`.
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [frText, setFrText] = useState("");
  const [frBusy, setFrBusy] = useState(false);
  const [frGraded, setFrGraded] = useState(false);
  const [frCorrect, setFrCorrect] = useState(false);
  const [frFeedback, setFrFeedback] = useState<string | null>(null);
  const [frSubmitError, setFrSubmitError] = useState<string | null>(null);
  const startedAtRef = useRef<number>(initial.startedAt);

  const current = queue[0];
  const total = queue.length + done.length;
  const position = done.length + 1;

  // Reset all per-card UI when the visible card changes.
  useEffect(() => {
    setRevealed(false);
    setMcSelected(null);
    setFrText("");
    setFrBusy(false);
    setFrGraded(false);
    setFrCorrect(false);
    setFrFeedback(null);
    setFrSubmitError(null);
  }, [current?.cardKey]);

  // Persist after each meaningful change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (queue.length === 0 && done.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    const snap: ResumeState = {
      queueKeys: queue.map((c) => c.cardKey),
      doneKeys: done.map((c) => c.cardKey),
      ratings,
      startedAt: startedAtRef.current,
    };
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(snap));
    } catch {
      /* quota / private-browsing — non-fatal */
    }
  }, [queue, done, ratings, storageKey]);

  // Compute interval previews for the four buttons based on the live SRS state.
  const previews = useMemo(() => {
    const prev: SrsCardState = current?.srs
      ? {
          ease: current.srs.ease,
          intervalDays: current.srs.intervalDays,
          reps: current.srs.reps,
        }
      : { ...SRS_DEFAULT_STATE };
    return previewRatings(prev, new Date());
  }, [current]);

  // ----------- rating handler -----------
  const handleRate = useCallback(
    async (rating: SrsRating) => {
      if (!current || submitting) return;
      setSubmitting(true);

      // Optimistically advance the local deck. Server call is fire-and-forget
      // (failures get logged; we don't block the session on network).
      void postRating(current, rating).catch((e) =>
        console.error("[srs rate]", e)
      );

      // Locally compute the next SRS state so the in-session preview for the
      // *next* time this card appears stays accurate.
      const prevState: SrsCardState = current.srs
        ? {
            ease: current.srs.ease,
            intervalDays: current.srs.intervalDays,
            reps: current.srs.reps,
          }
        : { ...SRS_DEFAULT_STATE };
      const { next } = applyRating(prevState, rating, new Date());

      setRatings((r) => ({ ...r, [rating]: r[rating] + 1 }));

      if (rating === "again") {
        // Reinsert near the front (after a few other cards) so the learner
        // sees it again this session.
        setQueue((q) => {
          const [head, ...rest] = q;
          if (!head) return q;
          const updated: SrsSessionCard = {
            ...head,
            srs: next,
            isNew: false,
            reviewCount: head.reviewCount + 1,
          };
          const insertAt = Math.min(AGAIN_REINSERT_OFFSET, rest.length);
          const reinjected = [...rest];
          reinjected.splice(insertAt, 0, updated);
          return reinjected;
        });
      } else {
        // Card graduates out of the session.
        setQueue((q) => q.slice(1));
        setDone((d) => [
          ...d,
          {
            ...current,
            srs: next,
            isNew: false,
            reviewCount: current.reviewCount + 1,
          },
        ]);
      }

      // Per-card UI (revealed / mcSelected / frText) resets via the
      // `current.cardKey` effect once the head of the queue changes.
      window.setTimeout(() => setSubmitting(false), 80);
    },
    [current, submitting]
  );

  // ----------- MC answer click -----------
  const handleMcChoose = useCallback(
    (idx: number) => {
      if (!current || revealed) return;
      if (isQuizMcq(current.question)) {
        setMcSelected(idx);
        setRevealed(true);
      }
    },
    [current, revealed]
  );

  // ----------- FRQ submit + AI grade -----------
  const handleFrSubmit = useCallback(async () => {
    if (!current || frBusy || frGraded) return;
    if (isQuizMcq(current.question)) return;
    const answer = frText.trim();
    if (answer.length < 2) return;

    setFrBusy(true);
    setFrSubmitError(null);
    setFrFeedback(null);
    try {
      // If the saved referenceAnswer is a snake_case slug (a known
      // glitch from older course generations), the explanation is the
      // real answer — send that to the grader instead so it doesn't
      // score the student's prose against garbage.
      const rawRef = current.question.referenceAnswer ?? "";
      const gradingRef = looksLikeSlug(rawRef)
        ? current.question.explanation || rawRef
        : rawRef;
      const res = await fetch("/api/quiz-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: current.materialId,
          question: current.question.question,
          referenceAnswer: gradingRef,
          studentAnswer: answer,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        correct?: boolean;
        feedback?: string;
        error?: string;
      };
      if (!res.ok) {
        setFrSubmitError(
          typeof body.error === "string"
            ? body.error
            : "Could not grade. Try again."
        );
        setFrBusy(false);
        return;
      }
      const correct = Boolean(body.correct);
      const feedback =
        typeof body.feedback === "string"
          ? body.feedback
          : correct
            ? "Looks good."
            : "Keep refining your answer.";
      setFrCorrect(correct);
      setFrFeedback(feedback);
      setFrGraded(true);
      setRevealed(true);
    } catch {
      setFrSubmitError("Network error. Try again.");
    }
    setFrBusy(false);
  }, [current, frText, frBusy, frGraded]);

  // ----------- skip-grading shortcut (Space) -----------
  const handleSkipReveal = useCallback(() => {
    if (!current || revealed) return;
    setRevealed(true);
  }, [current, revealed]);

  // ----------- keyboard shortcuts -----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keystrokes from a focused input (especially the FRQ
      // textarea where the learner is typing).
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      if (e.target instanceof HTMLSelectElement) return;
      if (!current) return;

      // Space still works as a power-user "skip and show me the answer"
      // shortcut; the primary UX is clicking choices / typing answers.
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        handleSkipReveal();
        return;
      }
      if (revealed) {
        if (e.key === "1") void handleRate("again");
        else if (e.key === "2") void handleRate("hard");
        else if (e.key === "3") void handleRate("good");
        else if (e.key === "4") void handleRate("easy");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, handleRate, handleSkipReveal, current]);

  // ----------- completion -----------
  const finished = !current && done.length > 0;
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    if (!finished) return;
    const summary: SrsSessionSummary = {
      total: done.length,
      ratings,
      startedAt: startedAtRef.current,
      finishedAt: Date.now(),
    };
    onCompleteRef.current?.(summary);
  }, [finished, done.length, ratings]);

  // ----------- render: empty deck -----------
  if (cards.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t.review.allCaughtUpShort}
        </h3>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {t.review.noCardsDueSession}
        </p>
      </div>
    );
  }

  // ----------- render: summary -----------
  if (finished) {
    const elapsedMs = Date.now() - startedAtRef.current;
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
          {t.review.sessionComplete}
        </h3>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {done.length === 1
            ? tf(t.review.sessionFinishedOne, {
                duration: formatDuration(elapsedMs),
              })
            : tf(t.review.sessionFinished, {
                count: done.length,
                duration: formatDuration(elapsedMs),
              })}
        </p>
        <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {(Object.keys(RATING_COLORS) as SrsRating[]).map((r) => (
            <div
              key={r}
              className={`rounded-xl border ${RATING_COLORS[r].ring} ${RATING_COLORS[r].bg} px-3 py-3`}
            >
              <dt
                className={`text-[11px] font-semibold uppercase tracking-wide ${RATING_COLORS[r].text}`}
              >
                {ratingLabel(r, t.review)}
              </dt>
              <dd className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
                {ratings[r]}
              </dd>
            </div>
          ))}
        </dl>
        <div className="mt-6 flex flex-wrap gap-3">
          {onPracticeAgain ? (
            <button
              type="button"
              onClick={onPracticeAgain}
              className="inline-flex items-center justify-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-md shadow-red-600/20 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
            >
              {t.review.practiceAgain}
            </button>
          ) : null}
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            >
              {t.review.backToOverview}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ----------- render: card -----------
  if (!current) return null;

  // Narrow `question` once at the top of the render — TypeScript can't
  // re-narrow the same property in nested JSX branches.
  const question = current.question;
  const mcq = isQuizMcq(question) ? question : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <SessionHeader
        position={position}
        total={total}
        heading={heading}
        card={current}
        showCourseBadge={showCourseBadge}
        onExit={onExit}
        t={t.review}
      />

      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:p-6">
        <p className="text-base font-medium leading-snug text-zinc-900 dark:text-zinc-100 sm:text-lg">
          {question.question}
        </p>

        {mcq ? (
          <McChoices
            question={mcq}
            cardKey={current.cardKey}
            revealed={revealed}
            selectedIndex={mcSelected}
            onChoose={handleMcChoose}
          />
        ) : !revealed ? (
          <FrqAnswerInput
            value={frText}
            onChange={setFrText}
            onSubmit={() => void handleFrSubmit()}
            onSkip={handleSkipReveal}
            busy={frBusy}
            error={frSubmitError}
          />
        ) : null}

        {revealed ? (
          <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            {!mcq && frGraded ? (
              <FrqGradeBlock
                correct={frCorrect}
                feedback={frFeedback}
                studentAnswer={frText}
              />
            ) : null}
            <RevealedAnswer question={question} />
          </div>
        ) : null}

        {revealed ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(RATING_COLORS) as SrsRating[]).map((r) => {
              const c = RATING_COLORS[r];
              return (
                <button
                  key={r}
                  type="button"
                  disabled={submitting}
                  onClick={() => void handleRate(r)}
                  className={`group flex flex-col items-center gap-1 rounded-xl border-2 px-3 py-3 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${c.ring} ${c.bg} ${c.text}`}
                >
                  <span>{ratingLabel(r, t.review)}</span>
                  <span className="text-xs font-medium opacity-80">
                    {previews[r].label}
                  </span>
                  <span className="mt-1 rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-zinc-600 dark:bg-zinc-950/40 dark:text-zinc-300">
                    {c.key}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---------- subcomponents --------------------------------------------------

function McChoices({
  question,
  cardKey,
  revealed,
  selectedIndex,
  onChoose,
}: {
  // Narrowed type — caller has already checked isQuizMcq.
  question: import("@/types/course").CourseQuizMcqItem;
  cardKey: string;
  revealed: boolean;
  selectedIndex: number | null;
  onChoose: (index: number) => void;
}) {
  return (
    <ul className="mt-5 space-y-2">
      {question.choices.map((choice, i) => {
        const letter = String.fromCharCode(65 + i);
        const isCorrect = i === question.correctIndex;
        const isSelected = selectedIndex === i;

        // Color rules:
        // - while answering: hover/active styles, no green/red
        // - after reveal: correct = green; selected-but-wrong = red;
        //   others = muted.
        let stateClasses = "border-zinc-200 dark:border-zinc-700";
        if (revealed) {
          if (isCorrect) {
            stateClasses =
              "border-emerald-500 bg-emerald-50 text-emerald-900 dark:border-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-100";
          } else if (isSelected) {
            stateClasses =
              "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-600 dark:bg-rose-950/40 dark:text-rose-100";
          } else {
            stateClasses =
              "border-zinc-200 opacity-70 dark:border-zinc-800";
          }
        }

        return (
          <li key={`${cardKey}-${i}`}>
            <button
              type="button"
              disabled={revealed}
              onClick={() => onChoose(i)}
              className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors ${stateClasses} ${
                !revealed
                  ? "hover:border-zinc-400 hover:bg-zinc-50 active:bg-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                  : "cursor-default"
              }`}
            >
              <span className="mt-0.5 font-mono text-xs text-zinc-500">
                {letter}.
              </span>
              <span className="flex-1 text-zinc-800 dark:text-zinc-200">
                {choice}
              </span>
              {revealed && isCorrect ? (
                <span
                  aria-hidden
                  className="mt-0.5 text-emerald-600 dark:text-emerald-400"
                >
                  ✓
                </span>
              ) : null}
              {revealed && isSelected && !isCorrect ? (
                <span
                  aria-hidden
                  className="mt-0.5 text-rose-600 dark:text-rose-400"
                >
                  ✗
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FrqAnswerInput({
  value,
  onChange,
  onSubmit,
  onSkip,
  busy,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onSkip: () => void;
  busy: boolean;
  error: string | null;
}) {
  const canSubmit = value.trim().length >= 2 && !busy;
  return (
    <div className="mt-5 space-y-3">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Your answer
      </label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // Cmd/Ctrl+Enter submits — plain Enter inserts a newline.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={4}
        placeholder="Type your answer in your own words…"
        className="block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
      />
      {error ? (
        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {busy ? "Grading…" : "Submit answer"}
          {!busy ? (
            <span className="ml-2 hidden rounded-full bg-white/20 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide sm:inline">
              ⌘↵
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-xs font-medium text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Skip and show answer
        </button>
      </div>
    </div>
  );
}

function FrqGradeBlock({
  correct,
  feedback,
  studentAnswer,
}: {
  correct: boolean;
  feedback: string | null;
  studentAnswer: string;
}) {
  return (
    <div className="mb-4 space-y-3 border-b border-zinc-200 pb-4 dark:border-zinc-800">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
            correct
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
          }`}
        >
          {correct ? "Looks correct" : "Needs work"}
        </span>
        <span className="text-[11px] text-zinc-500">AI feedback</span>
      </div>
      {feedback ? (
        <p className="break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 [overflow-wrap:anywhere]">
          {feedback}
        </p>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">
          Show your answer
        </summary>
        <p className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 [overflow-wrap:anywhere]">
          {studentAnswer}
        </p>
      </details>
    </div>
  );
}

/**
 * Some older AI-generated courses emitted snake_case identifier strings as
 * their `referenceAnswer` instead of natural prose (e.g.
 * "high_blood_pressure_detected_by_baroreceptors_..."). The explanation
 * paragraph that follows usually contains the same info in readable form,
 * so we detect and hide the slug rather than show garbage to the learner.
 */
function looksLikeSlug(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 30) return false;
  // No real sentence-style whitespace anywhere.
  if (/\s/.test(trimmed)) return false;
  // At least a few underscores, and at least one alphabetical chunk.
  const underscoreCount = (trimmed.match(/_/g) ?? []).length;
  if (underscoreCount < 3) return false;
  return /[a-z]_[a-z]/i.test(trimmed);
}

function RevealedAnswer({ question }: { question: CourseQuizItem }) {
  if (isQuizMcq(question)) {
    return (
      <>
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          Correct answer:{" "}
          {String.fromCharCode(65 + question.correctIndex)}
        </p>
        <p className="mt-3 break-words text-sm leading-relaxed text-zinc-600 dark:text-zinc-400 [overflow-wrap:anywhere]">
          {question.explanation}
        </p>
      </>
    );
  }
  const ref = question.referenceAnswer ?? "";
  const hideRef = looksLikeSlug(ref);
  return (
    <>
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        Answer
      </p>
      {!hideRef ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-800 dark:text-zinc-200 [overflow-wrap:anywhere]">
          {ref}
        </p>
      ) : null}
      <p
        className={`${hideRef ? "mt-2" : "mt-3"} break-words text-sm leading-relaxed text-zinc-700 dark:text-zinc-300 [overflow-wrap:anywhere]`}
      >
        {question.explanation}
      </p>
    </>
  );
}

function SessionHeader({
  position,
  total,
  heading,
  card,
  showCourseBadge,
  onExit,
  t,
}: {
  position: number;
  total: number;
  heading?: string;
  card: SrsSessionCard;
  showCourseBadge: boolean;
  onExit?: () => void;
  t: ReturnType<typeof useT>["review"];
}) {
  const pct = total === 0 ? 0 : Math.round(((position - 1) / total) * 100);
  const badge: ReactNode = (
    <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {card.kind === "module" ? t.moduleBank : t.focusCard}
    </span>
  );
  const courseBadge = showCourseBadge ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand-border/60 bg-brand-blush/40 px-2.5 py-1 text-[11px] font-medium text-brand-ink dark:border-brand-border/30 dark:bg-brand-blush/10 dark:text-brand-soft">
      {card.courseTitle ?? card.fileName}
    </span>
  ) : null;
  const newBadge = card.isNew ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 ring-1 ring-sky-200 dark:bg-sky-950/40 dark:text-sky-200 dark:ring-sky-800">
      {t.newCard}
    </span>
  ) : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {heading ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
              {heading}
            </span>
          ) : null}
          {badge}
          {newBadge}
          {courseBadge}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            · {card.moduleTitle}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="tabular-nums">
            {position}/{total}
          </span>
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t.pauseExit}
            </button>
          ) : null}
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand to-brand-hover transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- utilities ------------------------------------------------------

function emptyRatings(): Record<SrsRating, number> {
  return { again: 0, hard: 0, good: 0, easy: 0 };
}

async function postRating(card: SrsSessionCard, rating: SrsRating) {
  const body =
    card.kind === "module"
      ? {
          kind: "module",
          materialId: card.materialId,
          questionIndex: card.questionIndex,
          rating,
        }
      : {
          kind: "personal",
          personalItemId: card.personalItemId,
          rating,
        };
  const res = await fetch("/api/srs/rate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error || `rate failed: ${res.status}`);
  }
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
  const hrs = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hrs}h ${remMin}m`;
}
