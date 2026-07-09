import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { LibraryPageHeader } from "@/components/LibraryPageHeader";
import { getT } from "@/lib/i18n/server";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const dynamic = "force-dynamic";

export default async function LibrarySharedPage() {
  const t = await getT();
  const { supabase, user } = await getServerAuth();

  if (!user?.id) {
    redirect("/login?next=/library/shared");
  }

  if (await profileNeedsOnboarding(supabase, user.id)) {
    redirect("/onboarding");
  }

  const { sharedWithMe } = await loadDashboardCourseLists(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <LibraryPageHeader
            backLabel={t.dashboard.backToHome}
            eyebrow={t.dashboard.libraryEyebrow}
            title={t.dashboard.sharedWithYou}
            description={t.dashboard.sharedWithYouDesc}
          />

          {sharedWithMe.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-10 text-center dark:border-zinc-600 dark:bg-zinc-950/40">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t.dashboard.hubSharedEmpty}
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t.dashboard.hubSharedEmptyDesc}
              </p>
            </div>
          ) : (
            <ul className="mt-10 grid gap-3 sm:grid-cols-2">
              {sharedWithMe.map((course) => (
                <li key={course.id}>
                  <Link
                    href={`/dashboard/courses/${course.id}`}
                    className="block rounded-2xl border border-zinc-200/90 bg-white p-4 shadow-sm transition hover:border-indigo-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-indigo-900/50"
                  >
                    <p className="font-semibold text-zinc-900 dark:text-zinc-50">
                      {course.title}
                    </p>
                    {course.description ? (
                      <p className="mt-1 line-clamp-2 text-sm text-zinc-500 dark:text-zinc-400">
                        {course.description}
                      </p>
                    ) : null}
                    <p className="mt-3 text-xs font-medium uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                      {course.role}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </>
  );
}
