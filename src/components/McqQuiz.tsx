"use client";

import { useCallback, useMemo, useState } from "react";
import type { MCQuestion } from "@/types/study";

type Props = {
  materialId: string;
  questions: MCQuestion[];
};

export function McqQuiz({ materialId, questions }: Props) {
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const q = questions[index];
  const total = questions.length;
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
    async (choiceIndex: number) => {
      if (revealed || !q) return;
      setSelected(choiceIndex);
      setRevealed(true);
      const ok = choiceIndex === q.correctIndex;
      if (ok) setCorrectCount((c) => c + 1);
      else setWrongCount((w) => w + 1);
      await recordAttempt(index, choiceIndex, ok);
    },
    [revealed, q, index, recordAttempt]
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
    () => `${correctCount} correct · ${wrongCount} incorrect`,
    [correctCount, wrongCount]
  );

  if (finished) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-xl font-semibold tracking-tight">Session complete</h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          You answered{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {correctCount}
          </span>{" "}
          out of{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {total}
          </span>{" "}
          questions correctly.
        </p>
        <p className="mt-1 text-sm text-zinc-500">{scoreLabel}</p>
        <p className="mt-4 text-sm text-zinc-500">
          Results are saved so you can pick up where you left off anytime.
        </p>
      </div>
    );
  }

  if (!q) {
    return (
      <p className="text-zinc-500">No questions loaded for this material.</p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between text-sm text-zinc-500">
        <span>
          Question {index + 1} of {total}
        </span>
        <span>{scoreLabel}</span>
      </div>

      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-lg font-medium leading-snug text-zinc-900 dark:text-zinc-100">
          {q.question}
        </p>

        <ul className="mt-5 space-y-2">
          {q.choices.map((choice, i) => {
            const letter = String.fromCharCode(65 + i);
            const isSel = selected === i;
            const isCorrect = i === q.correctIndex;
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
              <li key={i}>
                <button
                  type="button"
                  disabled={revealed}
                  onClick={() => onChoose(i)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm ${ring}`}
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

        {revealed && (
          <div className="mt-6 rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
            <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {selected === q.correctIndex ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  Correct.
                </span>
              ) : (
                <span className="text-red-700 dark:text-red-400">
                  Not quite — review the explanation below.
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
              {isLast ? "See results" : "Next question"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
