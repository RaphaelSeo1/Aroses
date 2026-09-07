"use client";

import { useState } from "react";
import type { SrsSessionCard } from "@/components/SrsReviewSession";
import { useT } from "@/lib/i18n/LocaleProvider";
import { tf } from "@/lib/i18n/format";
import { buildSrsSessionUrl } from "@/lib/srs-session-query";
import { isQuizMcq } from "@/types/course";

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; cards: SrsSessionCard[] };

type Props = {
  materialIds: string[];
  scope: "module" | "personal" | "both";
};

export function ReviewQuestionsPreview({ materialIds, scope }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PreviewState>({ status: "idle" });
  const enabled = materialIds.length > 0;
  const previewUrl = buildSrsSessionUrl({ scope, materialIds });

  async function loadQuestions() {
    setState({ status: "loading" });
    try {
      const res = await fetch(previewUrl);
      const body = (await res.json().catch(() => ({}))) as {
        cards?: SrsSessionCard[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(body.error || t.review.questionPreviewError);
      }
      setState({ status: "ready", cards: body.cards ?? [] });
    } catch (error: unknown) {
      setState({
        status: "error",
        message:
          error instanceof Error ? error.message : t.review.questionPreviewError,
      });
    }
  }

  function toggleOpen() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && state.status === "idle") {
      void loadQuestions();
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
            {t.review.questionsInReview}
          </h3>
          <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
            {t.review.questionsInReviewHint}
          </p>
        </div>
        <button
          type="button"
          disabled={!enabled}
          aria-expanded={open}
          aria-controls="review-question-preview"
          onClick={toggleOpen}
          className="inline-flex shrink-0 items-center justify-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          {open ? t.review.hideQuestions : t.review.viewQuestions}
        </button>
      </div>

      {open ? (
        <div
          id="review-question-preview"
          className="border-t border-zinc-200 px-4 py-4 dark:border-zinc-800 sm:px-5"
        >
          {state.status === "idle" || state.status === "loading" ? (
            <p
              role="status"
              className="text-sm text-zinc-500 dark:text-zinc-400"
            >
              {t.review.loadingQuestions}
            </p>
          ) : state.status === "error" ? (
            <div
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
            >
              <p>{state.message}</p>
              <button
                type="button"
                onClick={() => void loadQuestions()}
                className="mt-3 rounded-full border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:hover:bg-red-950/70"
              >
                {t.review.tryAgain}
              </button>
            </div>
          ) : state.cards.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t.review.noQuestionsInReview}
            </p>
          ) : (
            <>
              <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
                {tf(t.review.questionPreviewCount, {
                  count: state.cards.length,
                })}{" "}
                {t.review.answersHiddenHint}
              </p>
              <ol className="max-h-[32rem] space-y-3 overflow-y-auto overscroll-contain pr-1">
                {state.cards.map((card, index) => (
                  <QuestionPreviewItem
                    key={card.cardKey}
                    card={card}
                    number={index + 1}
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function QuestionPreviewItem({
  card,
  number,
}: {
  card: SrsSessionCard;
  number: number;
}) {
  const t = useT();
  const question = card.question;
  const mcq = isQuizMcq(question) ? question : null;
  const answer = isQuizMcq(question)
    ? `${String.fromCharCode(65 + question.correctIndex)}. ${
        question.choices[question.correctIndex]
      }`
    : question.referenceAnswer;

  return (
    <li className="rounded-xl border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        <span>{number}</span>
        <span aria-hidden>·</span>
        <span>{card.courseTitle ?? card.fileName}</span>
        <span aria-hidden>·</span>
        <span>{card.moduleTitle}</span>
        <span className="rounded-full bg-white px-2 py-0.5 dark:bg-zinc-800">
          {card.kind === "module"
            ? t.review.moduleBank
            : t.review.focusCard}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm font-medium leading-relaxed text-zinc-900 dark:text-zinc-100">
        {question.question}
      </p>
      {mcq ? (
        <ol
          type="A"
          className="mt-3 space-y-1 pl-6 text-sm text-zinc-600 dark:text-zinc-300"
        >
          {mcq.choices.map((choice, index) => (
            <li key={`${card.cardKey}-choice-${index}`} className="pl-1">
              {choice}
            </li>
          ))}
        </ol>
      ) : null}
      <details className="group mt-3 rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-950">
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-semibold text-zinc-600 outline-none marker:hidden hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2">
            <span aria-hidden className="transition group-open:rotate-90">
              ▸
            </span>
            {t.review.showAnswer}
          </span>
        </summary>
        <div className="space-y-2 border-t border-zinc-200 px-3 py-3 text-sm leading-relaxed text-zinc-700 dark:border-zinc-700 dark:text-zinc-300">
          <p className="font-semibold text-zinc-900 dark:text-zinc-100">
            {answer}
          </p>
          {question.explanation ? <p>{question.explanation}</p> : null}
        </div>
      </details>
    </li>
  );
}
