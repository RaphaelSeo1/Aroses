import { cache } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

type ServerAuth = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  /** Acting user: impersonated target while viewing as, otherwise the session. */
  user: User | null;
};

/**
 * One `createClient` + `getUser` per React server request. Several RSC trees can import
 * this in the same navigation without repeating the Supabase round-trip.
 * While impersonating, `user` is the target so dashboard/notes/sales load their rows.
 */
export const getServerAuth: () => Promise<ServerAuth> = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
});
