import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import type { AdminActivityItem } from "@/lib/admin-dashboard-data";
import {
  countAllAuthUsers,
  fetchRecentAdminActivity,
} from "@/lib/admin-dashboard-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminDashboardClient } from "./AdminDashboardClient";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const admin = createAdminClient();
  let courses: {
    id: string;
    title: string;
    user_id: string;
    created_at: string;
    is_public: boolean | null;
  }[] = [];
  let loadError: string | null = null;
  let totalCourses = 0;
  let publicCourses = 0;
  let totalUsers = 0;
  let activity: AdminActivityItem[] = [];

  if (!admin) {
    loadError =
      "Service role key is not configured. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) so this dashboard can load platform data.";
  } else {
    const [countRes, publicRes, listRes] = await Promise.all([
      admin.from("courses").select("*", { count: "exact", head: true }),
      admin
        .from("courses")
        .select("*", { count: "exact", head: true })
        .eq("is_public", true),
      admin
        .from("courses")
        .select("id, title, user_id, created_at, is_public")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    if (listRes.error) {
      console.error("[admin] courses", listRes.error);
      loadError = "Could not load courses.";
    } else {
      courses = (listRes.data ?? []) as typeof courses;
    }

    totalCourses = countRes.count ?? 0;
    publicCourses = publicRes.count ?? 0;

    if (countRes.error || publicRes.error) {
      console.error("[admin] counts", countRes.error, publicRes.error);
      if (!loadError) {
        loadError = "Could not load course statistics.";
      }
    }

    if (!loadError) {
      const [usersN, act] = await Promise.all([
        countAllAuthUsers(admin),
        fetchRecentAdminActivity(admin),
      ]);
      totalUsers = usersN;
      activity = act;
    }
  }

  return (
    <>
      <AppHeader
        right={<HeaderNavLoggedIn />}
      />
      <main>
        <AdminDashboardClient
          courses={courses}
          stats={{
            totalCourses,
            totalUsers,
            publicCourses,
            privateCourses: Math.max(0, totalCourses - publicCourses),
          }}
          activity={activity}
          loadError={loadError}
        />
      </main>
    </>
  );
}
