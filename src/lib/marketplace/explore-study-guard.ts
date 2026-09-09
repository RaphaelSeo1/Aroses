import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";
import { createAdminClient } from "@/lib/supabase/admin";
import { isBio1ATitle, isTourDemoCourseId } from "@/lib/product-tour/bio-1a";
import {
  isTourDemoAccessForCourse,
  parseTourDemoCookie,
  TOUR_DEMO_COOKIE,
} from "@/lib/product-tour/tour-demo-cookie";

export type ExploreStudyCourseRow = {
  id: string;
  title: string;
  description: string | null;
  user_id: string;
  is_public: boolean;
};

export async function readTourDemoForCourse(
  courseId: string,
  searchTour?: string | null
): Promise<boolean> {
  const cookieStore = await cookies();
  const fromCookie = parseTourDemoCookie(
    cookieStore.get(TOUR_DEMO_COOKIE)?.value
  );
  if (isTourDemoAccessForCourse(courseId, fromCookie)) {
    if (isTourDemoCourseId(courseId)) return true;
  }
  if (searchTour === "1" && isTourDemoCourseId(courseId)) {
    return true;
  }
  return false;
}

/**
 * Explore study routes: free public courses OR course owner.
 * Paid marketplace listings block full content until purchase (owner exempt).
 * Onboarding tour sandbox may read the Bio 1A demo course without purchase.
 */
export async function loadExploreStudyCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string,
  opts?: { tourSandbox?: boolean }
): Promise<ExploreStudyCourseRow> {
  let { data: courseRow } = await supabase
    .from("courses")
    .select("id, title, description, user_id, is_public")
    .eq("id", courseId)
    .maybeSingle();

  const cookieStore = await cookies();
  const fromCookie = parseTourDemoCookie(
    cookieStore.get(TOUR_DEMO_COOKIE)?.value
  );
  const cookieMatches = isTourDemoAccessForCourse(courseId, fromCookie);
  const tourHint =
    Boolean(opts?.tourSandbox) ||
    cookieMatches ||
    (await readTourDemoForCourse(courseId));

  if (!courseRow && tourHint) {
    const admin = createAdminClient();
    if (admin) {
      const adminRow = await admin
        .from("courses")
        .select("id, title, description, user_id, is_public")
        .eq("id", courseId)
        .maybeSingle();
      courseRow = adminRow.data;
    }
  }

  if (!courseRow) notFound();

  const tourDemo =
    tourHint &&
    (isTourDemoCourseId(courseId) || isBio1ATitle(courseRow.title ?? ""));

  const isOwner = courseRow.user_id === userId;
  const { data: listing } = await supabase
    .from("course_listings")
    .select("status")
    .eq("course_id", courseId)
    .maybeSingle();

  if (!isOwner) {
    const isPaidListing = listing?.status === "approved";
    if (isPaidListing) {
      const purchased = await hasPurchasedCourse(supabase, userId, courseId);
      if (!purchased && !tourDemo) {
        redirect(`/explore/${courseId}`);
      }
    } else if (!courseRow.is_public && !tourDemo) {
      notFound();
    }
  }

  return courseRow as ExploreStudyCourseRow;
}
