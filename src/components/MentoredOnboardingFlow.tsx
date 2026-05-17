"use client";

import { useCallback, useMemo, useState } from "react";
import type { CoursePayload, CourseQuizMcqItem } from "@/types/course";
import type {
  GoalsAnswer,
  InteractionMode,
  KnowledgeLevel,
  LevelQuizState,
  MentoredOnboardingPatch,
  MentoredOnboardingRecord,
  PathChoice,
} from "@/types/mentored";

/**
 * One-time onboarding before a student enters Mentored Learning for a course.
 *
 * Steps:
 *   1. Goals & background — 2-3 free-text questions
 *   2. Knowledge level quiz — 3-5 MCQs generated from the course outline
 *   3. Path choice — Personalized (reordered) vs. Original
 *   4. Interaction mode — Voice-first vs. Text-first
 *
 * On completion, calls `onComplete(record)` with the fully saved row.
 */

const GOALS_QUESTIONS: { id: string; prompt: string; placeholder: string }[] = [
  {
    id: "why",
    prompt: "What brings you to this course?",
    placeholder: "e.g., I have an exam in two weeks and want to feel confident on the core concepts.",
  },
  {
    id: "background",
    prompt: "How familiar are you with this subject already?",
    placeholder: "e.g., I've read a chapter or two; the math notation still throws me off.",
  },
  {
    id: "specific",
    prompt: "Anything specific you want the tutor to focus on or avoid?",
    placeholder: "e.g., Skip the history, lean heavy on worked examples.",
  },
];

type Step = "goals" | "quiz" | "path" | "voice";

function emptyLevelQuiz(): LevelQuizState {
  return { questions: [], answers: [], scorePct: 0 };
}

function classifyLevel(scorePct: number): KnowledgeLevel {
  if (scorePct >= 80) return "advanced";
  if (scorePct >= 50) return "intermediate";
  return "beginner";
}

