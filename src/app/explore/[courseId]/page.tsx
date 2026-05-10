import Link from "next/link";
import { notFound } from "next/navigation";
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
            className="text-sm font-medium text-brand hover:underline dark:text-brand-soft"
          >
            ← All listings
          </Link>
          <p className="mt-6 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Community course
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {course.title}
          </h1>
          <p className="mt-3 text-xs text-zinc-500">
            Listed{" "}
            {new Date(course.created_at).toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
          {course.description ? (
            <p className="mt-8 whitespace-pre-wrap leading-relaxed text-zinc-700 dark:text-zinc-300">
              {course.description}
            </p>
          ) : (
            <p className="mt-8 text-sm italic text-zinc-500">
              No description provided.
            </p>
          )}

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

          <div className="mt-10">
            <Link
              href={studyHref}
              className="inline-flex w-full items-center justify-center rounded-full bg-brand px-8 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover sm:w-auto dark:bg-brand dark:hover:bg-brand-soft"
            >
              Start learning
            </Link>
          </div>

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
