import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListingStatus } from "@/lib/marketplace/types";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";
import { hasPurchasedCourse } from "@/lib/marketplace/purchases";

export type CourseExploreMode =
  | { kind: "private" }
  | { kind: "free"; courseId: string }
  | {
      kind: "for_sale";
      courseId: string;
      price_cents: number;
      currency: string;
      status: ListingStatus;
    };

export async function fetchListingForCourse(
  supabase: SupabaseClient,
  courseId: string
): Promise<{
  status: ListingStatus;
  price_cents: number;
  currency: string;
  rejection_reason: string | null;
} | null> {
  const { data } = await supabase
    .from("course_listings")
    .select("status, price_cents, currency, rejection_reason")
    .eq("course_id", courseId)
    .maybeSingle();
  if (!data) return null;
  return {
    status: data.status as ListingStatus,
    price_cents: data.price_cents,
    currency: data.currency,
    rejection_reason: data.rejection_reason,
  };
}

/** True when listing blocks free Explore (pending or live). */
export function listingBlocksFreeExplore(status: ListingStatus | null): boolean {
  return (
    status === "pending_review" ||
    status === "approved" ||
    status === "draft"
  );
}

export function activeListingStatus(
  status: ListingStatus | null | undefined
): boolean {
  return status === "pending_review" || status === "approved";
}

/**
 * Buyers may only access full course content when:
 * - they own the course, OR
 * - course is free on Explore (is_public), OR
 * - (future) they purchased the listing.
 */
export async function canAccessCourseStudyContent(
  supabase: SupabaseClient,
  userId: string,
  courseId: string
): Promise<boolean> {
  const { data: course } = await supabase
    .from("courses")
    .select("user_id, is_public")
    .eq("id", courseId)
    .maybeSingle();
  if (!course) return false;
  if (course.user_id === userId) return true;
  if (course.is_public) return true;

  if (await hasPurchasedCourse(supabase, userId, courseId)) return true;

  const { data: listing } = await supabase
    .from("course_listings")
    .select("status")
    .eq("course_id", courseId)
    .maybeSingle();

  if (listing?.status === "approved") {
    return false;
  }

  return false;
}

export async function resolveExploreCourse(
  supabase: SupabaseClient,
  courseId: string
): Promise<
  | (CourseExploreMode & {
      title: string;
      description: string | null;
      created_at: string;
      user_id: string;
    })
  | null
> {
  const { data: course } = await supabase
    .from("courses")
    .select("id, title, description, created_at, user_id, is_public, is_self_study")
    .eq("id", courseId)
    .maybeSingle();
  if (!course || course.is_self_study) return null;

  const { data: listing } = await supabase
    .from("course_listings")
    .select("status, price_cents, currency")
    .eq("course_id", courseId)
    .maybeSingle();

  const base = {
    title: course.title,
    description: course.description,
    created_at: course.created_at,
    user_id: course.user_id,
  };

  if (listing?.status === "approved") {
    if (!isMarketplaceUiEnabled()) {
      return null;
    }
    return {
      kind: "for_sale",
      courseId: course.id,
      price_cents: listing.price_cents,
      currency: listing.currency,
      status: "approved",
      ...base,
    };
  }

  if (course.is_public) {
    return { kind: "free", courseId: course.id, ...base };
  }

  return null;
}

export function formatPrice(cents: number, currency = "usd"): string {
  if (currency.toLowerCase() === "usd") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(cents / 100);
  }
  return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
}
