import { DashboardHomeContent } from "@/components/DashboardHomeContent";
import { loadDashboardCourseLists } from "@/lib/load-dashboard-courses";
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

  const { owned, studying } = await loadDashboardCourseLists(supabase, user.id);
  return (
    <DashboardHomeContent
      userEmail={user.email}
      viewerUserId={user.id}
      ownedCourses={owned}
      studyingCourses={studying}
    />
  );
}
