import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { createAdminClient } from "@/lib/supabase/admin";

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

  if (!admin) {
    loadError =
      "Service role key is not configured. Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) so this page can list all courses.";
  } else {
    const { data, error } = await admin
      .from("courses")
      .select("id, title, user_id, created_at, is_public")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      console.error("[admin] courses", error);
      loadError = "Could not load courses.";
    } else {
      courses = (data ?? []) as typeof courses;
    }
  }

  return (
    <>
      <AppHeader
        right={<HeaderNavLoggedIn adminHubHref="/dashboard/admin" />}
      />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Admin controls
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Site operations
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            This hub is gated by your env allowlist (
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              APP_ADMIN_USER_IDS
            </code>
            ). Cross-user editing in the dashboard relies on{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              app_super_admins
            </code>{" "}
            (migration{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              025_app_super_admins.sql
            </code>
            ). After migrating, insert your auth user id into{" "}
            <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
              public.app_super_admins
            </code>
            .
          </p>

          {loadError ? (
            <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-100">
              {loadError}
            </div>
          ) : (
            <div className="mt-10 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white/90 shadow-lg dark:border-zinc-700/80 dark:bg-zinc-950/90">
              <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 sm:px-6">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  All courses ({courses.length})
                </h2>
              </div>
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {courses.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/dashboard/courses/${c.id}`}
                      className="flex flex-col gap-1 px-4 py-3 transition hover:bg-zinc-50 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:hover:bg-zinc-900/60"
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-50">
                        {c.title || "Untitled"}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        Owner{" "}
                        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">
                          {c.user_id.slice(0, 8)}…
                        </code>
                        {c.is_public ? (
                          <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                            · public
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
