import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { ExploreCoursesBoard } from "@/components/ExploreCoursesBoard";
import { ExploreListBodySkeleton } from "@/components/MainRouteSkeleton";
import { HeaderNavLink } from "@/components/HeaderNavLink";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { getT } from "@/lib/i18n/server";
import { fetchExploreCatalog } from "@/lib/marketplace/fetch-explore-catalog";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export async function generateMetadata() {
  const t = await getT();
  const marketplaceEnabled = isMarketplaceUiEnabled();
  return {
    title: `${t.nav.explore} — ${APP_NAME}`,
    description: marketplaceEnabled ? t.explore.descMarketplace : t.explore.descFree,
  };
}

export default async function ExplorePage() {
  const t = await getT();
  const { user } = await getServerAuth();

  return (
    <>
      <AppHeader
        right={
          user ? (
            <HeaderNavLoggedInServer />
          ) : (
            <>
              <HeaderNavLink href="/explore">{t.nav.explore}</HeaderNavLink>
              <HeaderNavLink href="/login">{t.nav.login}</HeaderNavLink>
              <HeaderNavLink href="/signup" variant="primary">
                {t.nav.signup}
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
  const t = await getT();
  const { supabase, user } = await getServerAuth();
  const marketplaceEnabled = isMarketplaceUiEnabled();
  const { courses, error: coursesError } = await fetchExploreCatalog(supabase);

  return (
    <main className="min-h-[calc(100vh-4rem)] flex-1 bg-app-gradient">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-14">
        <div data-tour="explore-heading">
          <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
            {t.explore.eyebrow}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            {t.explore.title}
          </h1>
          <p className="mt-3 max-w-2xl text-zinc-600 dark:text-zinc-400">
            {marketplaceEnabled ? t.explore.descMarketplace : t.explore.descFree}
          </p>
        </div>

        {coursesError ? (
          <p className="mt-12 text-sm text-red-600 dark:text-red-400">
            {t.explore.loadError}{" "}
            <code className="text-xs">057_course_listings.sql</code>{" "}
            {t.explore.loadErrorSuffix}
          </p>
        ) : courses.length === 0 ? (
          <div className="mx-auto mt-16 max-w-md rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center dark:border-zinc-800 dark:bg-zinc-950/90">
            <p className="font-medium text-zinc-900 dark:text-zinc-50">
              {t.explore.emptyTitle}
            </p>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {marketplaceEnabled
                ? t.explore.emptyDescMarketplace
                : t.explore.emptyDescFree}
            </p>
            <Link
              href={user ? "/" : "/signup"}
              className="mt-6 inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white hover:bg-brand-hover dark:bg-brand"
            >
              {user ? t.common.goToHome : t.common.getStarted}
            </Link>
          </div>
        ) : (
          <ExploreCoursesBoard
            courses={courses}
            currentUserId={user?.id}
            marketplaceEnabled={marketplaceEnabled}
          />
        )}
      </div>
    </main>
  );
}
