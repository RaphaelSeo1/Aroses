import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DashboardHomeContent } from "@/components/DashboardHomeContent";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { MainRouteSkeleton } from "@/components/MainRouteSkeleton";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import {
  homeGreetingName,
  loadHomePreviews,
} from "@/lib/home-preview-data";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { fetchSrsDueCountsForUser } from "@/lib/srs-due-counts-server";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <Suspense fallback={<MainRouteSkeleton />}>
        <HomeContent />
      </Suspense>
    </>
  );
}

async function HomeContent() {
  const { supabase, user } = await getServerAuth();

  if (!user?.email || !user.id) {
    redirect("/intro");
  }

  if (await profileNeedsOnboarding(supabase, user.id)) {
    redirect("/onboarding");
  }

  const [{ owned, studying, sharedWithMe }, progress, previews, dueCounts] =
    await Promise.all([
      loadDashboardCourseLists(supabase, user.id),
      loadDashboardProgress(supabase, user.id),
      loadHomePreviews(supabase, user.id),
      fetchSrsDueCountsForUser(supabase, user.id),
    ]);

  return (
    <DashboardHomeContent
      omitHeader
      greetingName={homeGreetingName(previews.displayName, user.email)}
      viewerUserId={user.id}
      ownedCourses={owned}
      studyingCourses={studying}
      sharedCourses={sharedWithMe}
      progress={progress}
      initialDueCounts={dueCounts}
    />
  );
}
