import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";
import { isAppAdminEnvUser } from "@/lib/app-admin-env";
import { createClient } from "@/lib/supabase/server";

export default async function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/admin");
  }
  if (!isAppAdminEnvUser(user)) {
    notFound();
  }
  return <>{children}</>;
}
