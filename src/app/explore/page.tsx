import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ExploreCoursesBoard } from "@/components/ExploreCoursesBoard";
import { ExploreListBodySkeleton } from "@/components/MainRouteSkeleton";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { fetchExploreCatalog } from "@/lib/marketplace/fetch-explore-catalog";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const metadata = {
  title: `Explore — ${APP_NAME}`,
  description:
    "Browse free community courses and student-created courses for sale.",
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
  const { courses, error: coursesError } = await fetchExploreCatalog(supabase);

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
          Browse free community courses or student-created courses listed for
          sale. Paid courses unlock full lessons after Stripe checkout.
        </p>

        {coursesError ? (
          <p className="mt-12 text-sm text-red-600 dark:text-red-400">
            Could not load listings. Apply migration{" "}
            <code className="text-xs">057_course_listings.sql</code> if needed.
          </p>
        ) : courses.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              Nothing listed yet
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              Creators can share courses for free or list originals for sale
              from their course dashboard.
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
