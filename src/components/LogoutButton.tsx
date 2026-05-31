"use client";

import { HEADER_NAV_NEUTRAL } from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import { reportClientActivity } from "@/lib/activity-log-client";
import { useRouter } from "next/navigation";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    // Log the sign-out while the session cookie is still valid, then sign out.
    await reportClientActivity("sign_out");
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={className ?? HEADER_NAV_NEUTRAL}
    >
      Log out
    </button>
  );
}
