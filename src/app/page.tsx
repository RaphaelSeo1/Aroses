import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { DashboardHomeContent } from "@/components/DashboardHomeContent";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { MainRouteSkeleton } from "@/components/MainRouteSkeleton";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import { profileNeedsOnboarding } from "@/lib/onboarding-gate";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import { redirect } from "next/navigation";

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

  const [{ owned, studying }, progress] = await Promise.all([
    loadDashboardCourseLists(supabase, user.id),
    loadDashboardProgress(supabase, user.id),
  ]);
  return (
    <DashboardHomeContent
      omitHeader
      userEmail={user.email}
      viewerUserId={user.id}
      ownedCourses={owned}
      studyingCourses={studying}
      progress={progress}
    />
  );
}
