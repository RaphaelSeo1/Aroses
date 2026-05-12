import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedIn } from "@/components/HeaderNavLoggedIn";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { ProgressDashboardContent } from "@/components/progress/ProgressDashboardContent";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
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
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  type ProfileFields = {
    display_name: string | null;
    birthday: unknown;
    bio: string | null;
    study_focus?: string | null;
    avatar_url?: string | null;
    school_name?: string | null;
  };

  const profileRow = selProfiles.data as ProfileFields | null;
  const profileErr = selProfiles.error;

  let initial: UserProfileRow | null = null;
  if (!profileErr && profileRow) {
    initial = {
      display_name: profileRow.display_name,
      birthday:
        profileRow.birthday != null
          ? String(profileRow.birthday).slice(0, 10)
          : null,
      bio: profileRow.bio,
      avatar_url: profileRow.avatar_url ?? null,
      study_focus: profileRow.study_focus ?? null,
      school_name: profileRow.school_name ?? null,
    };
  }

  const progressData = await loadDashboardProgress(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedIn />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:py-14">
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
