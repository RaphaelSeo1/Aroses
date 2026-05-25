import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ExploreCoursesBoard } from "@/components/ExploreCoursesBoard";
import { ExploreListBodySkeleton } from "@/components/MainRouteSkeleton";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const metadata = {
  title: `Explore — ${APP_NAME}`,
  description:
    "Browse community-shared courses: titles and descriptions from other learners.",
};

export default async function ExplorePage() {
  const { user } = await getServerAuth();

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedInServer />
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
      <Suspense fallback={<ExploreListBodySkeleton />}>
        <ExploreCoursesSection />
      </Suspense>
    </>
  );
}

async function ExploreCoursesSection() {
  const { supabase, user } = await getServerAuth();
  const { data: courses, error: coursesError } = await supabase
    .from("courses")
    .select("id, title, description, created_at, user_id")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(200);

  const exploreBroken = Boolean(
    coursesError &&
      (coursesError.code === "42703" ||
        /is_public|schema cache/i.test(coursesError.message ?? ""))
  );

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
          Community
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Explore courses
        </h1>
        <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
          Courses appear here when a creator turns on{" "}
          <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
            Show this course on Explore
          </strong>
          . Sign in to open a course and study lessons and quizzes (your account
          keeps progress across devices).
        </p>

        {exploreBroken ? (
          <div className="mx-auto mt-12 max-w-lg rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-medium">Explore needs a quick database update</p>
            <p className="mt-2 text-amber-900/90 dark:text-amber-100/90">
              Run{" "}
              <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                supabase/migrations/007_public_courses.sql
              </code>{" "}
              in the Supabase SQL Editor (adds{" "}
              <code className="rounded bg-amber-100/80 px-1.5 py-0.5 text-xs dark:bg-amber-900/60">
                is_public
              </code>{" "}
              and read access for public listings). Then reload this page.
            </p>
          </div>
        ) : coursesError ? (
          <p className="mt-12 text-sm text-red-600 dark:text-red-400">
            Could not load listings. Try again in a moment.
          </p>
        ) : !courses || courses.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              Nothing listed yet
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Each course is private until you enable it: open{" "}
              <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                Home
              </strong>
              , choose a course, then check{" "}
              <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
                Show this course on Explore
              </strong>{" "}
              under Public Explore listing.
            </p>
            <Link
              href={user ? "/" : "/signup"}
              className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover dark:bg-brand"
            >
              {user ? "Go to Home" : "Get started"}
            </Link>
          </div>
        ) : (
          <ExploreCoursesBoard courses={courses} currentUserId={user?.id} />
        )}
      </div>
    </main>
  );
}
