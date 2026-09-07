"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import type { MCQuestion } from "@/types/study";
import {
  createMcqAttempt,
  isCorrectMcqChoice,
  shuffleOrder,
  type McqAttempt,
} from "@/lib/quiz-randomization";

type Props = {
  materialId: string;
  questions: MCQuestion[];
};

export function McqQuiz({ materialId, questions }: Props) {
  const t = useT();
  const [session, setSession] = useState<
    { question: MCQuestion; originalIndex: number; attempt: McqAttempt }[] | null
  >(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    const previous = readLegacyPreviousOrder(materialId);
    const sourceOrder = questions.map((_, questionIndex) => questionIndex);
    const previousQuestionOrder = previous?.questionOrder.filter(
      (questionIndex) => questionIndex >= 0 && questionIndex < questions.length
    );
    const questionOrder = shuffleOrder(
      sourceOrder,
      previousQuestionOrder?.length === sourceOrder.length
        ? previousQuestionOrder
        : undefined
    );
    const next = questionOrder.map((originalIndex) => {
      const question = questions[originalIndex];
      return {
        question,
        originalIndex,
        attempt: createMcqAttempt(
          {
            ...question,
            correct: question.choices[question.correctIndex] ?? "",
          },
          previous?.choiceOrders[String(originalIndex)]
        ),
      };
    });
    // Client-only session initialization avoids server/client random-order
    // hydration mismatches; subsequent rerenders keep this snapshot intact.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession(next);
    writeLegacyPreviousOrder(materialId, {
      questionOrder,
      choiceOrders: Object.fromEntries(
        next.map((slot) => [
          String(slot.originalIndex),
          slot.attempt.sourceOrder,
        ])
      ),
    });
  }, [materialId, questions]);

  const slot = session?.[index];
  const q = slot?.question;
  const displayMcq = slot?.attempt;
  const total = session?.length ?? questions.length;
  const isLast = index === total - 1;

  const recordAttempt = useCallback(
    async (
      questionIndex: number,
      choice: number,
      isCorrect: boolean
    ) => {
      try {
        await fetch("/api/record-attempt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            questionIndex,
            selectedChoice: choice,
            isCorrect,
          }),
        });
      } catch {
        /* non-blocking */
      }
    },
    [materialId]
  );

  const onChoose = useCallback(
    async (choiceId: string) => {
      if (revealed || !slot || !displayMcq) return;
      const choice = displayMcq.choices.find((item) => item.id === choiceId);
      if (!choice) return;
      setSelected(choiceId);
      setRevealed(true);
      const ok = isCorrectMcqChoice(displayMcq, choiceId);
      if (ok) setCorrectCount((c) => c + 1);
      else setWrongCount((w) => w + 1);
      await recordAttempt(slot.originalIndex, choice.sourceIndex, ok);
    },
    [revealed, slot, displayMcq, recordAttempt]
  );

  const goNext = useCallback(() => {
    if (isLast) {
      setFinished(true);
      return;
    }
    setIndex((i) => i + 1);
    setSelected(null);
    setRevealed(false);
  }, [isLast]);

  const scoreLabel = useMemo(
    () =>
      tf(t.study.scoreCorrectIncorrect, {
        correct: correctCount,
        wrong: wrongCount,
      }),
    [correctCount, wrongCount, t]
  );

  if (finished) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-xl font-semibold tracking-tight">
          {t.study.sessionComplete}
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          {tf(t.study.sessionCompleteBody, {
            correct: correctCount,
            total,
          })}
        </p>
        <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
        <p className="mt-4 text-sm text-zinc-500">
          {t.study.resultsSaved}
        </p>
      </div>
    );
  }

  if (!session) {
    return <p className="text-zinc-500">Loading quiz…</p>;
  }

  if (!q || !displayMcq) {
    return (
      <p className="text-zinc-500">{t.study.noQuestionsLoaded}</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          {tf(t.study.questionXofY, { current: index + 1, total })}
        </span>
        <span>{scoreLabel}</span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg font-medium leading-snug text-zinc-900 dark:text-zinc-100">
          {q.question}
        </p>

        <ul className="mt-5 space-y-2">
          {displayMcq.choices.map((choice, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSel = selected === choice.id;
            const isCorrect = choice.isCorrect;
            let ring =
              "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700 dark:hover:border-zinc-500";
            if (revealed) {
              if (isCorrect) {
                ring = "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40";
              } else if (isSel && !isCorrect) {
                ring = "border-red-500 bg-red-50 dark:bg-red-950/40";
              }
            } else if (isSel) {
              ring = "border-brand bg-brand-blush dark:border-brand-soft dark:bg-brand-blush/8";
            }

            return (
              <li key={choice.id}>
                <button
                  type="button"
                  disabled={revealed}
                  onClick={() => onChoose(choice.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm ${ring}`}
                >
                  <span className="mt-0.5 font-mono text-xs text-zinc-500">
                    {letter}.
                  </span>
                  <span className="flex-1">{choice.text}</span>
                </button>
              </li>
            );
          })}
        </ul>

        {revealed && (
          <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {selected != null &&
              isCorrectMcqChoice(displayMcq, selected) ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  {t.study.correct}
                </span>
              ) : (
                <span className="text-red-700 dark:text-red-400">
                  {t.study.notQuiteReview}
                </span>
              )}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {q.explanation}
            </p>
            <button
              type="button"
              onClick={goNext}
              className="mt-4 inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              {isLast ? t.study.seeResults : t.study.nextQuestion}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type LegacyPreviousOrder = {
  questionOrder: number[];
  choiceOrders: Record<string, number[]>;
};

function legacyPreviousOrderKey(materialId: string): string {
  return `aroses.legacy-quiz.previous-order.${materialId}`;
}

function readLegacyPreviousOrder(
  materialId: string
): LegacyPreviousOrder | null {
  try {
    const raw = window.localStorage.getItem(legacyPreviousOrderKey(materialId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LegacyPreviousOrder>;
    if (!Array.isArray(parsed.questionOrder)) return null;
    return {
      questionOrder: parsed.questionOrder.filter(Number.isInteger),
      choiceOrders:
        parsed.choiceOrders && typeof parsed.choiceOrders === "object"
          ? parsed.choiceOrders
          : {},
    };
  } catch {
    return null;
  }
}

function writeLegacyPreviousOrder(
  materialId: string,
  order: LegacyPreviousOrder
): void {
  try {
    window.localStorage.setItem(
      legacyPreviousOrderKey(materialId),
      JSON.stringify(order)
    );
  } catch {
    /* Storage may be unavailable in private browsing. */
  }
}
