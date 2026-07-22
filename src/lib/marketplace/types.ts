export type ListingStatus =
  | "draft"
  | "pending_review"
  | "approved"
  | "rejected";

export const LISTING_STATUSES: ListingStatus[] = [
  "draft",
  "pending_review",
  "approved",
  "rejected",
];

export const MIN_PRICE_CENTS = 99;
export const MAX_PRICE_CENTS = 9_999;

export const ATTESTATION_VERSION = "listing-attestation-v1";

export type QualityReviewResult = {
  passed: boolean;
  score: number;
  flags: string[];
  summary: string;
  reviewed_at: string;
  stats: {
    lessonCount: number;
    avgLessonChars: number;
    moduleCount: number;
    quizCount: number;
  };
};

export type OriginalityReviewResult = {
  flagged: boolean;
  confidence: "low" | "medium" | "high";
  reasons: string[];
  reviewed_at: string;
};

export type CourseListingRow = {
  course_id: string;
  seller_user_id: string;
  price_cents: number;
  currency: string;
  status: ListingStatus;
  attested_at: string | null;
  attestation_version: string | null;
  submitted_at: string | null;
  quality_review: QualityReviewResult | null;
  originality_review: OriginalityReviewResult | null;
  requires_manual_review: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  rejection_reason: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ExploreListingCard = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  user_id: string;
  listingKind: "free" | "for_sale";
  price_cents?: number;
  currency?: string;
  seller_display_name?: string | null;
  seller_username?: string | null;
  /** Resolved school for display: course tag, else creator profile. */
  school_name?: string | null;
  school_source?: "tagged" | "creator" | null;
};
