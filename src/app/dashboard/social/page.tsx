import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { SocialClient } from "@/components/social/SocialClient";
import { APP_NAME } from "@/lib/brand";
import { fetchSocialBadgeCounts } from "@/lib/messaging/social-badge-counts";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const metadata = {
  title: `Social — ${APP_NAME}`,
};

export default async function SocialPage() {
  const { user, supabase } = await getServerAuth();
  if (!user) {
    redirect("/login?next=/dashboard/social");
  }

  const initialSocialCounts = await fetchSocialBadgeCounts(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <Suspense fallback={null}>
            <SocialClient initialSocialCounts={initialSocialCounts} />
          </Suspense>
        </div>
      </main>
    </>
  );
}
