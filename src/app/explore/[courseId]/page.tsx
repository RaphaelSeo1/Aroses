import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ExploreCourseOutline } from "@/components/ExploreCourseOutline";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { APP_NAME } from "@/lib/brand";
import { exploreOutlineFromRpcPayload } from "@/lib/explore-course-outline";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { courseId } = await params;
  if (!UUID_RE.test(courseId)) return { title: `Course — ${APP_NAME}` };

  const supabase = await createClient();
  const { data: course } = await supabase
    .from("courses")
    .select("title")
    .eq("id", courseId)
    .eq("is_public", true)
    .maybeSingle();

  if (!course) return { title: `Explore — ${APP_NAME}` };
  return { title: `${course.title} — Explore — ${APP_NAME}` };
}

export default async function ExploreCoursePage({ params }: Props) {
  const { courseId } = await params;
  if (!UUID_RE.test(courseId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/explore/${courseId}`)}`);
  }

  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, created_at, user_id")
    .eq("id", courseId)
    .eq("is_public", true)
    .maybeSingle();

  if (!course) notFound();

  const { data: outlineRaw, error: outlineError } = await supabase.rpc(
    "explore_course_outline",
    { p_course_id: courseId }
  );
  const outlineGroups = outlineError
    ? []
    : exploreOutlineFromRpcPayload(outlineRaw);

  const isOwner = Boolean(user && user.id === course.user_id);
  const studyHref = `/explore/${course.id}/study`;

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedIn />
          ) : (
            <>
              <HeaderNavLink href="/explore">Explore</HeaderNavLink>
              <HeaderNavLink href="/login">Log in</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                Sign up
              </HeaderNavLink>
            </>
          )
        }
      />
      <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
        <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
          <Link
            href="/explore"
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand transition hover:gap-2 dark:text-brand-soft"
          >
            <span aria-hidden>←</span> All listings
          </Link>

          <div className="relative mt-8 overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/80 p-6 shadow-xl shadow-zinc-900/[0.06] ring-1 ring-white/70 backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-950/75 dark:shadow-black/25 dark:ring-zinc-600/40 sm:p-8">
            <div
              className="pointer-events-none absolute -left-20 top-0 h-48 w-48 rounded-full bg-gradient-to-br from-brand/12 to-transparent blur-3xl dark:from-brand/20"
              aria-hidden
            />
            <div className="relative">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
                Community course
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                {course.title}
              </h1>
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200/90 bg-zinc-50/90 px-2.5 py-0.5 font-medium text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300">
                  Listed{" "}
                  {new Date(course.created_at).toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              </p>
              {course.description ? (
                <p className="mt-6 whitespace-pre-wrap border-t border-zinc-100 pt-6 text-base leading-relaxed text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {course.description}
                </p>
              ) : (
                <p className="mt-6 border-t border-zinc-100 pt-6 text-sm italic text-zinc-500 dark:border-zinc-800">
                  No description provided.
                </p>
              )}
            </div>
          </div>

          <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center">
            <Link
              href={studyHref}
              className="inline-flex w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/30 ring-2 ring-white/25 transition hover:bg-brand-hover hover:shadow-xl hover:shadow-red-600/35 sm:w-auto dark:bg-brand dark:ring-white/10 dark:hover:bg-brand-soft"
            >
              Start learning
            </Link>
            <p className="max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Full lessons, diagrams where available, and quizzes — opens in study mode.
            </p>
          </div>

          {outlineError ? (
            <p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Public course outline requires migration{" "}
              <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                009_explore_course_outline.sql
              </code>{" "}
              in Supabase. Until then, only the title and description show on
              Explore.
            </p>
          ) : null}

          <ExploreCourseOutline groups={outlineGroups} />

          {outlineGroups.length === 0 && !outlineError ? (
            <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
              When this course has generated lessons, a{" "}
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                Course structure
              </strong>{" "}
              outline will show here. Use{" "}
              <strong className="font-medium text-zinc-700 dark:text-zinc-300">
                Start learning
              </strong>{" "}
              whenever you&apos;re ready for full lessons and quizzes.
            </p>
          ) : null}

          {isOwner ? (
            <p className="mt-10 rounded-xl border border-brand-border bg-brand-blush/80 px-4 py-3 text-sm text-brand-ink dark:border-brand-border/40 dark:bg-brand-blush/8 dark:text-brand-blush">
              This is your Explore listing. Learners use{" "}
              <span className="font-medium">Start learning</span> for full content.
              Edit uploads and structure from your dashboard.
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {user ? (
              <>
                <Link
                  href="/dashboard/courses/new"
                  className="inline-flex rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Create your own course
                </Link>
                {isOwner ? (
                  <Link
                    href={`/dashboard/courses/${course.id}`}
                    className="inline-flex rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                  >
                    Edit in dashboard
                  </Link>
                ) : null}
              </>
            ) : (
              <>
                <Link
                  href={`/signup?next=${encodeURIComponent(studyHref)}`}
                  className="inline-flex rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Sign up (save progress)
                </Link>
                <Link
                  href={`/login?next=${encodeURIComponent(studyHref)}`}
                  className="inline-flex rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                >
                  Log in
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
