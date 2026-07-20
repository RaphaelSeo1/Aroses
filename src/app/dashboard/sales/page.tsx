import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { HeaderNavLoggedInServer } from "@/components/HeaderNavLoggedInServer";
import { SellerSalesClient } from "@/components/marketplace/SellerSalesClient";
import { APP_NAME } from "@/lib/brand";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { loadSellerSalesAnalytics } from "@/lib/marketplace/seller-sales";
import { createClient } from "@/lib/supabase/server";
import { getServerAuth } from "@/lib/supabase/server-auth-cache";

export const metadata = {
  title: `Sales — ${APP_NAME}`,
};

export default async function SellerSalesPage() {
  if (!isMarketplaceUiEnabled()) {
    redirect("/");
  }

  const { user } = await getServerAuth();
  if (!user) {
    redirect("/login?next=/dashboard/sales");
  }

  const supabase = await createClient();
  const analytics = await loadSellerSalesAnalytics(supabase, user.id);

  return (
    <>
      <AppHeader right={<HeaderNavLoggedInServer />} />
      <main className="min-h-[calc(100vh-4rem)] bg-app-gradient">
        <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
          <SellerSalesClient analytics={analytics} />
        </div>
      </main>
    </>
  );
}
