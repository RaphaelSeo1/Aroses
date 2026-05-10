"use client";

import { HEADER_NAV_NEUTRAL } from "@/components/AppHeader";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className={`${HEADER_NAV_NEUTRAL} cursor-pointer`}
    >
      Log out
    </button>
  );
}