export function MentoredOnboardingFlow({
  materialId,
  course,
  existing,
  onComplete,
  onSkipToFree,
}: {
  materialId: string;
  course: CoursePayload;
  existing: MentoredOnboardingRecord | null;
  onComplete: (record: MentoredOnboardingRecord) => void;
  onSkipToFree: () => void;
}) {
  const [step, setStep] = useState<Step>(() => {
    if (!existing) return "goals";
    if (existing.goals.length === 0) return "goals";
    if (existing.levelQuiz.questions.length === 0) return "quiz";
    if (
      existing.levelQuiz.answers.some((a) => a < 0) ||
      existing.levelQuiz.answers.length !== existing.levelQuiz.questions.length
    ) {
      return "quiz";
    }
    return "path";
  });

  const [goalsDraft, setGoalsDraft] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        GOALS_QUESTIONS.map((q) => [
          q.id,
          existing?.goals.find((g) => g.question === q.prompt)?.answer ?? "",
        ])
      )
  );

  const [quiz, setQuiz] = useState<LevelQuizState>(
    existing?.levelQuiz ?? emptyLevelQuiz()
  );
  const [quizError, setQuizError] = useState<string | null>(null);
  const [quizLoading, setQuizLoading] = useState(false);

  const [pathChoice, setPathChoice] = useState<PathChoice>(
    existing?.pathChoice ?? "original"
  );
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(
    existing?.interactionMode ?? "voice"
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const upsertOnboarding = useCallback(
    async (patch: MentoredOnboardingPatch) => {
      const res = await fetch(`/api/mentored/onboarding/${materialId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return (await res.json()) as { onboarding: MentoredOnboardingRecord };
    },
    [materialId]
  );

  // ----- Step 1: goals -----
  const submitGoals = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const goals: GoalsAnswer[] = GOALS_QUESTIONS.map((q) => ({
        question: q.prompt,
        answer: goalsDraft[q.id]?.trim() ?? "",
      })).filter((g) => g.answer.length > 0);
      await upsertOnboarding({ goals });
      setStep("quiz");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
    setSaving(false);
  }, [goalsDraft, upsertOnboarding]);

  // ----- Step 2: quiz -----
  const loadQuiz = useCallback(async () => {
    setQuizLoading(true);
    setQuizError(null);
    try {
      const res = await fetch("/api/mentored/onboarding/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ materialId, count: 4 }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { questions: CourseQuizMcqItem[] };
      const next: LevelQuizState = {
        questions: body.questions,
        answers: new Array(body.questions.length).fill(-1),
        scorePct: 0,
      };
      setQuiz(next);
      // Persist the unfinished quiz so a refresh doesn't lose progress.
      try {
        await upsertOnboarding({ levelQuiz: next });
      } catch {
        /* non-fatal */
      }
    } catch (e) {
      setQuizError(e instanceof Error ? e.message : "Could not load quiz.");
    }
    setQuizLoading(false);
  }, [materialId, upsertOnboarding]);

  const pickQuizAnswer = useCallback(
    (qIdx: number, cIdx: number) => {
      setQuiz((prev) => {
        const answers = prev.answers.slice();
        answers[qIdx] = cIdx;
        return { ...prev, answers };
      });
    },
    []
  );

  const allQuizAnswered = useMemo(
    () =>
      quiz.questions.length > 0 &&
      quiz.answers.length === quiz.questions.length &&
      quiz.answers.every((a) => a >= 0),
    [quiz]
  );

  const submitQuiz = useCallback(async () => {
    if (!allQuizAnswered) return;
    setSaving(true);
    setSaveError(null);
    try {
      const correctCount = quiz.questions.reduce(
        (n, q, i) => n + (quiz.answers[i] === q.correctIndex ? 1 : 0),
        0
      );
      const scorePct = Math.round(
        (correctCount / quiz.questions.length) * 100
      );
      const finalQuiz: LevelQuizState = { ...quiz, scorePct };
      const knowledgeLevel = classifyLevel(scorePct);
      await upsertOnboarding({
        levelQuiz: finalQuiz,
        knowledgeLevel,
      });
      setQuiz(finalQuiz);
      setStep("path");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
    setSaving(false);
  }, [allQuizAnswered, quiz, upsertOnboarding]);

  // ----- Step 3: path choice -----
  const submitPath = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await upsertOnboarding({ pathChoice });
      setStep("voice");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
    setSaving(false);
  }, [pathChoice, upsertOnboarding]);

  // ----- Step 4: finish -----
  const finish = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await upsertOnboarding({
        interactionMode,
        completedAt: new Date().toISOString(),
      });
      onComplete(result.onboarding);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
    setSaving(false);
  }, [interactionMode, onComplete, upsertOnboarding]);

  // ===========================================================================
  // Render
  // ===========================================================================
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <header className="space-y-2 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
          Mentored Learning · Setup
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Quick setup, then we dive in
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Four short steps so the tutor can teach{" "}
          <span className="font-medium">{course.title || "this course"}</span>{" "}
          the way you'll actually learn it.
        </p>
        <Stepper step={step} />
      </header>

      {saveError ? (
        <p className="rounded-xl bg-rose-50 px-4 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
          {saveError}
        </p>
      ) : null}

      {step === "goals" ? (
        <GoalsStep
          draft={goalsDraft}
          onChange={(id, v) =>
            setGoalsDraft((prev) => ({ ...prev, [id]: v }))
          }
          onSubmit={submitGoals}
          saving={saving}
          onSkipToFree={onSkipToFree}
        />
      ) : null}

      {step === "quiz" ? (
        <QuizStep
          quiz={quiz}
          loading={quizLoading}
          error={quizError}
          onLoad={loadQuiz}
          onPick={pickQuizAnswer}
          onSubmit={submitQuiz}
          canSubmit={allQuizAnswered}
          saving={saving}
        />
      ) : null}

      {step === "path" ? (
        <PathStep
          scorePct={quiz.scorePct}
          knowledgeLevel={classifyLevel(quiz.scorePct)}
          choice={pathChoice}
          onChange={setPathChoice}
          onSubmit={submitPath}
          saving={saving}
        />
      ) : null}

      {step === "voice" ? (
        <VoiceStep
          mode={interactionMode}
          onChange={setInteractionMode}
          onSubmit={finish}
          saving={saving}
        />
      ) : null}
    </div>
  );
}

// ===========================================================================
// Sub-steps
// ===========================================================================

function Stepper({ step }: { step: Step }) {
  const order: Step[] = ["goals", "quiz", "path", "voice"];
  const labels: Record<Step, string> = {
    goals: "Goals",
    quiz: "Level check",
    path: "Path",
    voice: "Voice or text",
  };
  return (
    <ol className="mx-auto flex w-fit items-center gap-1 text-[11px] uppercase tracking-wider text-zinc-400">
      {order.map((s, i) => {
        const idx = order.indexOf(step);
        const done = i < idx;
        const active = i === idx;
        return (
          <li key={s} className="flex items-center gap-1">
            <span
              className={
                active
                  ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 font-semibold text-white"
                  : done
                    ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 font-semibold text-white"
                    : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-zinc-200 px-1.5 font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }
            >
              {i + 1}
            </span>
            <span
              className={
                active
                  ? "font-semibold text-zinc-700 dark:text-zinc-200"
                  : "text-zinc-400 dark:text-zinc-500"
              }
            >
              {labels[s]}
            </span>
            {i < order.length - 1 ? (
              <span className="mx-1 text-zinc-300">›</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function GoalsStep({
  draft,
  onChange,
  onSubmit,
  saving,
  onSkipToFree,
}: {
  draft: Record<string, string>;
  onChange: (id: string, v: string) => void;
  onSubmit: () => void;
  saving: boolean;
  onSkipToFree: () => void;
}) {
  const filled = GOALS_QUESTIONS.some(
    (q) => (draft[q.id] ?? "").trim().length >= 2
  );
  return (
    <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      {GOALS_QUESTIONS.map((q) => (
        <div key={q.id}>
          <label
            htmlFor={`goals-${q.id}`}
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            {q.prompt}
          </label>
          <textarea
            id={`goals-${q.id}`}
            rows={2}
            value={draft[q.id] ?? ""}
            onChange={(e) => onChange(q.id, e.target.value)}
            placeholder={q.placeholder}
            className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:ring-zinc-700"
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          type="button"
          onClick={onSkipToFree}
          className="text-xs text-zinc-500 underline-offset-2 hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Skip the tutor — let me just read
        </button>
        <button
          type="button"
          disabled={!filled || saving}
          onClick={onSubmit}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function QuizStep({
  quiz,
  loading,
  error,
  onLoad,
  onPick,
  onSubmit,
  canSubmit,
  saving,
}: {
  quiz: LevelQuizState;
  loading: boolean;
  error: string | null;
  onLoad: () => void;
  onPick: (qIdx: number, cIdx: number) => void;
  onSubmit: () => void;
  canSubmit: boolean;
  saving: boolean;
}) {
  const hasQuiz = quiz.questions.length > 0;
  return (
    <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Quick level check
        </p>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          3-5 background questions — pick whatever feels right. Low stakes, no
          grade.
        </p>
      </div>

      {!hasQuiz ? (
        <div className="flex flex-col items-center gap-3 py-6">
          {error ? (
            <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
          ) : null}
          <button
            type="button"
            onClick={onLoad}
            disabled={loading}
            className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
          >
            {loading ? "Generating questions…" : "Start the quick check"}
          </button>
        </div>
      ) : (
        <ol className="space-y-5">
          {quiz.questions.map((q, qi) => (
            <li key={qi} className="space-y-2">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                <span className="mr-1 text-zinc-500">{qi + 1}.</span>
                {q.question}
              </p>
              <ul className="space-y-1.5">
                {q.choices.map((choice, ci) => {
                  const selected = quiz.answers[qi] === ci;
                  return (
                    <li key={ci}>
                      <button
                        type="button"
                        onClick={() => onPick(qi, ci)}
                        className={
                          selected
                            ? "flex w-full items-start gap-3 rounded-xl border border-brand bg-brand/5 px-3 py-2 text-left text-sm text-zinc-900 dark:border-brand-soft dark:bg-brand-soft/10 dark:text-zinc-100"
                            : "flex w-full items-start gap-3 rounded-xl border border-zinc-200 px-3 py-2 text-left text-sm text-zinc-800 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
                        }
                      >
                        <span className="mt-0.5 font-mono text-xs text-zinc-500">
                          {String.fromCharCode(65 + ci)}.
                        </span>
                        <span>{choice}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      {hasQuiz ? (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={!canSubmit || saving}
            onClick={onSubmit}
            className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Submit"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PathStep({
  scorePct,
  knowledgeLevel,
  choice,
  onChange,
  onSubmit,
  saving,
}: {
  scorePct: number;
  knowledgeLevel: KnowledgeLevel;
  choice: PathChoice;
  onChange: (c: PathChoice) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="rounded-xl bg-zinc-50 p-4 dark:bg-zinc-900">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Result
        </p>
        <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
          You scored{" "}
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {scorePct}%
          </span>
          . Looks like you're at the{" "}
          <span className="font-semibold capitalize text-zinc-900 dark:text-zinc-100">
            {knowledgeLevel}
          </span>{" "}
          end. The tutor will calibrate depth and analogies accordingly.
        </p>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Which path would you like?
        </p>
        <PathOption
          active={choice === "personalized"}
          onClick={() => onChange("personalized")}
          title="Personalized course"
          subtitle="Sections reordered and emphasized based on what you already know."
        />
        <PathOption
          active={choice === "original"}
          onClick={() => onChange("original")}
          title="Original outline"
          subtitle="Cover the course exactly as written, no reordering."
        />
      </div>
      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={onSubmit}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}

function PathOption({
  active,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "block w-full rounded-xl border-2 border-brand bg-brand/5 p-4 text-left dark:border-brand-soft dark:bg-brand-soft/10"
          : "block w-full rounded-xl border border-zinc-200 p-4 text-left hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:bg-zinc-900"
      }
    >
      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
    </button>
  );
}

function VoiceStep({
  mode,
  onChange,
  onSubmit,
  saving,
}: {
  mode: InteractionMode;
  onChange: (m: InteractionMode) => void;
  onSubmit: () => void;
  saving: boolean;
}) {
  return (
    <div className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        How do you want the tutor to talk to you?
      </p>
      <PathOption
        active={mode === "voice"}
        onClick={() => onChange("voice")}
        title="Voice first"
        subtitle="The tutor speaks every chunk out loud. You can answer by speaking or typing. Best when you can wear headphones."
      />
      <PathOption
        active={mode === "text"}
        onClick={() => onChange("text")}
        title="Text first"
        subtitle="Chunks appear on screen as text. You can tap a speaker icon to hear any chunk, but nothing autoplays. Best in quiet rooms / classrooms."
      />
      <p className="text-[11px] italic text-zinc-400 dark:text-zinc-500">
        You can switch this any time from the tutor view.
      </p>
      <div className="flex justify-end pt-2">
        <button
          type="button"
          disabled={saving}
          onClick={onSubmit}
          className="inline-flex items-center rounded-full bg-brand px-5 py-2 text-sm font-semibold text-white hover:bg-brand-hover disabled:opacity-60"
        >
          {saving ? "Starting…" : "Start lesson"}
        </button>
      </div>
    </div>
  );
}
