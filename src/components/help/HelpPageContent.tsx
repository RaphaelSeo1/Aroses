"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { HELP_VIDEOS } from "@/lib/help-videos";
import { HonestFaqSection } from "@/components/help/HonestFaqSection";
import {
  CourseCardPreview,
  HelpPreviewFrame,
  ModeTogglePreview,
  NavPreview,
  PracticeRoomPreview,
  SrsRatingPreview,
  TutorModesPreview,
  UploadLectureStacksPreview,
  VisibilitySwitchPreview,
  VoiceModesPreview,
  WorkspacePreview,
} from "@/components/help/HelpUiPreviews";

const SECTIONS = [
  { id: "quick-start", label: "Quick start" },
  { id: "videos", label: "Video walkthroughs" },
  { id: "getting-started", label: "Getting started" },
  { id: "building", label: "Building a course" },
  { id: "mentored", label: "Mentored Learning" },
  { id: "free-explore", label: "Free Exploration" },
  { id: "quizzes", label: "Quizzes & practice" },
  { id: "review", label: "Spaced repetition" },
  { id: "tutor", label: "Tutor sessions" },
  { id: "explore", label: "Explore" },
  { id: "sharing", label: "Sharing" },
  { id: "progress", label: "Progress & profile" },
  { id: "faq", label: "Honest FAQ" },
] as const;

