import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { CourseDashboardList } from "@/components/CourseDashboardList";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { createClient } from "@/lib/supabase/server";

function missingIsPublicColumn(err: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!err) return false;
  return (
    err.code === "42703" ||
    /is_public|schema cache/i.test(err.message ?? "")
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const ownerId = user.id;
  if (!ownerId) {
    redirect("/login?next=/dashboard");
  }

  const primary = await supabase
    .from("courses")
    .select(
      "id, title, description, created_at, sort_order, is_public, user_id"
    )
    .eq("user_id", ownerId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  const fallback =
    primary.error && missingIsPublicColumn(primary.error)
      ? await supabase
          .from("courses")
          .select("id, title, description, created_at, sort_order, user_id")
          .eq("user_id", ownerId)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
      : null;

  const rawRows =
    fallback && !fallback.error ? fallback.data : primary.data;

  const courses = (rawRows ?? []).filter((row) => row.user_id === ownerId);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
          <div className="flex flex-col gap-8 border-b border-zinc-200/80 pb-10 dark:border-zinc-800 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-brand dark:text-brand-soft">
                Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                Your courses
              </h1>
              <p className="mt-2 text-zinc-600 dark:text-zinc-400">
                {user?.email ? (
                  <>
                    Signed in as{" "}
                    <Link
                      href="/dashboard/profile"
                      className="font-medium text-zinc-900 underline-offset-2 hover:text-brand hover:underline dark:text-zinc-200 dark:hover:text-brand-soft"
                    >
                      {user.email}
                    </Link>
                  </>
                ) : (
                  "Loading profile…"
                )}
              </p>
            </div>
            <Link
              href="/dashboard/courses/new"
              className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition hover:bg-brand-hover dark:bg-brand dark:hover:bg-brand-soft"
            >
              + Create course
            </Link>
          </div>

          {!courses || courses.length === 0 ? (
            <div className="mx-auto mt-20 max-w-lg rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
              <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
                Start your first course
              </p>
              <p className="mt-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
                Give it a name and a one-line goal. Then add exam groups and
                upload PDFs into each — we build separate study paths per exam.
              </p>
              <Link
                href="/dashboard/courses/new"
                className="mt-8 inline-flex rounded-full bg-zinc-900 px-8 py-3 text-sm font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
              >
                Create your first course
              </Link>
            </div>
          ) : (
            <CourseDashboardList courses={courses} viewerUserId={ownerId} />
          )}
        </div>
      </main>
    </>
  );
}
