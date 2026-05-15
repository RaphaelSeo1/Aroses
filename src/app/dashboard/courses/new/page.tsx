"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";

/**
 * Typewriter — reveals `text` one character at a time. Used in the
 * self-study confirm step so the AI's draft feels alive instead of just
 * appearing fully formed. `delayMs` shifts the start so a series of bullets
 * can stagger naturally. `speed` is the per-character delay in ms.
 */
function Typewriter({
  text,
  delayMs = 0,
  speed = 18,
  onDone,
}: {
  text: string;
  delayMs?: number;
  speed?: number;
  onDone?: () => void;
}) {
  const [shown, setShown] = useState(0);
  const [started, setStarted] = useState(delayMs === 0);

  useEffect(() => {
    setShown(0);
    if (delayMs <= 0) {
      setStarted(true);
      return;
    }
    setStarted(false);
    const t = setTimeout(() => setStarted(true), delayMs);
    return () => clearTimeout(t);
  }, [text, delayMs]);

  useEffect(() => {
    if (!started) return;
    if (shown >= text.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), speed);
    return () => clearTimeout(t);
  }, [shown, text, started, speed, onDone]);

  return (
    <>
      {text.slice(0, shown)}
      {started && shown < text.length ? (
        <span className="ml-px inline-block w-[1px] animate-pulse bg-current align-baseline" />
      ) : null}
    </>
  );
}

// ─── Cycling placeholder text ────────────────────────────────────────────────
const PLACEHOLDERS = [
  "I have an exam in 2 days and I'm really struggling with photosynthesis specifically…",
  "I just want a quick overview — I already know the basics…",
  "I need to deeply understand everything, skip nothing…",
  "Focus heavily on the first half of this material, the second half I already know…",
  "I'm reviewing for a final, just need the key concepts to stick…",
  "Explain it to me like I've never seen this before…",
];

function CyclingPlaceholder({ active }: { active: boolean }) {
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!active) return;
    const cycle = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % PLACEHOLDERS.length);
        setVisible(true);
      }, 400);
    }, 3800);
    return () => clearInterval(cycle);
  }, [active]);

  return (
    <span
      className={`pointer-events-none absolute left-4 top-4 select-none text-sm leading-relaxed text-zinc-400 transition-opacity duration-300 dark:text-zinc-600 ${visible ? "opacity-100" : "opacity-0"}`}
    >
      {PLACEHOLDERS[index]}
    </span>
  );
}

