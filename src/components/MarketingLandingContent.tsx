import Link from "next/link";
import { BrandLogo } from "@/components/BrandLogo";
import { LegalFooterLinks } from "@/components/LegalFooterLinks";
import { ModuleMosaic } from "@/components/progress/ModuleMosaic";
import { ProgressRings } from "@/components/progress/ProgressRings";
import { APP_NAME } from "@/lib/brand";

function IconBook({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19.5A2.5 2.5 0 016.5 17H20"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7h6M12 11h6M12 15h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconSpark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M13 2L3 14h8l-2 8 10-12h-8l2-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function IconPath({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 19h16M5 19V9l5-4 5 4v10M9 19v-5h6v5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function HeroPreview() {
  /** Sample numbers only — matches Profile → Progress UI patterns (rings + mosaic). */
  const modulesCompleted = 8;
  const modulesTotal = 12;
  const modulePct = Math.round((modulesCompleted / modulesTotal) * 100);
  const quizAccuracy = 84;

  return (
    <div className="relative mx-auto w-full max-w-lg lg:mx-0 lg:max-w-none">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-20 top-1/2 h-72 w-72 -translate-y-1/2 rounded-full bg-brand-soft/25 blur-3xl dark:bg-brand-soft/15"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-brand/25 blur-3xl dark:bg-brand/25"
      />
      <div className="relative overflow-hidden rounded-[1.75rem] border border-zinc-200/90 bg-white/80 shadow-2xl shadow-red-950/10 ring-1 ring-zinc-900/5 backdrop-blur dark:border-zinc-700/80 dark:bg-zinc-950/80 dark:ring-white/10">
        <div className="border-b border-zinc-100 bg-gradient-to-r from-brand-blush/90 to-brand-blush/80 px-5 py-4 dark:border-zinc-800 dark:from-brand-blush/10 dark:to-brand-blush/8">
          <div className="flex items-center gap-3">
            <BrandLogo className="h-10 w-10 shadow-md shadow-red-600/30 ring-brand-border/40" />
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-brand dark:text-brand-soft">
                Course workspace
              </p>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Cell biology · sample snapshot
              </p>
            </div>
          </div>
        </div>
        <div className="space-y-6 p-5 sm:p-6">
          <div className="flex flex-col items-stretch gap-6 sm:flex-row sm:items-start">
            <div className="flex shrink-0 justify-center sm:pt-0.5">
              <ProgressRings
                ringId="land-hero"
                modulePct={modulePct}
                quizPct={quizAccuracy}
                quizLabelPlacement="below"
                size="sm"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  Module path
                </p>
                <p className="mt-1.5 text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {modulesCompleted} of {modulesTotal} checkpoints complete
                </p>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Sample course · 3 lesson units
                </p>
                <div className="mt-3">
                  <ModuleMosaic
                    completed={modulesCompleted}
                    total={modulesTotal}
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 border-t border-zinc-100 pt-5 dark:border-zinc-800">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Quiz accuracy
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-zinc-900 dark:text-zinc-50">
                    {quizAccuracy}%
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Attempts
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-zinc-900 dark:text-zinc-50">
                    24
                  </p>
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    Correct
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-brand dark:text-brand-soft">
                    20
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {["Lessons", "Module quizzes", "In-course help"].map((t) => (
              <span
                key={t}
                className="rounded-full border border-brand-border bg-brand-blush/90 px-3 py-1.5 text-xs font-medium text-brand-ink dark:border-brand-border/40 dark:bg-[#1e1616]/60 dark:text-brand-soft"
              >
                {t}
              </span>
            ))}
          </div>
          <p className="border-t border-zinc-100 pt-5 text-center text-xs leading-relaxed text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            Sample snapshot only.{" "}
            <Link
              href="/dashboard/profile?tab=progress"
              className="font-medium text-zinc-700 underline-offset-2 hover:underline dark:text-zinc-300"
            >
              Profile → Progress
            </Link>{" "}
            uses your real activity.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Full marketing story (hero, sections, footer) — wrapped by `/intro` with its own header. */
export function MarketingLandingContent({
  isAuthenticated = false,
}: {
  isAuthenticated?: boolean;
}) {
  const year = new Date().getFullYear();

  return (
    <main className="flex flex-1 flex-col bg-app-gradient">
        <section className="relative overflow-hidden">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-16 sm:gap-16 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
            <div>
              <p className="inline-flex items-center rounded-full border border-brand-border bg-white/80 px-4 py-1 text-xs font-semibold uppercase tracking-wider text-brand shadow-sm dark:border-brand-border/40 dark:bg-zinc-900/80 dark:text-brand-soft">
                Lessons, quizzes &amp; practice from your slides
              </p>
              <h1 className="mt-6 text-4xl font-semibold tracking-tight text-brand-ink sm:text-5xl sm:leading-[1.08] dark:text-white">
                Built for the classes that break you.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-muted dark:text-brand-soft">
                Upload your lecture slides and {APP_NAME} builds a full
                personalized course — lessons, quizzes, and practice questions
                from your actual material.{" "}
                <span className="font-medium text-brand-ink dark:text-zinc-100">
                  Not generic. Yours.
                </span>
              </p>
              <div className="mt-10 flex flex-wrap items-center gap-3">
                {isAuthenticated ? (
                  <>
                    <Link
                      href="/"
                      className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                    >
                      Go to workspace
                    </Link>
                    <Link
                      href="/explore"
                      className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white/80 px-8 py-3.5 text-sm font-semibold text-zinc-800 backdrop-blur hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Explore courses
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href="/signup"
                      className="inline-flex items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
                    >
                      Get started free
                    </Link>
                    <Link
                      href="/login"
                      className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white/80 px-8 py-3.5 text-sm font-semibold text-zinc-800 backdrop-blur hover:bg-white dark:border-zinc-700 dark:bg-zinc-950/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Log in
                    </Link>
                  </>
                )}
              </div>
              <ul className="mt-10 max-w-xl space-y-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>Module path and completion tracking</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>Per-module quizzes and wrong-answer review</span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>
                    Personal cards from your notes, with spaced repetition
                    (same idea as Anki)
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>Browse public courses on Explore</span>
                </li>
              </ul>
            </div>
            <HeroPreview />
          </div>
        </section>

        <section className="border-y border-zinc-200/70 bg-white/50 py-12 dark:border-zinc-800/80 dark:bg-zinc-950/40">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 sm:grid-cols-3 sm:gap-6 sm:px-6">
            {[
              {
                k: "Grounded",
                v: "Lessons follow your uploads — not the open internet.",
              },
              {
                k: "Structured",
                v: "Modules and checkpoints so the path never feels random.",
              },
              {
                k: "Measurable",
                v: "Quizzes, streaks, and cards from your highlights — spaced reviews when memory fades.",
              },
            ].map((s) => (
              <div
                key={s.k}
                className="text-center sm:text-left"
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                  {s.k}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {s.v}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Three steps. Your studio.
            </h2>
            <p className="mt-3 text-zinc-600 dark:text-zinc-400">
              Set up once: add your materials, work through modules, then quiz and
              revisit what stuck — all anchored to what you uploaded.
            </p>
          </div>
          <ol className="mx-auto mt-14 grid max-w-5xl gap-8 sm:grid-cols-3">
            {[
              {
                n: "01",
                title: "Shape your course",
                body: "Name it and describe what you’re chasing — midterm, licensure, or a tough unit.",
              },
              {
                n: "02",
                title: "Bring your lectures",
                body: "Drop the decks and notes you already rely on. We turn them into lessons and checkpoints.",
              },
              {
                n: "03",
                title: "Practice what you learned",
                body: "Module quizzes, wrong-answer review, and focus cards from your highlights — spaced repetition like Anki, without importing decks by hand.",
              },
            ].map((step) => (
              <li
                key={step.n}
                className="relative rounded-2xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90"
              >
                <span className="font-mono text-3xl font-semibold tabular-nums text-brand-soft dark:text-brand-ink">
                  {step.n}
                </span>
                <h3 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">
                  {step.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section className="border-t border-zinc-200/70 bg-gradient-to-b from-transparent to-brand-blush/40 py-20 dark:border-zinc-800 dark:to-brand-blush/10 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <h2 className="text-center text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Built for depth, not demos
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-center text-zinc-600 dark:text-zinc-400">
              Everything stays tied to your material — with room to grow into a
              real semester workflow.
            </p>

            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2">
              <div className="rounded-3xl border border-zinc-200/90 bg-white/95 p-6 shadow-lg shadow-zinc-900/5 sm:p-8 lg:row-span-2 dark:border-zinc-800 dark:bg-zinc-950/95">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blush text-brand dark:bg-[#1e1616]/80 dark:text-brand-soft">
                  <IconPath className="h-6 w-6" />
                </div>
                <h3 className="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                  Progress you can read at a glance
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  Rings for module progress and quiz accuracy, module tiles, and
                  a calendar of recent study — so “how am I doing?” has a clear
                  answer.
                </p>
                <Link
                  href={
                    isAuthenticated
                      ? "/dashboard/profile?tab=progress"
                      : "/signup"
                  }
                  className="mt-6 inline-flex text-sm font-semibold text-brand hover:underline dark:text-brand-soft"
                >
                  {isAuthenticated ? "Open Progress →" : "Start tracking →"}
                </Link>
              </div>

              {[
                {
                  title: "Structured like a real course",
                  body: "Modules and lessons that feel intentional — not a dump of notes.",
                  Icon: IconBook,
                },
                {
                  title: "Teach-first writing",
                  body: "Clear explanations and examples so you’re not decoding jargon alone.",
                  Icon: IconSpark,
                },
                {
                  title: "Retention you can feel",
                  body: "Turn highlights into your own multiple-choice cards; scheduling spreads reviews over days so you’re not re-reading the same slide forever — same core idea as Anki, tied to your course.",
                  Icon: IconTarget,
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="rounded-3xl border border-zinc-200/90 bg-white/90 p-6 shadow-sm transition hover:border-brand-border hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950/90 dark:hover:border-brand-border/50"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-blush text-brand dark:bg-[#1e1616]/80 dark:text-brand-soft">
                    <item.Icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-4 font-semibold text-zinc-900 dark:text-zinc-100">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {item.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-8 pt-4 sm:px-6">
          <div className="overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand-hover to-brand-hover px-8 py-12 text-center shadow-xl shadow-red-900/20 sm:px-12 sm:py-16">
            <h2 className="text-2xl font-semibold text-white sm:text-3xl">
              Browse what others are studying
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-white/95">
              Explore public courses — titles and outlines — when you want
              inspiration or a second angle on a topic.
            </p>
            <Link
              href="/explore"
              className="mt-8 inline-flex items-center justify-center rounded-full bg-white px-8 py-3.5 text-sm font-semibold text-brand shadow-lg transition hover:bg-brand-blush"
            >
              Open Explore
            </Link>
          </div>
        </section>

        <footer className="mt-16 border-t border-zinc-200/80 bg-white/40 px-4 py-12 dark:border-zinc-800 dark:bg-zinc-950/50 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col items-center gap-10">
            <div className="flex w-full flex-col items-center justify-between gap-8 sm:flex-row sm:items-start">
              <div className="flex items-center gap-3">
                <BrandLogo className="h-9 w-9 sm:h-10 sm:w-10" />
                <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                  © {year} {APP_NAME}
                </p>
              </div>
              <nav
                className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm font-medium text-zinc-700 dark:text-zinc-300 sm:justify-end"
                aria-label="Site"
              >
                <Link href="/explore" className="hover:text-brand dark:hover:text-brand-soft">
                  Explore
                </Link>
                {isAuthenticated ? (
                  <>
                    <Link href="/" className="hover:text-brand dark:hover:text-brand-soft">
                      Workspace
                    </Link>
                    <Link
                      href="/dashboard/profile"
                      className="hover:text-brand dark:hover:text-brand-soft"
                    >
                      Profile
                    </Link>
                  </>
                ) : (
                  <>
                    <Link href="/login" className="hover:text-brand dark:hover:text-brand-soft">
                      Log in
                    </Link>
                    <Link href="/signup" className="hover:text-brand dark:hover:text-brand-soft">
                      Sign up
                    </Link>
                  </>
                )}
              </nav>
            </div>
            <div className="w-full max-w-xl border-t border-zinc-200/70 pt-8 dark:border-zinc-800">
              <LegalFooterLinks className="text-xs text-zinc-500 sm:text-sm dark:text-zinc-500" />
            </div>
          </div>
        </footer>
    </main>
  );
}
