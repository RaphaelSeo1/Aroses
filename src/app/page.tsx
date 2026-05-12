import { DashboardHomeContent } from "@/components/DashboardHomeContent";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email || !user.id) {
    redirect("/intro");
  }

  const [{ owned, studying }, progress] = await Promise.all([
    loadDashboardCourseLists(supabase, user.id),
    loadDashboardProgress(supabase, user.id),
  ]);
  return (
    <DashboardHomeContent
      userEmail={user.email}
      viewerUserId={user.id}
      ownedCourses={owned}
      studyingCourses={studying}
      progress={progress}
    />
  );
}
