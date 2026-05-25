import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { MainRouteSkeleton } from "@/components/MainRouteSkeleton";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";
import { redirect } from "next/navigation";
import { ReviewDashboardClient } from "@/components/ReviewDashboardClient";

export default function ReviewPage() {
  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <Suspense fallback={<MainRouteSkeleton />}>
        <ReviewPageContent />
      </Suspense>
    </>
  );
}

async function ReviewPageContent() {
  const { user } = await getServerAuth();
  if (!user?.id) redirect("/intro");
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <ReviewDashboardClient />
    </main>
  );
}
