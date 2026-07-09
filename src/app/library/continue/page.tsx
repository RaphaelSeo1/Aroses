import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { ContinueStudyingCarousel } from "@/components/ContinueStudyingCarousel";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { LibraryPageHeader } from "@/components/LibraryPageHeader";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import { getT } from "@/lib/i18n/server";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const dynamic = "force-dynamic";

export default async function LibraryContinuePage() {
  const t = await getT();
  const { supabase, user } = await getServerAuth();

  if (!user?.id) {
    redirect("/login?next=/library/continue");
  }

  if (await profileNeedsOnboarding(supabase, user.id)) {
    redirect("/onboarding");
  }

  const progress = await loadDashboardProgress(supabase, user.id);
  const entries = progress.recentPractice ?? [];
  const empty = entries.length === 0;

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <LibraryPageHeader
            backLabel={t.dashboard.backToHome}
            eyebrow={t.dashboard.libraryEyebrow}
            title={t.dashboard.continueStudying}
            description={t.dashboard.hubStudyingHint}
          />

          {empty ? (
            <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-10 text-center dark:border-zinc-600 dark:bg-zinc-950/40">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t.dashboard.nothingHereYet}
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t.dashboard.nothingHereYetDesc}
              </p>
              <Link
                href="/explore"
                className="mt-6 inline-flex rounded-full border border-zinc-300 px-6 py-2.5 text-sm font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                {t.dashboard.browseExplore}
              </Link>
            </div>
          ) : (
            <div className="mt-6">
              <ContinueStudyingCarousel entries={entries} hideViewAll />
            </div>
          )}
        </div>
      </main>
    </>
  );
}
