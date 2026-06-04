import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";

export type ExploreStudyCourseRow = {
  id: string;
  title: string;
  description: string | null;
  user_id: string;
  is_public: boolean;
};

/**
 * Explore study routes: free public courses OR course owner.
 * Paid marketplace listings block full content until purchase (owner exempt).
 */
export async function loadExploreStudyCourse(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<ExploreStudyCourseRow> {
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, title, description, user_id, is_public")
    .eq("id", courseId)
    .maybeSingle();

  if (!courseRow) notFound();

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
      if (!purchased) {
        redirect(`/explore/${courseId}`);
      }
    } else if (!courseRow.is_public) {
      notFound();
    }
  }

  return courseRow as ExploreStudyCourseRow;
}
