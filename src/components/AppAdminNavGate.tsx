import type { ReactNode } from "react";
import { DashboardAdminNavProvider } from "@/components/DashboardAdminNavContext";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { createClient } from "@/lib/supabase/server";

/**
 * Supplies admin hub href to the whole app so **Admin** appears on Explore,
 * Intro, Legal, etc., not only under `/dashboard/*`.
 */
export async function AppAdminNavGate({ children }: { children: ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const adminHubHref =
    user && isAppAdminEnvUser({ id: user.id, email: user.email })
      ? "/dashboard/admin"
      : undefined;

  return (
    <DashboardAdminNavProvider adminHubHref={adminHubHref}>
      {children}
    </DashboardAdminNavProvider>
  );
}
