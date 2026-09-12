"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { DashboardAdminNavProvider } from "@/components/DashboardAdminNavContext";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";

function adminHrefForUser(user: {
  id: string;
  email?: string | null;
} | null): string | undefined {
  if (user && isAppAdminEnvUser({ id: user.id, email: user.email })) {
    return "/dashboard/admin";
  }
  return undefined;
}

/**
 * Supplies admin hub href app-wide. Runs on the **client** so the root layout does not
 * block each navigation on `getUser()` (that duplicated work with every page’s own auth).
 */
export function AppAdminNavGate({
  children,
  impersonating = false,
}: {
  children: ReactNode;
  impersonating?: boolean;
}) {
  const [sessionAdminHref, setSessionAdminHref] = useState<
    string | undefined
  >(undefined);
  const adminHubHref = impersonating ? undefined : sessionAdminHref;

  useEffect(() => {
    if (impersonating) return;
    const supabase = createClient();

    const sync = () => {
      void supabase.auth.getSession().then(({ data: { session } }) => {
        const u = session?.user;
        setSessionAdminHref(
          u ? adminHrefForUser({ id: u.id, email: u.email }) : undefined
        );
      });
    };

    sync();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      sync();
    });
    return () => subscription.unsubscribe();
  }, [impersonating]);

  return (
    <DashboardAdminNavProvider adminHubHref={adminHubHref}>
      {children}
    </DashboardAdminNavProvider>
  );
}
