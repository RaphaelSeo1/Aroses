import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import type { AdminActivityItem, AdminUserRow } from "@/lib/admin-dashboard-data";
import {
  countAllAuthUsers,
  fetchAdminUserDirectory,
  fetchRecentAdminActivity,
} from "@/lib/admin-dashboard-data";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminDashboardClient } from "./AdminDashboardClient";
import type { PendingListingRow } from "@/components/admin/AdminPendingListings";

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
  let users: AdminUserRow[] = [];
  let usersError: string | null = null;

  let pendingListings: PendingListingRow[] = [];

  if (!admin) {
    loadError =
      "Service role key is not configured. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) so this dashboard can load platform data.";
  } else {
    const [countRes, publicRes, listRes, usersRes, usersN, act] =
      await Promise.all([
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
        fetchAdminUserDirectory(admin),
        countAllAuthUsers(admin),
        fetchRecentAdminActivity(admin),
      ]);

    users = usersRes.users;
    usersError = usersRes.error;
    totalUsers = usersN;
    activity = act;

    if (listRes.error) {
      console.error("[admin] courses", listRes.error);
      loadError = "Could not load courses.";
    } else {
      courses = (listRes.data ?? []) as typeof courses;
    }

    totalCourses = countRes.count ?? 0;
    publicCourses = publicRes.count ?? 0;

    const { data: pendingRaw } = await admin
      .from("course_listings")
      .select(
        "course_id, price_cents, currency, submitted_at, quality_review, originality_review, courses(title, user_id)"
      )
      .eq("status", "pending_review")
      .order("submitted_at", { ascending: true });

    const sellerIds = [
      ...new Set(
        (pendingRaw ?? [])
          .map((r) => {
            const joined = r.courses as { user_id?: string } | { user_id?: string }[] | null;
            const course = Array.isArray(joined) ? joined[0] : joined;
            return course?.user_id;
          })
          .filter((id): id is string => typeof id === "string")
      ),
    ];
    const profileMap = new Map<string, string>();
    if (sellerIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, username, display_name")
        .in("id", sellerIds);
      for (const p of profiles ?? []) {
        profileMap.set(
          p.id,
          p.username ? `@${p.username}` : p.display_name ?? p.id.slice(0, 8)
        );
      }
    }

    pendingListings = (pendingRaw ?? []).map((row) => {
      const joined = row.courses as
        | { title: string; user_id: string }
        | { title: string; user_id: string }[]
        | null;
      const courses = Array.isArray(joined) ? (joined[0] ?? null) : joined;
      const uid = courses?.user_id ?? "";
      return {
        course_id: row.course_id,
        price_cents: row.price_cents,
        currency: row.currency,
        submitted_at: row.submitted_at,
        quality_review: row.quality_review as PendingListingRow["quality_review"],
        originality_review:
          row.originality_review as PendingListingRow["originality_review"],
        courses,
        seller_label: profileMap.get(uid) ?? uid.slice(0, 8),
      };
    });

    if (countRes.error || publicRes.error) {
      console.error("[admin] counts", countRes.error, publicRes.error);
      if (!loadError) {
        loadError = "Could not load course statistics.";
      }
    }
  }

  return (
    <>
      <AppHeader
        right={<HeaderNavLoggedInServer />}
      />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <AdminDashboardClient
          courses={courses}
          pendingListings={pendingListings}
          stats={{
            totalCourses,
            totalUsers,
            publicCourses,
            privateCourses: Math.max(0, totalCourses - publicCourses),
          }}
          users={users}
          usersError={usersError}
          activity={activity}
          loadError={loadError}
        />
      </main>
    </>
  );
}
