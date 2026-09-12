import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { getImpersonationViewState } from "@/lib/impersonation/server-state";
import { createSessionClient } from "@/lib/supabase/session-client";

export default async function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/admin");
  }
  if (!isAppAdminEnvUser(user)) {
    notFound();
  }
  if (await getImpersonationViewState()) {
    redirect("/");
  }
  return <>{children}</>;
}
