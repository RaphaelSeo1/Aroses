import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BillingClient } from "@/components/billing/BillingClient";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { ProfileSettingsForm } from "@/components/ProfileSettingsForm";
import { ProgressDashboardContent } from "@/components/progress/ProgressDashboardContent";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { reconcileUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { loadDashboardProgress } from "@/lib/dashboard-progress-data";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import type { UserProfileRow } from "@/types/profile";

type PageProps = {
  searchParams: Promise<{ tab?: string; conversation?: string }>;
};

function ProfileBodySkeleton() {
  return (
    <div className="animate-pulse space-y-6 rounded-2xl border border-zinc-200/80 bg-white/50 p-8 dark:border-zinc-800 dark:bg-zinc-950/40">
      <div className="h-8 w-48 rounded-lg bg-zinc-200/80 dark:bg-zinc-700/60" />
      <div className="h-4 max-w-md rounded bg-zinc-200/60 dark:bg-zinc-700/50" />
      <div className="h-72 rounded-xl bg-zinc-200/50 dark:bg-zinc-800/50" />
    </div>
  );
}

export default async function ProfilePage({ searchParams }: PageProps) {
  const { user } = await getServerAuth();

  if (!user?.email) {
    redirect("/login?next=/dashboard/profile");
  }

  const sp = await searchParams;

  // Friends / messages moved to the dedicated Social page.
  if (sp.tab === "friends") {
    redirect("/dashboard/social?tab=friends");
  }
  if (sp.tab === "messages") {
    const conversation = sp.conversation?.trim();
    redirect(
      conversation
        ? `/dashboard/social?tab=messages&conversation=${encodeURIComponent(conversation)}`
        : "/dashboard/social?tab=messages"
    );
  }

  const billingEnabled = isBillingUiEnabled();
  const initialPanel =
    sp.tab === "progress"
      ? ("progress" as const)
      : sp.tab === "account"
        ? ("account" as const)
        : sp.tab === "billing" && billingEnabled
          ? ("billing" as const)
          : ("general" as const);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto w-full max-w-screen-2xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8 lg:py-12">
          <Suspense fallback={<ProfileBodySkeleton />}>
            <ProfilePageBody
              userEmail={user.email}
              userId={user.id}
              initialPanel={initialPanel}
              includeBilling={billingEnabled}
            />
          </Suspense>
        </div>
      </main>
    </>
  );
}

type ProfileFields = {
  display_name: string | null;
  username?: string | null;
  birthday: unknown;
  bio: string | null;
  study_focus?: string | null;
  avatar_url?: string | null;
  school_name?: string | null;
};

async function ProfilePageBody({
  userEmail,
  userId,
  initialPanel,
  includeBilling,
}: {
  userEmail: string;
  userId: string;
  initialPanel: "progress" | "account" | "general" | "billing";
  includeBilling: boolean;
}) {
  const { supabase } = await getServerAuth();
  const [selProfiles, progressData, billingBundle] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    loadDashboardProgress(supabase, userId),
    includeBilling
      ? Promise.all([
          reconcileUserSubscription(userId),
          checkVoiceAllowance(userId),
        ])
      : Promise.resolve(null),
  ]);

  const profileRow = selProfiles.data as ProfileFields | null;
  const profileErr = selProfiles.error;

  let initial: UserProfileRow | null = null;
  if (!profileErr && profileRow) {
    initial = {
      display_name: profileRow.display_name,
      username: profileRow.username ?? null,
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

  const billingPanel =
    billingBundle != null ? (
      <Suspense fallback={null}>
        <BillingClient
          currentTier={billingBundle[0].tier}
          status={billingBundle[0].status}
          currentPeriodEnd={billingBundle[0].currentPeriodEnd}
          cancelAtPeriodEnd={billingBundle[0].cancelAtPeriodEnd}
          hasCustomer={Boolean(billingBundle[0].stripeCustomerId)}
          voiceUsedSeconds={billingBundle[1].usedSeconds}
          voiceCapSeconds={billingBundle[1].capSeconds}
        />
      </Suspense>
    ) : undefined;

  return (
    <ProfileSettingsForm
      email={userEmail}
      initial={initial}
      initialPanel={initialPanel}
      progressPanel={
        <ProgressDashboardContent
          data={progressData}
          showTopActions
          layout="page"
        />
      }
      billingPanel={billingPanel}
    />
  );
}