// ─── Mode card ────────────────────────────────────────────────────────────────
function ModeCard({
  icon,
  title,
  subtitle,
  bullets,
  cta,
  accent,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  bullets: string[];
  cta: string;
  accent: "brand" | "indigo";
  onClick: () => void;
}) {
  const accentBtn =
    accent === "brand"
      ? "bg-brand text-white shadow-red-600/20 hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
      : "bg-indigo-600 text-white shadow-indigo-600/20 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600";
  const accentBorder =
    accent === "brand"
      ? "hover:border-brand/40 hover:shadow-brand/10"
      : "hover:border-indigo-400/40 hover:shadow-indigo-500/10";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full flex-col items-start rounded-2xl border border-zinc-200 bg-white p-6 text-left shadow-sm transition hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 sm:p-8 ${accentBorder}`}
    >
      <div className="text-3xl">{icon}</div>
      <h2 className="mt-4 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
        {subtitle}
      </p>
      <ul className="mt-4 space-y-1.5">
        {bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <span className="mt-0.5 text-zinc-400 dark:text-zinc-600">✓</span>
            {b}
          </li>
        ))}
      </ul>
      <span
        className={`mt-6 inline-flex items-center rounded-full px-5 py-2.5 text-sm font-semibold shadow-sm transition ${accentBtn}`}
      >
        {cta}
      </span>
    </button>
  );
}

// ─── Self-study confirm step ─────────────────────────────────────────────────
type DraftShape = { title: string; bullets: string[]; summary: string };

function DraftReview({
  draft,
  editableTitle,
  setEditableTitle,
  sectionName,
  setSectionName,
  loading,
  error,
  onConfirm,
  onEditAnswer,
}: {
  draft: DraftShape;
  editableTitle: string;
  setEditableTitle: (v: string) => void;
  sectionName: string;
  setSectionName: (v: string) => void;
  loading: boolean;
  error: string | null;
  onConfirm: () => void;
  onEditAnswer: () => void;
}) {
  // Stagger reveal: title first, then each bullet, then summary.
  // Each segment waits ~its predecessor's char count × speed + a small pad.
  const speed = 16;
  const titleDelay = 0;
  const bulletDelays = useMemo(() => {
    const out: number[] = [];
    let cursor = draft.title.length * speed + 150;
    for (const b of draft.bullets) {
      out.push(cursor);
      cursor += b.length * speed + 90;
    }
    return out;
  }, [draft]);
  const summaryDelay =
    bulletDelays.length > 0
      ? bulletDelays[bulletDelays.length - 1] +
        draft.bullets[draft.bullets.length - 1].length * speed +
        150
      : draft.title.length * speed + 200;

  return (
    <div className="mt-8 space-y-5">
      <div className="rounded-2xl border border-indigo-200 bg-indigo-50/70 px-5 py-5 dark:border-indigo-900/60 dark:bg-indigo-950/30">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          Is this what you want?
        </p>

        {/* Editable course title — the auto-rename problem dies here.
            The user sees a meaningful name immediately and can tweak it. */}
        <label
          htmlFor="self-study-title"
          className="mt-3 block text-xs font-medium text-zinc-500 dark:text-zinc-400"
        >
          Course title
        </label>
        <input
          id="self-study-title"
          value={editableTitle}
          onChange={(e) => setEditableTitle(e.target.value)}
          maxLength={80}
          placeholder={draft.title}
          className="mt-1 block w-full rounded-xl border border-indigo-200 bg-white px-3 py-2 text-base font-semibold text-zinc-900 outline-none ring-indigo-500 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 dark:border-indigo-900/60 dark:bg-zinc-950 dark:text-zinc-100"
        />
        {/* Show the AI's suggestion as a typing-in hint when the user
            hasn't touched it yet (visual feedback only). */}
        {editableTitle === draft.title ? (
          <p className="mt-1 text-[11px] text-indigo-500 dark:text-indigo-400">
            <Typewriter
              text={`✨ Suggested: ${draft.title}`}
              delayMs={titleDelay}
              speed={speed}
            />
          </p>
        ) : null}

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          We&apos;ll focus on
        </p>
        <ul className="mt-2 space-y-1.5 text-sm text-zinc-800 dark:text-zinc-100">
          {draft.bullets.map((b, i) => (
            <li
              key={`${b}-${i}`}
              className="flex items-start gap-2 leading-relaxed"
            >
              <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
              <span>
                <Typewriter text={b} delayMs={bulletDelays[i]} speed={speed} />
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-500">
          One-liner
        </p>
        <p className="mt-1 text-sm italic leading-relaxed text-zinc-700 dark:text-zinc-300">
          <Typewriter text={draft.summary} delayMs={summaryDelay} speed={speed} />
        </p>
      </div>

      <div>
        <label
          htmlFor="self-study-section-review"
          className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
        >
          Folder name{" "}
          <span className="font-normal text-zinc-500">(optional)</span>
        </label>
        <input
          id="self-study-section-review"
          value={sectionName}
          onChange={(e) => setSectionName(e.target.value)}
          maxLength={80}
          placeholder="e.g. Midterm prep, Lecture notes, Bio chapter 4"
          className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none ring-indigo-500 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading || !editableTitle.trim()}
          className="inline-flex flex-1 items-center justify-center rounded-full bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-50 sm:flex-none dark:bg-indigo-500 dark:hover:bg-indigo-600"
        >
          {loading ? "Setting up…" : "Confirm — upload PDF next →"}
        </button>
        <button
          type="button"
          onClick={onEditAnswer}
          disabled={loading}
          className="rounded-full border border-zinc-300 px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
        >
          Edit my answer
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
type Step = "mode" | "public" | "selfStudy";

export default function NewCoursePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Allow deep-linking straight into a step (e.g. workspace shortcut
  // "Start a course" → `?mode=public` skips the chooser).
  const initialStep: Step =
    searchParams.get("mode") === "public"
      ? "public"
      : searchParams.get("mode") === "selfStudy"
        ? "selfStudy"
        : "mode";
  const [step, setStep] = useState<Step>(initialStep);

  // Public course fields
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Self-study fields
  const [studyContext, setStudyContext] = useState("");
  const [sectionName, setSectionName] = useState("");
  // Structured draft (title + bullets + summary) returned by
  // `/api/self-study/draft-summary`. When set, we show a "is this what you
  // want?" review step before creating the course. Each piece typewriter-
  // animates in so the user sees the AI compose the plan in real time.
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [editableTitle, setEditableTitle] = useState("");
  const [polishing, setPolishing] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Auto-focus & resize textarea when entering self-study step
  useEffect(() => {
    if (step === "selfStudy") {
      setTimeout(() => textareaRef.current?.focus(), 80);
    }
  }, [step]);

  // ── Create public course ──────────────────────────────────────────────────
  async function submitPublicCourse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create course.");
        setLoading(false);
        return;
      }
      const id = body.courseId as string | undefined;
      if (id) {
        router.push(`/dashboard/courses/${id}`);
        router.refresh();
      } else {
        setError("Unexpected response.");
      }
    } catch {
      setError("Network error. Try again.");
    }
    setLoading(false);
  }

  // Ask the AI to produce a confirmable plan (title + bullets + summary)
  // from the learner's raw input. The structured response lets the review
  // step show concrete focus bullets — much better than a single one-liner
  // when the learner mentions many topics.
  async function draftPlan(e: React.FormEvent) {
    e.preventDefault();
    const raw = studyContext.trim();
    if (!raw) {
      setError(
        "Tell us a bit about your study situation so we can personalise it for you."
      );
      return;
    }
    setError(null);
    setPolishing(true);
    try {
      const res = await fetch("/api/self-study/draft-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ study_context: raw }),
      });
      const body = (await res.json().catch(() => ({}))) as Partial<DraftShape> & {
        error?: string;
      };
      if (
        !res.ok ||
        typeof body.title !== "string" ||
        typeof body.summary !== "string" ||
        !Array.isArray(body.bullets) ||
        body.bullets.length === 0
      ) {
        setError(
          typeof body.error === "string"
            ? body.error
            : "Couldn't draft a plan — please rephrase and try again."
        );
        setPolishing(false);
        return;
      }
      setDraft({
        title: body.title,
        bullets: body.bullets,
        summary: body.summary,
      });
      setEditableTitle(body.title);
    } catch {
      setError("Network error. Try again.");
    }
    setPolishing(false);
  }

  // ── Create self-study course ──────────────────────────────────────────────
  // We always pass an explicit title now (drawn from the confirmed draft)
  // so the workspace never falls back to the auto-generated
  // "Self study · May 15" date string the user kept seeing.
  async function submitSelfStudy(d: DraftShape, finalTitle: string) {
    if (!d.summary.trim()) {
      setError("Tell us a bit about your study situation so we can personalise it for you.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_self_study: true,
          title: finalTitle.trim() || d.title,
          study_context: d.summary.trim(),
          // Optional — if blank the workspace falls back to "My materials".
          section_name: sectionName.trim() || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "Could not create session.");
        setLoading(false);
        return;
      }
      const id = body.courseId as string | undefined;
      if (id) {
        router.push(`/dashboard/courses/${id}?selfStudy=1`);
        router.refresh();
      } else {
        setError("Unexpected response.");
      }
    } catch {
      setError("Network error. Try again.");
    }
    setLoading(false);
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 sm:py-18">

          {/* ── Step: mode selection ───────────────────────────────────────── */}
          {step === "mode" && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Get started
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                How do you want to study?
              </h1>
              <p className="mt-3 text-zinc-500 dark:text-zinc-400">
                Both options turn your PDFs into lessons and quizzes — the difference is who it&apos;s for.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                <ModeCard
                  icon="🌐"
                  title="Create Public Course"
                  subtitle="Build a structured course other students can discover and enroll in."
                  bullets={[
                    "Appears on the Explore page",
                    "Add sections and multiple uploads",
                    "Track learner progress",
                  ]}
                  cta="Create course →"
                  accent="brand"
                  onClick={() => { setStep("public"); setError(null); }}
                />
                <ModeCard
                  icon="🎯"
                  title="Self Study Mode"
                  subtitle="A private, personalised session built around your specific goal — exam prep, deep dives, quick reviews."
                  bullets={[
                    "Stays 100% private to you",
                    "AI calibrates depth and focus to your goal",
                    "Voice tutor knows your background",
                  ]}
                  cta="Start self study →"
                  accent="indigo"
                  onClick={() => { setStep("selfStudy"); setError(null); }}
                />
              </div>
              <div className="mt-6 text-center">
                <Link
                  href="/"
                  className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  ← Back
                </Link>
              </div>
            </>
          )}

          {/* ── Step: public course form ───────────────────────────────────── */}
          {step === "public" && (
            <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-8 shadow-xl shadow-zinc-900/5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 sm:p-10">
              <button
                type="button"
                onClick={() => { setStep("mode"); setError(null); }}
                className="mb-6 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                ← Back
              </button>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Public course
              </p>
              <h1 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Name your course
              </h1>
              <p className="mt-3 leading-relaxed text-zinc-500 dark:text-zinc-400">
                You&apos;ll add sections and upload PDFs next — we turn each one into lessons and quizzes.
              </p>
              <form onSubmit={(e) => void submitPublicCourse(e)} className="mt-8 space-y-6">
                <div>
                  <label htmlFor="title" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Course title
                  </label>
                  <input
                    id="title"
                    required
                    minLength={2}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Immunology midterm prep"
                    className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 shadow-sm outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                <div>
                  <label htmlFor="description" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                    Description{" "}
                    <span className="font-normal text-zinc-500">(optional)</span>
                  </label>
                  <textarea
                    id="description"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What should this course cover? Who is it for?"
                    className="mt-2 block w-full resize-y rounded-xl border border-zinc-300 bg-white px-4 py-3 text-zinc-900 shadow-sm outline-none ring-brand placeholder:text-zinc-400 focus:border-brand focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                  />
                </div>
                {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex flex-1 items-center justify-center rounded-full bg-brand px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover disabled:opacity-60 sm:flex-none"
                  >
                    {loading ? "Creating…" : "Continue"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ── Step: self-study conversational input ─────────────────────── */}
          {step === "selfStudy" && (
            <div className="rounded-3xl border border-indigo-200/70 bg-white/95 p-8 shadow-xl shadow-indigo-900/5 backdrop-blur dark:border-indigo-900/40 dark:bg-zinc-950/95 sm:p-10">
              <button
                type="button"
                onClick={() => { setStep("mode"); setError(null); }}
                className="mb-6 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
              >
                ← Back
              </button>

              <div className="flex items-center gap-3">
                <span className="text-3xl">🎯</span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                    Self Study Mode
                  </p>
                  <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                    Tell us about your study situation
                  </h1>
                </div>
              </div>

              <p className="mt-4 leading-relaxed text-zinc-500 dark:text-zinc-400">
                What do you need from this material? The more specific you are, the better we can tailor it for you — upload your PDF next and we&apos;ll build a course around exactly your goal.
              </p>

              {draft === null ? (
                /* Stage 1 — drafting: capture the learner's raw goal. */
                <form
                  onSubmit={(e) => void draftPlan(e)}
                  className="mt-8 space-y-5"
                >
                  <div className="relative">
                    {!studyContext && (
                      <CyclingPlaceholder active={step === "selfStudy"} />
                    )}
                    <textarea
                      ref={textareaRef}
                      rows={5}
                      value={studyContext}
                      onChange={(e) => setStudyContext(e.target.value)}
                      className="block w-full resize-none rounded-2xl border border-zinc-300 bg-white px-4 py-4 text-sm leading-relaxed text-zinc-900 shadow-sm outline-none ring-indigo-500 placeholder:text-transparent focus:border-indigo-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      maxLength={4000}
                    />
                    {studyContext.length > 3600 && (
                      <p className="mt-1 text-right text-xs text-zinc-400">
                        {4000 - studyContext.length} characters left
                      </p>
                    )}
                  </div>

                  {/* Hint chips — tap to fill */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      "I have an exam soon",
                      "I already know the basics",
                      "I'm completely new to this",
                      "Focus on one specific topic",
                    ].map((hint) => (
                      <button
                        key={hint}
                        type="button"
                        onClick={() =>
                          setStudyContext((prev) =>
                            prev ? `${prev} ${hint.toLowerCase()}` : hint
                          )
                        }
                        className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-indigo-950 dark:hover:text-indigo-300"
                      >
                        {hint}
                      </button>
                    ))}
                  </div>

                  <div>
                    <label
                      htmlFor="self-study-section"
                      className="block text-sm font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      Folder name{" "}
                      <span className="font-normal text-zinc-500">
                        (optional — shows as the materials tab)
                      </span>
                    </label>
                    <input
                      id="self-study-section"
                      value={sectionName}
                      onChange={(e) => setSectionName(e.target.value)}
                      maxLength={80}
                      placeholder="e.g. Midterm prep, Lecture notes, Bio chapter 4"
                      className="mt-2 block w-full rounded-xl border border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-900 outline-none ring-indigo-500 placeholder:text-zinc-400 focus:border-indigo-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                    />
                  </div>

                  {error && (
                    <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <button
                      type="submit"
                      disabled={polishing || !studyContext.trim()}
                      className="inline-flex flex-1 items-center justify-center rounded-full bg-indigo-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700 disabled:opacity-50 sm:flex-none dark:bg-indigo-500 dark:hover:bg-indigo-600"
                    >
                      {polishing
                        ? "Drafting your plan…"
                        : "Review my plan →"}
                    </button>
                  </div>
                </form>
              ) : (
                <DraftReview
                  draft={draft}
                  editableTitle={editableTitle}
                  setEditableTitle={setEditableTitle}
                  sectionName={sectionName}
                  setSectionName={setSectionName}
                  loading={loading}
                  error={error}
                  onConfirm={() => void submitSelfStudy(draft, editableTitle)}
                  onEditAnswer={() => {
                    setDraft(null);
                    setEditableTitle("");
                    setError(null);
                  }}
                />
              )}
            </div>
          )}

        </div>
      </main>
    </>
  );
}
