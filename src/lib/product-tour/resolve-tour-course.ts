import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  configuredTourCourseId,
  isBio1ATitle,
  pickTourCourseFromList,
  type TourCourseCandidate,
} from "@/lib/product-tour/bio-1a";

export type ResolvedTourCourse = {
  id: string;
  title: string;
  available: boolean;
};

async function loadCourseRow(
  client: SupabaseClient,
  courseId: string
): Promise<{
  id: string;
  title: string;
  is_public: boolean | null;
  is_self_study: boolean | null;
  user_id: string;
} | null> {
  const { data } = await client
    .from("courses")
    .select("id, title, is_public, is_self_study, user_id")
    .eq("id", courseId)
    .maybeSingle();
  return data;
}

async function hasApprovedListing(
  client: SupabaseClient,
  courseId: string
): Promise<boolean> {
  const { data } = await client
    .from("course_listings")
    .select("status")
    .eq("course_id", courseId)
    .maybeSingle();
  return data?.status === "approved";
}

function isPublishedForExplore(row: {
  is_public: boolean | null;
  is_self_study: boolean | null;
  listed: boolean;
}): boolean {
  if (row.is_self_study) return false;
  return Boolean(row.is_public) || row.listed;
}

/**
 * Resolve the Bio 1A tour course from the live DB. Uses the service-role client
 * when present so a paid Explore listing (is_public = false) still resolves.
 * Returns `{ available: false }` when the row is missing (empty local DB).
 */
export async function resolveTourCourse(
  sessionClient: SupabaseClient
): Promise<ResolvedTourCourse> {
  const configured = configuredTourCourseId();
  const admin = createAdminClient();
  const reader = admin ?? sessionClient;

  const configuredRow = await loadCourseRow(reader, configured);
  if (configuredRow && !configuredRow.is_self_study) {
    const listed = await hasApprovedListing(reader, configuredRow.id);
    return {
      id: configuredRow.id,
      title: configuredRow.title || "Bio 1A",
      available: isPublishedForExplore({
        is_public: configuredRow.is_public,
        is_self_study: configuredRow.is_self_study,
        listed,
      }) || isBio1ATitle(configuredRow.title),
    };
  }

  const { data: titled } = await reader
    .from("courses")
    .select("id, title, user_id, is_public, is_self_study")
    .or("title.ilike.%Bio 1A%,title.ilike.%Biology 1A%")
    .eq("is_self_study", false)
    .limit(20);

  const candidates = (titled ?? []) as TourCourseCandidate[];
  const picked = pickTourCourseFromList(candidates);
  if (!picked) {
    return { id: configured, title: "Bio 1A", available: false };
  }

  const row = await loadCourseRow(reader, picked.id);
  const listed = row ? await hasApprovedListing(reader, row.id) : false;
  return {
    id: picked.id,
    title: picked.title || "Bio 1A",
    available: Boolean(row) &&
      isPublishedForExplore({
        is_public: row?.is_public ?? false,
        is_self_study: row?.is_self_study ?? false,
        listed,
      }),
  };
}
