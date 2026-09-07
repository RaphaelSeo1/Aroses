"use client";

import { useState } from "react";
import type { SrsSessionCard } from "@/components/SrsReviewSession";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  validateReviewQuestion,
  type ReviewQuestionTarget,
} from "@/lib/srs/question-mutation";
import {
  isQuizMcq,
  type CourseQuizItem,
  type CourseQuizMcqItem,
} from "@/types/course";

type Props = {
  card: SrsSessionCard;
  onUpdated: (question: CourseQuizItem) => void;
  onDeleted: () => void;
};

export function ReviewQuestionControls({
  card,
  onUpdated,
  onDeleted,
}: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState<CourseQuizItem>(card.question);
  const [busy, setBusy] = useState<"saving" | "deleting" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const validation = validateReviewQuestion(draft);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }

    setBusy("saving");
    setError(null);
    try {
      const res = await fetch("/api/srs/questions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target: targetForCard(card),
          question: validation.question,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        question?: CourseQuizItem;
        error?: string;
      };
      if (!res.ok || !body.question) {
        throw new Error(body.error || t.review.questionSaveError);
      }
      setDraft(body.question);
      setEditing(false);
      onUpdated(body.question);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : t.review.questionSaveError
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("deleting");
    setError(null);
    try {
      const res = await fetch("/api/srs/questions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: targetForCard(card) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(body.error || t.review.questionDeleteError);
      }
      onDeleted();
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : t.review.questionDeleteError
      );
      setBusy(null);
      setConfirmingDelete(false);
    }
  }

  if (editing) {
    return (
      <div className="mt-4 space-y-4 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <QuestionFields
          draft={draft}
          groupName={`correct-${card.cardKey}`}
          onChange={setDraft}
        />
        {error ? (
          <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void save()}
            className="rounded-full bg-brand px-4 py-2 text-xs font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "saving" ? t.review.savingQuestion : t.review.saveQuestion}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setDraft(card.question);
              setError(null);
              setEditing(false);
            }}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            {t.review.cancelQuestionEdit}
          </button>
        </div>
      </div>
    );
  }

  if (confirmingDelete) {
    return (
      <div
        role="group"
        aria-label={t.review.deleteQuestion}
        className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30"
      >
        <p className="text-sm font-semibold text-red-900 dark:text-red-100">
          {t.review.deleteQuestionConfirm}
        </p>
        <p className="mt-1 text-xs text-red-700 dark:text-red-300">
          {t.review.deleteQuestionWarning}
        </p>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-medium text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void remove()}
            className="rounded-full bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "deleting"
              ? t.review.deletingQuestion
              : t.review.confirmDeleteQuestion}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              setError(null);
              setConfirmingDelete(false);
            }}
            className="rounded-full border border-red-300 bg-white px-4 py-2 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          >
            {t.review.cancelQuestionEdit}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-700">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setEditing(true);
        }}
        className="text-xs font-semibold text-brand hover:text-brand-hover dark:text-brand-soft"
      >
        {t.review.editQuestion}
      </button>
      <button
        type="button"
        onClick={() => {
          setError(null);
          setConfirmingDelete(true);
        }}
        className="text-xs font-semibold text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
      >
        {t.review.deleteQuestion}
      </button>
    </div>
  );
}

function QuestionFields({
  draft,
  groupName,
  onChange,
}: {
  draft: CourseQuizItem;
  groupName: string;
  onChange: (question: CourseQuizItem) => void;
}) {
  const t = useT();
  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/15 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100";

  return (
    <>
      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {t.review.questionField}
        <textarea
          rows={3}
          maxLength={2_000}
          value={draft.question}
          onChange={(event) =>
            onChange({ ...draft, question: event.target.value })
          }
          className={inputClass}
        />
      </label>

      {isQuizMcq(draft) ? (
        <fieldset className="space-y-2">
          <legend className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            {t.review.choicesField}
          </legend>
          {draft.choices.map((choice, index) => (
            <label
              key={index}
              className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"
            >
              <input
                type="radio"
                name={groupName}
                checked={draft.correctIndex === index}
                onChange={() =>
                  onChange({ ...draft, correctIndex: index })
                }
                aria-label={`${t.review.correctAnswerField} ${String.fromCharCode(
                  65 + index
                )}`}
                className="shrink-0 text-brand focus:ring-brand"
              />
              <span className="w-4 shrink-0 font-mono">
                {String.fromCharCode(65 + index)}.
              </span>
              <input
                type="text"
                maxLength={2_000}
                value={choice}
                onChange={(event) =>
                  onChange(withChoice(draft, index, event.target.value))
                }
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-brand dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
            </label>
          ))}
          <p className="text-[11px] text-zinc-500">
            {t.review.correctAnswerHint}
          </p>
        </fieldset>
      ) : (
        <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {t.review.answerField}
          <textarea
            rows={3}
            maxLength={2_000}
            value={draft.referenceAnswer}
            onChange={(event) =>
              onChange({ ...draft, referenceAnswer: event.target.value })
            }
            className={inputClass}
          />
        </label>
      )}

      <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        {t.review.explanationField}
        <textarea
          rows={3}
          maxLength={5_000}
          value={draft.explanation}
          onChange={(event) =>
            onChange({ ...draft, explanation: event.target.value })
          }
          className={inputClass}
        />
      </label>
    </>
  );
}

function withChoice(
  question: CourseQuizMcqItem,
  index: number,
  value: string
): CourseQuizMcqItem {
  const choices = [...question.choices] as [string, string, string, string];
  choices[index] = value;
  return { ...question, choices };
}

function targetForCard(card: SrsSessionCard): ReviewQuestionTarget {
  return card.kind === "module"
    ? {
        kind: "module",
        materialId: card.materialId,
        questionIndex: card.questionIndex,
      }
    : {
        kind: "personal",
        personalItemId: card.personalItemId,
      };
}
