import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSellerPayoutAccount,
  sellerCanReceivePayments,
} from "@/lib/marketplace/connect";
import { formatPrice } from "@/lib/marketplace/listing-access";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import type { ListingStatus } from "@/lib/marketplace/types";

export type CoursePublishingSummary = {
  isPublic: boolean;
  listingStatus: ListingStatus | null;
  priceLabel: string | null;
  listingBlocksExplore: boolean;
  payoutsReady: boolean;
  paymentsConfigured: boolean;
};

export type CoursePublishingPanels = CoursePublishingSummary & {
  courseId: string;
  hasMaterials: boolean;
  initialListing: {
    courseId: string;
    priceCents: number;
    currency: string;
    status: ListingStatus;
    rejectionReason: string | null;
    qualityReview?: { passed: boolean; score: number; flags: string[] } | null;
    originalityReview?: { flagged: boolean; reasons: string[] } | null;
  } | null;
  sellerConnectState: {
    configured: boolean;
    ready: boolean;
    chargesEnabled: boolean;
    detailsSubmitted: boolean;
  };
};

export function publishingStatusLabel(summary: CoursePublishingSummary): string {
  if (summary.listingStatus === "approved" && summary.priceLabel) {
    return `Live for sale · ${summary.priceLabel}`;
  }
  if (summary.listingStatus === "pending_review") {
    return "Listing pending review";
  }
  if (summary.listingStatus === "rejected") {
    return "Listing rejected";
  }
  if (summary.listingStatus === "draft") {
    return "Listing draft saved";
  }
  if (summary.isPublic) {
    return "Free on Explore";
  }
  return "Private workspace";
}

export async function fetchCoursePublishingPanels(
  supabase: SupabaseClient,
  input: {
    courseId: string;
    userId: string;
    isPublic: boolean;
    uploadsCount: number;
  }
): Promise<CoursePublishingPanels> {
  const { data: listingRow } = await supabase
    .from("course_listings")
    .select(
      "course_id, price_cents, currency, status, rejection_reason, quality_review, originality_review"
    )
    .eq("course_id", input.courseId)
    .maybeSingle();

  const listingStatus = (listingRow?.status as ListingStatus | undefined) ?? null;
  const listingBlocksExplore =
    listingStatus === "draft" ||
    listingStatus === "pending_review" ||
    listingStatus === "approved";

  const sellerPayout = await fetchSellerPayoutAccount(supabase, input.userId);

  const initialListing = listingRow
    ? {
        courseId: listingRow.course_id,
        priceCents: listingRow.price_cents,
        currency: listingRow.currency,
        status: listingRow.status as ListingStatus,
        rejectionReason: listingRow.rejection_reason,
        qualityReview: listingRow.quality_review as {
          passed: boolean;
          score: number;
          flags: string[];
        } | null,
        originalityReview: listingRow.originality_review as {
          flagged: boolean;
          reasons: string[];
        } | null,
      }
    : null;

  const priceLabel =
    listingRow?.status === "approved"
      ? formatPrice(listingRow.price_cents, listingRow.currency)
      : null;

  return {
    courseId: input.courseId,
    isPublic: input.isPublic,
    listingStatus,
    priceLabel,
    listingBlocksExplore,
    hasMaterials: input.uploadsCount > 0,
    payoutsReady: sellerCanReceivePayments(sellerPayout),
    paymentsConfigured: isMarketplacePaymentsEnabled(),
    initialListing,
    sellerConnectState: {
      configured: isMarketplacePaymentsEnabled(),
      ready: sellerCanReceivePayments(sellerPayout),
      chargesEnabled: sellerPayout?.chargesEnabled ?? false,
      detailsSubmitted: sellerPayout?.detailsSubmitted ?? false,
    },
  };
}

export function courseSettingsHref(courseId: string): string {
  return `/dashboard/courses/${courseId}/settings`;
}
