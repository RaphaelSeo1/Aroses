import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AppHeader,
  HEADER_NAV_NEUTRAL,
  HEADER_NAV_PRIMARY,
} from "@/components/AppHeader";
import { ExploreCourseOutline } from "@/components/ExploreCourseOutline";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { APP_NAME } from "@/lib/brand";
import { exploreOutlineFromRpcPayload } from "@/lib/explore-course-outline";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Props = {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ view?: string }>;
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

export default async function ExploreCoursePage({ params, searchParams }: Props) {
  const { courseId } = await params;
  const { view } = await searchParams;
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
  /** Same page without owner-only banner & edit — mirrors a visitor’s experience. */
  const previewAsVisitor = view === "public";
  const showOwnerChrome = isOwner && !previewAsVisitor;

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedIn />
          ) : (
            <>
              <Link href="/login" className={HEADER_NAV_NEUTRAL}>
                Log in
              </Link>
              <Link href="/signup" className={HEADER_NAV_PRIMARY}>
                Sign up
              </Link>
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

          <ExploreCourseOutline groups={outlineGroups} />

          {outlineGroups.length === 0 && !outlineError ? (
            <p className="mt-10 text-sm text-zinc-500 dark:text-zinc-400">
              When this course has generated lessons, module titles will appear
              here for visitors. Lesson text and quizzes always stay private on
              your dashboard until you share a study link.
            </p>
          ) : null}

          {outlineError ? (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
              Public course outline requires migration{" "}
              <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                009_explore_course_outline.sql
              </code>{" "}
              in Supabase. Until then, only the title and description show on
              Explore.
            </p>
          ) : null}

          {previewAsVisitor && isOwner ? (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/90 px-4 py-3 text-sm text-zinc-700 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-200">
              <span>Previewing how visitors see this listing.</span>
              <Link
                href={`/explore/${course.id}`}
                className="font-semibold text-brand hover:underline dark:text-brand-soft"
              >
                Exit preview
              </Link>
            </div>
          ) : null}

          {showOwnerChrome ? (
            <p className="mt-8 rounded-xl border border-brand-border bg-brand-blush/80 px-4 py-3 text-sm text-brand-ink dark:border-brand-border/40 dark:bg-brand-blush/8 dark:text-brand-blush">
              You&apos;re viewing your public Explore listing. Visitors see your
              title, description, and{" "}
              <span className="font-medium">module titles only</span> — not lesson
              content or quizzes. Share study links from your dashboard for full
              access.
            </p>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            {user ? (
              <>
                <Link
                  href="/dashboard/courses/new"
                  className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-red-600/20 hover:bg-brand-hover dark:bg-brand"
                >
                  Create your own course
                </Link>
                {showOwnerChrome ? (
                  <>
                    <Link
                      href={`/dashboard/courses/${course.id}`}
                      className="inline-flex rounded-full border border-zinc-300 px-6 py-3 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    >
                      Edit in dashboard
                    </Link>
                    <Link
                      href={`/explore/${course.id}?view=public`}
                      className="inline-flex rounded-full border border-brand-border bg-white px-6 py-3 text-sm font-semibold text-brand-ink hover:bg-brand-blush dark:border-brand-border/50 dark:bg-[#1e1616]/60 dark:text-brand-blush dark:hover:bg-[#1e1616]"
                    >
                      View as visitor
                    </Link>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Link
                  href="/signup"
                  className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover dark:bg-brand"
                >
                  Sign up to create yours
                </Link>
                <Link
                  href="/login"
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
