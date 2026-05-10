import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { ProgressDashboardContent } from "@/components/progress/ProgressDashboardContent";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import { isStudyFocusColumnError } from "@/lib/profile-db-errors";
import { createClient } from "@/lib/supabase/server";
import type { UserProfileRow } from "@/types/profile";

type PageProps = {
  searchParams: Promise<{ tab?: string }>;
};

function ProfileFormSkeleton() {
  return (
    <div className="flex min-h-[20rem] items-center justify-center rounded-2xl border border-zinc-200 bg-white/90 dark:border-zinc-800 dark:bg-zinc-950/90">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Loading settings…
      </p>
    </div>
  );
}

export default async function ProfilePage({ searchParams }: PageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login?next=/dashboard/profile");
  }

  const sp = await searchParams;
  const initialPanel =
    sp.tab === "progress"
      ? ("progress" as const)
      : sp.tab === "account"
        ? ("account" as const)
        : ("general" as const);

  const selProfiles = await supabase
    .from("profiles")
    .select("display_name, birthday, bio, timezone, study_focus")
    .eq("id", user.id)
    .maybeSingle();

  type ProfileFields = {
    display_name: string | null;
    birthday: unknown;
    bio: string | null;
    timezone: string | null;
    study_focus?: string | null;
  };

  let profileRow: ProfileFields | null =
    selProfiles.data as ProfileFields | null;
  let profileErr = selProfiles.error;

  if (profileErr && isStudyFocusColumnError(profileErr.message)) {
    const base = await supabase
      .from("profiles")
      .select("display_name, birthday, bio, timezone")
      .eq("id", user.id)
      .maybeSingle();
    profileRow = base.data as ProfileFields | null;
    profileErr = base.error;
  }

  let initial: UserProfileRow | null = null;
  if (!profileErr && profileRow) {
    initial = {
      display_name: profileRow.display_name,
      birthday:
        profileRow.birthday != null
          ? String(profileRow.birthday).slice(0, 10)
          : null,
      bio: profileRow.bio,
      timezone: profileRow.timezone,
      study_focus: profileRow.study_focus ?? null,
    };
  }

  const progressData = await loadDashboardProgress(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:py-14">
          <div className="mb-8 lg:mb-10">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Settings
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-3xl">
              Profile & preferences
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Manage your account and learning pulse in one place — open the{" "}
              <Link
                href="/dashboard/profile?tab=progress"
                className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-200"
              >
                Progress
              </Link>{" "}
              tab for rings, quiz stats, and course shortcuts.
            </p>
          </div>

          <Suspense fallback={<ProfileFormSkeleton />}>
            <ProfileSettingsForm
              email={user.email}
              initial={initial}
              initialPanel={initialPanel}
              progressPanel={
                <ProgressDashboardContent
                  data={progressData}
                  showTopActions
                  layout="panel"
                />
              }
            />
          </Suspense>
        </div>
      </main>
    </>
  );
}