function VideoGrid() {
  return (
    <div className="not-prose grid gap-4 sm:grid-cols-2">
      {HELP_VIDEOS.map((v) => (
        <div
          key={v.id}
          className="overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950"
        >
          {v.embedUrl ? (
            <div className="aspect-video w-full bg-zinc-900">
              <iframe
                src={v.embedUrl}
                title={v.title}
                className="h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
          ) : (
            <div className="flex aspect-video flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-100 to-zinc-200/80 px-6 text-center dark:from-zinc-900 dark:to-zinc-950">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 shadow-md dark:bg-zinc-800">
                <svg
                  className="h-6 w-6 text-brand"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Video coming soon
              </p>
              {v.durationLabel ? (
                <p className="text-[11px] text-zinc-400">{v.durationLabel}</p>
              ) : null}
            </div>
          )}
          <div className="p-4">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {v.title}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              {v.description}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function HelpPageContent() {
  const [activeId, setActiveId] = useState<string>("quick-start");

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setActiveId(e.target.id);
            break;
          }
        }
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) obs.observe(el);
    }
    return () => obs.disconnect();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10 lg:gap-12">
      <nav
        aria-label="Help sections"
        className="sticky top-24 hidden max-h-[calc(100vh-7rem)] w-52 shrink-0 overflow-y-auto lg:block"
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
          On this page
        </p>
        <ul className="mt-3 space-y-1 border-l border-zinc-200 dark:border-zinc-800">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className={[
                  "-ml-px block border-l-2 py-1.5 pl-3 text-sm transition",
                  activeId === s.id
                    ? "border-brand font-semibold text-brand dark:border-brand-soft dark:text-brand-soft"
                    : "border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200",
                ].join(" ")}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 flex-1">
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          Aroses turns your course material into structured lessons, a voice
          tutor that knows your content, quizzes, and spaced-repetition review.
          This guide matches the app as it works today — with screenshots-style
          previews of the actual UI.
        </p>

        {/* ── Quick start ── */}
        <section id="quick-start" className="mt-12 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Quick start (60 seconds)
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            <li>
              <strong>Sign up</strong> with email or Google and finish onboarding
              (goals, persona, username, birth date).
            </li>
            <li>
              <strong>Upload material</strong> — PDF, slides, notes, images, or
              audio/video — from your{" "}
              <Link href="/">workspace</Link> or a course page.
            </li>
            <li>
              <strong>Watch the build</strong> — live progress as Aroses generates
              your outline and modules.
            </li>
            <li>
              <strong>Pick how you learn:</strong>{" "}
              <Link href="#mentored">Mentored Learning</Link> (Rose tutors you by
              voice) or{" "}
              <Link href="#free-explore">Free Exploration</Link> (read at your
              pace).
            </li>
            <li>
              <strong>Practice &amp; review</strong> — quizzes, then{" "}
              <Link href="/dashboard/review">spaced-repetition cards</Link> so
              material sticks.
            </li>
          </ol>
          <p className="mt-4 text-sm font-medium text-zinc-800 dark:text-zinc-200">
            The loop: Upload → Build → Learn → Practice → Review.
          </p>

          <HelpPreviewFrame
            title="Home workspace"
            caption="After login, / is your hub — create courses, resume studying, and see review due counts."
          >
            <WorkspacePreview />
          </HelpPreviewFrame>
        </section>

        {/* ── Videos ── */}
        <section id="videos" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Video walkthroughs
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Full screen recordings are on the way. Until they&apos;re live, use
            the step-by-step sections below — each includes UI previews of what
            you&apos;ll see on screen. When videos are ready, they&apos;ll appear
            here automatically.
          </p>
          <div className="mt-6">
            <VideoGrid />
          </div>
        </section>

        {/* ── Getting started ── */}
        <section id="getting-started" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            1. Getting started
          </h2>

          <h3 className="mt-6 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Signing up &amp; onboarding
          </h3>
          <p className="mt-2 text-sm leading-relaxed">
            Create an account with email or Google. Onboarding walks you through:
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Persona</strong> — Student, Educator, Professional, or
              Self-learner
            </li>
            <li>
              <strong>Goals</strong> — multi-select reasons you&apos;re here
            </li>
            <li>
              <strong>School</strong> — students &amp; educators only (optional
              name with suggestions)
            </li>
            <li>
              <strong>Username</strong> — checked for availability live
            </li>
            <li>
              <strong>Date of birth</strong> — must be 13+
            </li>
            <li>
              <strong>How did you hear about us?</strong>
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Navigation
          </h3>
          <p className="mt-2 text-sm leading-relaxed">
            The top bar on every signed-in page:
          </p>
          <HelpPreviewFrame title="Primary navigation" caption="Review shows a badge when cards are due today.">
            <NavPreview />
          </HelpPreviewFrame>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Home</strong> — workspace with your courses, continue
              studying, streak, and review banner
            </li>
            <li>
              <strong>Tutor</strong> — start a standalone session or open past
              sessions
            </li>
            <li>
              <strong>Explore</strong> — community courses (sign-in required)
            </li>
            <li>
              <strong>Review</strong> — global spaced-repetition hub
            </li>
            <li>
              <strong>Profile</strong> — settings, theme, progress
            </li>
          </ul>
        </section>

        {/* ── Building ── */}
        <section id="building" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            2. Building a course
          </h2>

          <h3 className="mt-6 text-base font-semibold">Two ways to create</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Public course</strong> — structured course with sections;
              optionally list on Explore when you&apos;re ready (
              <Link href="/dashboard/courses/new?mode=public">create</Link>)
            </li>
            <li>
              <strong>Self Study</strong> — private; Rose drafts a plan from
              your goal, you confirm, then upload (
              <Link href="/dashboard/courses/new?mode=selfStudy">create</Link>)
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold">Upload &amp; formats</h3>
          <p className="mt-2 text-sm leading-relaxed">
            PDF, Word, PowerPoint, plain text, Markdown, RTF, images, audio, and
            video. Limits: <strong>20 files</strong> per batch,{" "}
            <strong>1 GB</strong> combined; 100 MB PDFs, 50 MB other documents,
            100 MB audio, 500 MB video, 20 MB images. Audio/video is transcribed
            (25 MB cap for transcription).
          </p>

          <HelpPreviewFrame
            title="Lecture grouping on upload"
            caption="Related files (notes + screenshots + transcript) can be combined into one lecture. Drag files onto a lecture card or use Combine into one."
          >
            <UploadLectureStacksPreview />
          </HelpPreviewFrame>

          <h3 className="mt-6 text-base font-semibold">Build flow</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            <li>Upload files (optional per-upload study goal + polish)</li>
            <li>
              <strong>Build theater</strong> — live outline and module progress
              for each job
            </li>
            <li>
              For audio/video: <strong>review the transcript</strong> before
              generation continues
            </li>
            <li>
              Open the course — edit lessons, images, append quiz questions
            </li>
          </ol>

          <h3 className="mt-6 text-base font-semibold">Managing your course</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Sections</strong> — create, rename, reorder; drag materials
              within a section
            </li>
            <li>
              <strong>Edit course</strong> — opens study view in manage mode
            </li>
            <li>
              <strong>Refine with Rose</strong> — plain-language AI edits to
              structure or content
            </li>
            <li>
              <strong>Lesson images</strong> — auto Wikimedia images; replace,
              remove, or upload your own in edit mode
            </li>
            <li>
              Images embedded in PDFs/Word/slides are pulled into lessons
              automatically
            </li>
            <li>
              Failed uploads show a warning with <strong>Restart</strong>
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold">Public vs private</h3>
          <p className="mt-2 text-sm leading-relaxed">
            From your home grid, use <strong>Make public</strong> /{" "}
            <strong>Make private</strong> on any course card. Inside a course,
            use the toggle switch:
          </p>
          <HelpPreviewFrame
            title="Public Explore listing toggle"
            caption="Explore only shows your course title and description — not your raw files. Sign-in is required to browse Explore."
          >
            <VisibilitySwitchPreview on={false} />
          </HelpPreviewFrame>
          <HelpPreviewFrame title="Course card actions">
            <CourseCardPreview listed={false} />
          </HelpPreviewFrame>
        </section>

        {/* ── Mentored ── */}
        <section id="mentored" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            3. Mentored Learning
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Rose walks you through your course chunk by chunk — explain, check
            question, then advance. Best when you want to be <em>taught</em>, not
            just read.
          </p>

          <HelpPreviewFrame title="Mode picker (when you open Learn)">
            <ModeTogglePreview />
          </HelpPreviewFrame>

          <h3 className="mt-6 text-base font-semibold">Per-course onboarding</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>Goals Q&amp;A + quick knowledge quiz</li>
            <li>
              <strong>Personalized course</strong> (reordered) vs{" "}
              <strong>Original outline</strong>
            </li>
            <li>
              <strong>Voice-first</strong> vs <strong>Text-first</strong>
            </li>
            <li>
              Or <strong>Skip the tutor — let me just read</strong> → Free
              Exploration
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold">During a lesson</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              Rose explains each chunk, then checks understanding — question in
              the dialogue strip (text) or a popup you can minimize (voice)
            </li>
            <li>
              <strong>Source panel</strong> — your original material alongside
              tutoring
            </li>
            <li>
              <strong>Notes panel</strong> — auto-generate, slash{" "}
              <kbd className="rounded bg-zinc-100 px-1 font-mono text-xs dark:bg-zinc-800">
                /
              </kbd>{" "}
              commands, rich formatting
            </li>
            <li>
              On-image lookups from Wikimedia when helpful
            </li>
            <li>
              <strong>Welcome back</strong> screen if you&apos;ve been away 5+
              minutes — Rose resumes where you stopped
            </li>
          </ul>

          <HelpPreviewFrame
            title="Voice input modes"
            caption="Switch between Hold M and Live in the composer. Adjust playback speed (0.5×–1.5×)."
          >
            <VoiceModesPreview />
          </HelpPreviewFrame>
        </section>

        {/* ── Free explore ── */}
        <section id="free-explore" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            4. Free Exploration
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Read at your own pace with Rose available on demand. Switch modes
            anytime with the course mode toggle.
          </p>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Sidebar curriculum</strong> — modules, lessons, progress;
              scroll position saved
            </li>
            <li>
              <strong>Highlights</strong> — select text in Pink, Yellow, Blue,
              Green, or Purple; capture quotes to notes
            </li>
            <li>
              <strong>Personal quiz</strong> — turn notes/highlights into focus
              cards
            </li>
            <li>
              <strong>Media panel</strong> — synced transcript for uploaded
              audio/video
            </li>
            <li>
              <strong>Ask Rose!</strong> — text study chat about the current
              module
            </li>
            <li>
              <strong>Voice dock</strong> — hold M or Live; language &amp; speed
              controls; Rose can navigate by voice (&quot;take me to the section
              on…&quot;)
            </li>
            <li>
              <strong>Refine with Rose</strong> — edit course content from the
              study view (owners)
            </li>
            <li>
              <strong>Practice progress</strong> pull-tab — scores at a glance
            </li>
          </ul>
        </section>

        {/* ── Quizzes ── */}
        <section id="quizzes" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            5. Quizzes &amp; practice
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            From any lecture, tap <strong>Go to practice room</strong> — then
            pick a tab:
          </p>

          <HelpPreviewFrame title="Practice room tabs">
            <PracticeRoomPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Module quiz</strong> — MCQ + free response, AI-graded;
              <strong> Practice again</strong> when done; can mark module complete
            </li>
            <li>
              <strong>Focus quiz</strong> — your personal note cards (always
              practices all saved cards)
            </li>
            <li>
              <strong>Whole-course mixed quiz</strong> — separate link in the
              sidebar (not a third practice tab)
            </li>
            <li>
              Owners can <strong>generate</strong> more module quiz questions
            </li>
          </ul>
        </section>

        {/* ── Review ── */}
        <section id="review" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            6. Spaced repetition (Review)
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Flashcards resurface right before you&apos;d forget — module quiz
            misses and personal focus cards feed the same pipeline. Open{" "}
            <Link href="/dashboard/review">Review</Link> from the nav or the home
            banner (dismissible until tomorrow).
          </p>

          <HelpPreviewFrame
            title="Rating buttons after you reveal an answer"
            caption="Keyboard: Space/Enter to reveal, 1–4 to rate."
          >
            <SrsRatingPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <strong>Review All</strong> or pick specific courses/materials
            </li>
            <li>
              Scope: <strong>Both</strong>, <strong>Module only</strong>, or{" "}
              <strong>Focus only</strong>
            </li>
            <li>
              Settings: daily new-card limit, max reviews, daily goal, reset all
              SRS data
            </li>
            <li>Pause / exit mid-session — resume later from browser storage</li>
          </ul>
        </section>

        {/* ── Tutor ── */}
        <section id="tutor" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            7. Standalone tutor sessions
          </h2>
          <p className="mt-3 text-sm leading-relaxed">
            Open-ended help — not tied to a course. Start from{" "}
            <Link href="/tutor-session">Tutor</Link> or home. Past sessions live
            at <Link href="/sessions">/sessions</Link>.
          </p>

          <HelpPreviewFrame title="Session modes at start">
            <TutorModesPreview />
          </HelpPreviewFrame>

          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              Optional topic; up to <strong>20 files</strong>, 200 MB combined
              (PDF, Word, slides, images, text — not audio/video)
            </li>
            <li>Paste screenshots from clipboard; add files mid-session</li>
            <li>
              <strong>Skip and just start talking</strong> — no setup required
            </li>
            <li>
              Live Notion-style notes (synthesized, not raw transcript)
            </li>
            <li>
              Voice: Hold M or Live; text input anytime
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold">Inactivity timeline</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              ~<strong>5 min</strong> silence → Rose sends a gentle check-in
            </li>
            <li>
              ~<strong>15 min</strong> → final check-in, session <strong>paused</strong>
            </li>
            <li>
              ~<strong>60 min</strong> total silence → session auto-ends
            </li>
          </ul>

          <h3 className="mt-6 text-base font-semibold">After the session</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              Recap: edit, copy, download .md, print/PDF, share public link,
              regenerate, delete
            </li>
            <li>
              <strong>Build a structured course from this session</strong>
            </li>
          </ul>
        </section>

        {/* ── Explore ── */}
        <section id="explore" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            8. Explore (community courses)
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <Link href="/explore">Explore</Link> requires sign-in — browse
              filters: All, Featured, Popular, Rated
            </li>
            <li>Preview outline before starting; full learn/study/quiz/review experience</li>
            <li>Your progress is tracked per account</li>
            <li>
              Creators: toggle <strong>Make public</strong> — only title +
              description appear on Explore until someone opens the course
            </li>
          </ul>
        </section>

        {/* ── Sharing ── */}
        <section id="sharing" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            9. Sharing
          </h2>
          <div className="not-prose mt-4 overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="py-2 pr-4 font-semibold text-zinc-900 dark:text-zinc-100">
                    What you share
                  </th>
                  <th className="py-2 font-semibold text-zinc-900 dark:text-zinc-100">
                    What others see
                  </th>
                </tr>
              </thead>
              <tbody className="text-zinc-700 dark:text-zinc-300">
                <tr className="border-b border-zinc-100 dark:border-zinc-800/80">
                  <td className="py-3 pr-4">Explore listing (public course)</td>
                  <td className="py-3">
                    Title + description on Explore; sign in to study
                  </td>
                </tr>
                <tr className="border-b border-zinc-100 dark:border-zinc-800/80">
                  <td className="py-3 pr-4">Share study link (from course page)</td>
                  <td className="py-3">
                    Read-only lessons + quizzes; sign-up CTA for anonymous viewers
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4">Session recap link</td>
                  <td className="py-3">Recap markdown only — no transcript or uploads</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Progress ── */}
        <section id="progress" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            10. Progress &amp; profile
          </h2>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <Link href="/dashboard/profile">Profile</Link> — General
              (name, username, avatar, theme, study focus), Account, Progress tab
            </li>
            <li>Progress rings — modules completed &amp; quiz accuracy per course</li>
            <li>Activity heatmap — last two weeks of study</li>
            <li>
              <strong>Resume everywhere</strong> — module, lesson, scroll, mode,
              mentored chunk, even a paused tutor session
            </li>
            <li>Home streak grid — 7-day activity</li>
          </ul>
        </section>

        <HonestFaqSection />
      </article>
    </div>
  );
}
