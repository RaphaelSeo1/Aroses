import type { ListingStatus } from "@/lib/marketplace/types";

/** True when a paid listing is live or in review. A delisted draft does not block free Explore. */
export function listingBlocksFreeExplore(status: ListingStatus | null): boolean {
  return status === "pending_review" || status === "approved";
}
