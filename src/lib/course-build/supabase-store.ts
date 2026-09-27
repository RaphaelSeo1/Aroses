import { createAdminClient } from "@/lib/supabase/admin";
import { CourseBuildStore } from "./store.ts";

/** Null when the service-role client is not configured; callers must refuse to build. */
export function createCourseBuildStore(): CourseBuildStore | null {
  const admin = createAdminClient();
  if (!admin) return null;
  return new CourseBuildStore((fn, args) => admin.rpc(fn, args));
}
