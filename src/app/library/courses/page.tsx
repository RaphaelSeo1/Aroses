import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CourseDashboardList } from "@/components/CourseDashboardList";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { LibraryPageHeader } from "@/components/LibraryPageHeader";
import { getT } from "@/lib/i18n/server";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const dynamic = "force-dynamic";

export default async function LibraryCoursesPage() {
  const t = await getT();
  const { supabase, user } = await getServerAuth();

  if (!user?.id) {
    redirect("/login?next=/library/courses");
  }

  if (await profileNeedsOnboarding(supabase, user.id)) {
    redirect("/onboarding");
  }

  const { owned } = await loadDashboardCourseLists(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <LibraryPageHeader
            backLabel={t.dashboard.backToHome}
            eyebrow={t.dashboard.libraryEyebrow}
            title={t.dashboard.yourCourses}
            description={t.dashboard.yourCoursesDesc}
            action={{
              href: "/dashboard/courses/new",
              label: t.dashboard.createCourseCta,
            }}
          />

          {owned.length === 0 ? (
            <div className="mt-10 rounded-2xl border border-dashed border-zinc-300 bg-white/60 px-6 py-10 text-center dark:border-zinc-600 dark:bg-zinc-950/40">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {t.dashboard.noCreatedCourses}
              </p>
              <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                {t.dashboard.noCreatedCoursesDesc}
              </p>
            </div>
          ) : (
            <CourseDashboardList
              courses={owned}
              viewerUserId={user.id}
              className="mt-10"
            />
          )}
        </div>
      </main>
    </>
  );
}
