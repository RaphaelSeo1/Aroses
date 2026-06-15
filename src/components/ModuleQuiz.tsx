"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
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
  /** Resets local session state (reshuffle) without undoing saved progress. */
  onPracticeAgain?: () => void;
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
  onPracticeAgain,
}: Props) {
  const t = useT();
  const [index, setIndex] = useState(0);
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [finished, setFinished] = useState(false);
  const [savingExit, setSavingExit] = useState(false);

  // Lock the question list for the lifetime of this session. The parent
  // (CoursePlayer) bumps a `key` on quizSessionEpoch, so a new session gives
  // us a new component instance with a fresh snapshot. This prevents the
  // session from being silently reshuffled by mid-quiz refetches of
  // missed-question indices, which used to swap the current question out
  // from under the learner the moment they answered.
  const sessionItemsRef = useRef(items);
  const sessionItems = sessionItemsRef.current;

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

  const slot = sessionItems[index];
  const q = slot?.question;
  const originalQuizIndex = slot?.originalIndex ?? index;
  const total = sessionItems.length;
  const isLast = index === total - 1;
  const isMc = q ? isQuizMcq(q) : false;

  /** Fresh permutation of A–D each question / session (not taken from stored JSON order). */
  const displayMcq = useMemo(() => {
    const slot = sessionItems[index];
    const slotQ = slot?.question;
    if (!slotQ || !isQuizMcq(slotQ)) return null;
    return shuffleMcqChoices(slotQ);
    // sessionItems is locked at mount, so it is intentionally not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, shuffleEpoch]);

  // Reset transient per-question UI when (and only when) the learner
  // advances to a new question. Do NOT also key this on originalQuizIndex —
  // if some prop re-render produced a different slot at the same index we
  // would clobber the feedback panel mid-read.
  useEffect(() => {
    setMcSelected(null);
    setMcRevealed(false);
    setFrText("");
    setFrBusy(false);
    setFrFeedback(null);
    setFrGraded(false);
    setFrCorrect(false);
    setSubmitError(null);
  }, [index]);

  useEffect(() => {
    const feedbackVisible = mcRevealed || frGraded;
    if (!feedbackVisible) return;
    const t = window.setTimeout(() => setContinueReady(true), 800);
    return () => window.clearTimeout(t);
  }, [mcRevealed, frGraded]);

  const recordMcAttempt = useCallback(
    async (quizQuestionIndex: number, choice: number, isCorrect: boolean) => {
      const slot = sessionItems[index];
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
    [materialId, moduleId, sessionItems, index, onAttemptRecorded]
  );

  const recordFreeAttempt = useCallback(
    async (quizQuestionIndex: number, isCorrect: boolean) => {
      const slot = sessionItems[index];
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
    [materialId, moduleId, sessionItems, index, onAttemptRecorded]
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
        sessionItems[index]?.attemptMaterialId ?? materialId;
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
            : t.study.couldNotGrade
        );
        setFrBusy(false);
        return;
      }
      const correct = Boolean(body.correct);
      const feedback =
        typeof body.feedback === "string"
          ? body.feedback
          : correct
            ? t.study.looksGood
            : t.study.keepRefining;
      setFrCorrect(correct);
      setFrFeedback(feedback);
      setFrGraded(true);
      if (!correct) setWrongAttempts((w) => w + 1);
      await recordFreeAttempt(originalQuizIndex, correct);
    } catch {
      setSubmitError(t.study.networkErrorTryAgain);
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
    sessionItems,
    index,
    t,
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
        ? t.study.noMisses
        : wrongAttempts === 1
          ? t.study.missCountOne
          : tf(t.study.missCount, { count: wrongAttempts }),
    [wrongAttempts, t]
  );

  if (finished) {
    if (mixedCourseReview) {
      return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
          <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.study.mixedReviewComplete}
          </h3>
          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            {tf(t.study.mixedReviewCompleteBody, { count: total })}
          </p>
          <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
          <button
            type="button"
            disabled={savingExit}
            onClick={() => void runComplete("review_lessons")}
            className="transition-none mt-6 inline-flex w-full items-center justify-center rounded-full bg-brand px-6 py-2.5 text-sm font-medium text-white hover:bg-brand-hover disabled:opacity-60 dark:bg-brand dark:hover:bg-brand-soft sm:w-auto"
          >
            {savingExit ? t.study.closing : t.study.backToPracticeRoom}
          </button>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h3 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {t.study.moduleQuizComplete}
        </h3>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {tf(t.study.moduleQuizCompleteBody, { count: total })}
        </p>
        <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {t.study.progressSavedChoose}
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          {onPracticeAgain ? (
            <button
              type="button"
              disabled={savingExit}
              onClick={() => onPracticeAgain()}
              className="transition-none inline-flex flex-1 items-center justify-center rounded-full border border-brand-border bg-brand-blush px-6 py-2.5 text-sm font-semibold text-brand-ink hover:bg-brand-blush/80 disabled:opacity-60 dark:border-brand-border/50 dark:bg-brand-blush/8 dark:text-brand-blush dark:hover:bg-brand-blush/12 sm:flex-none"
            >
              {t.study.practiceAgain}
            </button>
          ) : null}
          <button
            type="button"
            disabled={savingExit}
            onClick={() => void runComplete("review_lessons")}
            className="transition-none inline-flex flex-1 items-center justify-center rounded-full border border-zinc-300 bg-white px-6 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900 sm:flex-none"
          >
            {savingExit ? t.study.saving : t.study.reviewLessonsAgain}
          </button>
          {hasNextModule ? (
            <button
              type="button"
              disabled={savingExit}
              onClick={() => void runComplete("next_module")}
              className="transition-none inline-flex flex-1 items-center justify-center rounded-full bg-brand-hover px-6 py-2.5 text-sm font-medium text-white shadow-sm shadow-red-950/25 hover:bg-red-900 disabled:opacity-60 dark:bg-brand-hover dark:hover:bg-red-950 dark:shadow-black/40 sm:flex-none"
            >
              {savingExit ? t.study.saving : t.study.nextModule}
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
              {savingExit ? t.study.saving : (
                <span className="flex items-center gap-1.5">
                  {t.study.moveToNextUpload}
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
            {t.study.allModulesFinishedBefore}
            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
              {t.study.reviewLessonsAgain}
            </strong>
            {t.study.allModulesFinishedAfter}
          </p>
        ) : null}
      </div>
    );
  }

  if (!q) {
    return (
      <p className="text-sm text-zinc-500">
        {t.study.noQuizQuestions}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <p className="rounded-xl border border-brand-border bg-brand-blush/80 px-4 py-3 text-sm text-brand-ink dark:border-brand-border/50 dark:bg-brand-blush/8 dark:text-brand-blush">
        <span className="font-semibold">{t.study.singlePassLabel}</span>
        {" "}
        {t.study.singlePassBody}
      </p>

      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {tf(t.study.questionXofY, { current: index + 1, total })}{" "}
          <span className="text-zinc-400">
            ({isMc ? t.study.multipleChoice : t.study.shortAnswer})
          </span>
        </span>
        <span>
          {wrongAttempts > 0
            ? tf(t.study.missesSoFar, { count: wrongAttempts })
            : "—"}
        </span>
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
                      {t.study.correct}
                    </span>
                  ) : (
                    <span className="text-red-700 dark:text-red-400">
                      {t.study.incorrectSavedForReview}
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
                      ? t.study.readFeedback
                      : isLast
                        ? t.study.seeResults
                        : t.study.continue}
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
                {t.study.yourAnswer}
              </label>
              <textarea
                id={`free-${moduleId}-${originalQuizIndex}`}
                value={frText}
                onChange={(e) => setFrText(e.target.value)}
                disabled={frBusy || frGraded}
                rows={6}
                placeholder={t.study.answerPlaceholder}
                className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              {!frGraded ? (
                <button
                  type="button"
                  disabled={frBusy || frText.trim().length < 2}
                  onClick={() => void gradeFree()}
                  className="transition-none mt-3 inline-flex rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-50 dark:bg-brand"
                >
                  {frBusy ? t.study.checking : t.study.submitAnswer}
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
                  {frCorrect ? t.study.correctWellDone : t.study.feedback}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {frFeedback}
                </p>
                {!frCorrect && frGraded ? (
                  <p className="mt-4 text-xs text-zinc-500">
                    {t.study.lessonReminder} {q.explanation}
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
                      ? t.study.readFeedback
                      : isLast
                        ? t.study.seeResults
                        : t.study.continue}
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
