import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { BillingClient } from "@/components/billing/BillingClient";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { APP_NAME } from "@/lib/brand";
import { isBillingUiEnabled } from "@/lib/billing/feature-flag";
import { reconcileUserSubscription } from "@/lib/billing/subscription";
import { checkVoiceAllowance } from "@/lib/billing/voice-usage";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const metadata = {
  title: `Plans & billing — ${APP_NAME}`,
};

export default async function BillingPage() {
  if (!isBillingUiEnabled()) {
    redirect("/");
  }

  const { user } = await getServerAuth();
  if (!user) {
    redirect("/login?next=/dashboard/billing");
  }

  // Reconcile first so stale test-mode Stripe ids don't show a phantom paid plan.
  const sub = await reconcileUserSubscription(user.id);
  const usage = await checkVoiceAllowance(user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <Suspense fallback={null}>
            <BillingClient
              currentTier={sub.tier}
              status={sub.status}
              currentPeriodEnd={sub.currentPeriodEnd}
              cancelAtPeriodEnd={sub.cancelAtPeriodEnd}
              hasCustomer={Boolean(sub.stripeCustomerId)}
              voiceUsedSeconds={usage.usedSeconds}
              voiceCapSeconds={usage.capSeconds}
            />
          </Suspense>
        </div>
      </main>
    </>
  );
}
