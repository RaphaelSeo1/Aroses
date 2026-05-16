"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { shuffleMcqChoices, type QuizSessionItem } from "@/lib/quiz-session";
import { isQuizMcq } from "@/types/course";

type Props = {
  materialId: string;
  moduleId: number;
  items: QuizSessionItem[];
  /** Bumps when a new quiz session starts — reshuffles MC option order. */
  shuffleEpoch: number;
  /** Whether another module exists after this one in the course */
  hasNextModule: boolean;
  /** File name of the next PDF upload — shown on the "Move to next upload" button */
  nextMaterialFileName?: string;
  /** Called after marking this module complete — choose review vs navigate */
  onCompleteQuiz: (
    choice: "review_lessons" | "next_module"
  ) => void | Promise<void>;
  /** Navigate to the first module of the next PDF/material. Shown when hasNextModule is false. */
  onNextMaterial?: () => void;
  /** Whole-course mixed session — simpler completion, no module completion. */
  mixedCourseReview?: boolean;
  /** Parent refetches quiz-review / progress gauges (e.g. practice drawer). */
  onAttemptRecorded?: () => void;
  /** Fires once when the learner finishes the last question (before exit buttons). */
  onPassFinished?: () => void;
};

export function ModuleQuiz({
  materialId,
  moduleId,
  items,
  shuffleEpoch,
  hasNextModule,
  nextMaterialFileName,
  onCompleteQuiz,
  onNextMaterial,
  mixedCourseReview = false,
  onAttemptRecorded,
  onPassFinished,
}: Props) {
  const [index, setIndex] = useState(0);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [finished, setFinished] = useState(false);
  const [savingExit, setSavingExit] = useState(false);

  /** Multiple choice */
  const [mcSelected, setMcSelected] = useState<number | null>(null);
  const [mcRevealed, setMcRevealed] = useState(false);

  /** Free response */
  const [frText, setFrText] = useState("");
  const [frBusy, setFrBusy] = useState(false);
  const [frFeedback, setFrFeedback] = useState<string | null>(null);
  const [frGraded, setFrGraded] = useState(false);
  const [frCorrect, setFrCorrect] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [continueReady, setContinueReady] = useState(false);

  const slot = items[index];
  const q = slot?.question;
  const originalQuizIndex = slot?.originalIndex ?? index;
  const total = items.length;
  const isLast = index === total - 1;
  const isMc = q ? isQuizMcq(q) : false;

  /** Fresh permutation of A–D each question / session (not taken from stored JSON order). */
  const displayMcq = useMemo(() => {
    const slot = items[index];
    const slotQ = slot?.question;
    if (!slotQ || !isQuizMcq(slotQ)) return null;
    return shuffleMcqChoices(slotQ);
  }, [items, index, shuffleEpoch]);

  useEffect(() => {
    setMcSelected(null);
    setMcRevealed(false);
    setFrText("");
    setFrBusy(false);
    setFrFeedback(null);
    setFrGraded(false);
    setFrCorrect(false);
    setSubmitError(null);
  }, [index, originalQuizIndex]);

  useEffect(() => {
    const feedbackVisible = mcRevealed || frGraded;
    if (!feedbackVisible) return;
    const t = window.setTimeout(() => setContinueReady(true), 800);
    return () => window.clearTimeout(t);
  }, [mcRevealed, frGraded]);

  const recordMcAttempt = useCallback(
    async (quizQuestionIndex: number, choice: number, isCorrect: boolean) => {
      const slot = items[index];
      const pid = slot?.personalItemId;
      const bankMaterialId = slot?.attemptMaterialId ?? materialId;
      const bankModuleId = slot?.attemptModuleId ?? moduleId;
      try {
        await fetch("/api/record-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            pid
              ? {
                  materialId,
                  personalItemId: pid,
                  selectedChoice: choice,
                  isCorrect,
                }
              : {
                  materialId: bankMaterialId,
                  moduleId: bankModuleId,
                  quizQuestionIndex,
                  selectedChoice: choice,
                  isCorrect,
                }
          ),
        });
        onAttemptRecorded?.();
      } catch {
        /* non-blocking */
      }
    },
    [materialId, moduleId, items, index, onAttemptRecorded]
  );

  const recordFreeAttempt = useCallback(
    async (quizQuestionIndex: number, isCorrect: boolean) => {
      const slot = items[index];
      const pid = slot?.personalItemId;
      const bankMaterialId = slot?.attemptMaterialId ?? materialId;
      const bankModuleId = slot?.attemptModuleId ?? moduleId;
      try {
        await fetch("/api/record-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            pid
              ? {
                  materialId,
                  personalItemId: pid,
                  responseKind: "free",
                  isCorrect,
                }
              : {
                  materialId: bankMaterialId,
                  moduleId: bankModuleId,
                  quizQuestionIndex,
                  responseKind: "free",
                  isCorrect,
                }
          ),
        });
        onAttemptRecorded?.();
      } catch {
        /* non-blocking */
      }
    },
    [materialId, moduleId, items, index, onAttemptRecorded]
  );

  const onMcChoose = useCallback(
    async (choiceIndex: number) => {
      if (!displayMcq || mcRevealed) return;
      setContinueReady(false);
      setMcSelected(choiceIndex);
      setMcRevealed(true);
      const ok = choiceIndex === displayMcq.correctIndex;
      if (!ok) setWrongAttempts((w) => w + 1);
      void recordMcAttempt(originalQuizIndex, choiceIndex, ok);
    },
    [displayMcq, mcRevealed, originalQuizIndex, recordMcAttempt]
  );

  const goForward = useCallback(() => {
    if (!continueReady) return;
    setContinueReady(false);
    if (isLast) {
      setFinished(true);
    } else {
      setIndex((i) => i + 1);
    }
  }, [continueReady, isLast]);

  const suppressEarlyContinueKey = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (!continueReady && (event.key === " " || event.key === "Enter")) {
        event.preventDefault();
      }
    },
    [continueReady]
  );

  const gradeFree = useCallback(async () => {
    if (!q || isQuizMcq(q) || frBusy || frGraded) return;
    const answer = frText.trim();
    if (answer.length < 2) return;

    setContinueReady(false);
    setFrBusy(true);
    setFrFeedback(null);
    setSubmitError(null);
    try {
      const gradeMaterialId =
        items[index]?.attemptMaterialId ?? materialId;
      const res = await fetch("/api/quiz-grade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId: gradeMaterialId,
          question: q.question,
          referenceAnswer: q.referenceAnswer,
          studentAnswer: answer,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(
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
      if (!correct) setWrongAttempts((w) => w + 1);
      await recordFreeAttempt(originalQuizIndex, correct);
    } catch {
      setSubmitError("Network error. Try again.");
    }
    setFrBusy(false);
  }, [
    q,
    frBusy,
    frGraded,
    frText,
    materialId,
    originalQuizIndex,
    recordFreeAttempt,
    items,
    index,
  ]);

  useEffect(() => {
    if (!finished || mixedCourseReview) return;
    onPassFinished?.();
  }, [finished, mixedCourseReview, onPassFinished]);

  const runComplete = async (choice: "review_lessons" | "next_module") => {
    setSavingExit(true);
    try {
      await onCompleteQuiz(choice);
    } finally {
      setSavingExit(false);
    }
  };

  const scoreLabel = useMemo(
    () =>
      wrongAttempts === 0
        ? "No misses this pass"
        : `${wrongAttempts} miss${wrongAttempts === 1 ? "" : "es"} — review them later from your queue`,
    [wrongAttempts]
  );

  if (finished) {
    if (mixedCourseReview) {
      return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Mixed review complete
          </h3>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            You finished this pass —{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-100">
              {total}
            </span>{" "}
            questions drawn at random from every module and upload in this
            course. Attempts are saved to each question&apos;s home module.
          </p>
          <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
          <button
            type="button"
            disabled={savingExit}
            onClick={() => void runComplete("review_lessons")}
            className="transition-none mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60 dark:bg-brand dark:hover:bg-brand-soft sm:w-auto"
          >
            {savingExit ? "Closing…" : "Back to practice room"}
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Module quiz complete
        </h3>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          You finished this pass —{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {total}
          </span>{" "}
          questions. Missed items stay in your review queue for next time.
        </p>
        <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Progress is saved when you finish this pass. Choose whether to reread
          the lessons or jump ahead.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={savingExit}
            onClick={() => void runComplete("review_lessons")}
            className="transition-none inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 sm:flex-none"
          >
            {savingExit ? "Saving…" : "Review lessons again"}
          </button>
          {hasNextModule ? (
            <button
              type="button"
              disabled={savingExit}
              onClick={() => void runComplete("next_module")}
              className="transition-none inline-flex flex-1 items-center justify-center rounded-full bg-brand-hover px-6 py-2.5 text-sm font-medium text-white shadow-sm shadow-red-950/25 hover:bg-red-900 disabled:opacity-60 dark:bg-brand-hover dark:hover:bg-red-950 dark:shadow-black/40 sm:flex-none"
            >
              {savingExit ? "Saving…" : "Next module →"}
            </button>
          ) : onNextMaterial ? (
            <button
              type="button"
              disabled={savingExit}
              onClick={() => {
                if (savingExit) return;
                void runComplete("review_lessons").then(() => onNextMaterial());
              }}
              className="transition-none inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-brand-hover px-6 py-2.5 text-sm font-medium text-white shadow-sm shadow-red-950/25 hover:bg-red-900 disabled:opacity-60 dark:bg-brand-hover dark:hover:bg-red-950 dark:shadow-black/40 sm:flex-none"
            >
              {savingExit ? "Saving…" : (
                <span className="flex items-center gap-1.5">
                  Move to next upload
                  {nextMaterialFileName ? (
                    <span className="max-w-[9rem] truncate text-xs text-white/70">
                      {nextMaterialFileName}
                    </span>
                  ) : null}
                  <span>→</span>
                </span>
              )}
            </button>
          ) : null}
        </div>
        {!hasNextModule && !onNextMaterial ? (
          <p className="mt-3 text-xs text-zinc-500">
            You&apos;ve finished all modules in this upload. Use{" "}
            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
              Review lessons again
            </strong>{" "}
            to revisit, or navigate to another upload from the sidebar.
          </p>
        ) : null}
      </div>
    );
  }

  if (!q) {
    return (
      <p className="text-sm text-zinc-500">
        No quiz questions for this module.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-brand-border bg-brand-blush/80 px-4 py-3 text-sm text-brand-ink dark:border-brand-border/50 dark:bg-brand-blush/8 dark:text-brand-blush">
        <span className="font-semibold">Single pass:</span> answer each question
        once. If you miss, you&apos;ll move on — missed questions are logged and
        prioritized in your next run or in the review queue below the lessons.
      </p>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          Question {index + 1} of {total}{" "}
          <span className="text-zinc-400">
            ({isMc ? "multiple choice" : "short answer"})
          </span>
        </span>
        <span>{wrongAttempts > 0 ? `${wrongAttempts} misses so far` : "—"}</span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg font-medium leading-snug text-zinc-900 dark:text-zinc-100">
          {q.question}
        </p>

        {isMc && displayMcq ? (
          <>
            <ul className="mt-5 space-y-2">
              {displayMcq.choices.map((choice, i) => {
                const letter = String.fromCharCode(65 + i);
                const isSel = mcSelected === i;
                const isCorr = i === displayMcq.correctIndex;
                let ring =
                  "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500";
                if (mcRevealed) {
                  if (isCorr) {
                    ring =
                      "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
                  } else if (isSel && !isCorr) {
                    ring = "border-red-500 bg-red-50 dark:bg-red-950/40";
                  }
                } else if (isSel) {
                  ring =
                    "border-brand bg-brand-blush dark:border-brand-soft dark:bg-brand-blush/8";
                }

                return (
                  <li key={`${originalQuizIndex}-${shuffleEpoch}-${i}-${choice.slice(0, 24)}`}>
                    <button
                      type="button"
                      disabled={mcRevealed}
                      onClick={() => void onMcChoose(i)}
                      className={`transition-none flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm ${ring}`}
                    >
                      <span className="mt-0.5 font-mono text-xs text-zinc-500">
                        {letter}.
                      </span>
                      <span className="flex-1">{choice}</span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {mcRevealed && (
              <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {mcSelected === displayMcq.correctIndex ? (
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Correct.
                    </span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400">
                      Incorrect — saved for review. Read the explanation, then
                      continue.
                    </span>
                  )}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {displayMcq.explanation}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!continueReady}
                    onClick={goForward}
                    onKeyDown={suppressEarlyContinueKey}
                    className="transition-none inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {!continueReady
                      ? "Read feedback…"
                      : isLast
                        ? "See results"
                        : "Continue"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : !isQuizMcq(q) ? (
          <>
            <div className="mt-5">
              <label
                className="sr-only"
                htmlFor={`free-${moduleId}-${originalQuizIndex}`}
              >
                Your answer
              </label>
              <textarea
                id={`free-${moduleId}-${originalQuizIndex}`}
                value={frText}
                onChange={(e) => setFrText(e.target.value)}
                disabled={frBusy || frGraded}
                rows={6}
                placeholder="Type your answer in your own words…"
                className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              {!frGraded ? (
                <button
                  type="button"
                  disabled={frBusy || frText.trim().length < 2}
                  onClick={() => void gradeFree()}
                  className="transition-none mt-3 inline-flex rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
                >
                  {frBusy ? "Checking…" : "Submit answer"}
                </button>
              ) : null}
              {submitError ? (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                  {submitError}
                </p>
              ) : null}
            </div>

            {frFeedback && frGraded && (
              <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
                <p
                  className={`text-sm font-medium ${
                    frCorrect
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {frCorrect ? "Correct — well done." : "Feedback"}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {frFeedback}
                </p>
                {!frCorrect && frGraded ? (
                  <p className="mt-4 text-xs text-zinc-500">
                    Lesson reminder: {q.explanation}
                  </p>
                ) : null}
                {frGraded ? (
                  <button
                    type="button"
                    disabled={!continueReady}
                    onClick={goForward}
                    onKeyDown={suppressEarlyContinueKey}
                    className="transition-none mt-4 inline-flex rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                  >
                    {!continueReady
                      ? "Read feedback…"
                      : isLast
                        ? "See results"
                        : "Continue"}
                  </button>
                ) : null}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
