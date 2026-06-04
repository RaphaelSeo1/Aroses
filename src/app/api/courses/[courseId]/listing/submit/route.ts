import { NextResponse } from "next/server";
import { aggregateCourseMaterials } from "@/lib/marketplace/aggregate-course-content";
import { attestationVersion } from "@/lib/marketplace/attestation";
import {
  fetchSellerPayoutAccount,
  sellerCanReceivePayments,
} from "@/lib/marketplace/connect";
import { fetchListingForCourse } from "@/lib/marketplace/listing-access";
import { isMarketplacePaymentsEnabled } from "@/lib/marketplace/platform-fee";
import { reviewCourseForListing } from "@/lib/marketplace/review-course-listing";
import type { CourseListingRow } from "@/lib/marketplace/types";
import { logActivity } from "@/lib/activity-log";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

export async function POST(request: Request, ctx: Params) {
  const { courseId } = await ctx.params;
  if (!UUID_RE.test(courseId)) {
    return NextResponse.json({ error: "Invalid course id." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const attestationAccepted =
    (body as { attestationAccepted?: unknown }).attestationAccepted === true;
  if (!attestationAccepted) {
    return NextResponse.json(
      { error: "You must accept the seller attestation to submit." },
      { status: 400 }
    );
  }

  const { data: course } = await supabase
    .from("courses")
    .select("user_id, is_self_study, is_public, title, description")
    .eq("id", courseId)
    .maybeSingle();

  if (!course || course.user_id !== user.id) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (course.is_self_study) {
    return NextResponse.json(
      { error: "Self-study courses cannot be listed for sale." },
      { status: 400 }
    );
  }

  if (isMarketplacePaymentsEnabled()) {
    const payout = await fetchSellerPayoutAccount(supabase, user.id);
    if (!sellerCanReceivePayments(payout)) {
      return NextResponse.json(
        {
          error:
            "Connect your payout account before submitting. Use “Set up payouts” on this page.",
        },
        { status: 400 }
      );
    }
  }

  if (course.is_public) {
    await supabase
      .from("courses")
      .update({ is_public: false })
      .eq("id", courseId);
  }

  const existing = await fetchListingForCourse(supabase, courseId);
  if (!existing) {
    return NextResponse.json(
      { error: "Set a price before submitting for review." },
      { status: 400 }
    );
  }
  if (existing.status === "pending_review") {
    return NextResponse.json(
      { error: "This listing is already pending review." },
      { status: 409 }
    );
  }
  if (existing.status === "approved") {
    return NextResponse.json(
      { error: "Listing is already live. Delist before resubmitting." },
      { status: 409 }
    );
  }

  const { data: materials } = await supabase
    .from("study_materials")
    .select("course_payload")
    .eq("course_id", courseId);

  if (!materials?.length) {
    return NextResponse.json(
      { error: "Add at least one study material before listing for sale." },
      { status: 400 }
    );
  }

  const stats = aggregateCourseMaterials(materials);
  const review = await reviewCourseForListing({
    courseTitle: course.title,
    courseDescription: course.description ?? "",
    stats,
  });

  const now = new Date().toISOString();
  const requiresManualReview = true;

  const { data: updated, error } = await supabase
    .from("course_listings")
    .update({
      status: "pending_review",
      attested_at: now,
      attestation_version: attestationVersion(),
      submitted_at: now,
      quality_review: review.quality,
      originality_review: review.originality,
      requires_manual_review: requiresManualReview,
      rejection_reason: null,
      reviewed_by: null,
      reviewed_at: null,
      approved_at: null,
      updated_at: now,
    })
    .eq("course_id", courseId)
    .eq("seller_user_id", user.id)
    .select("*")
    .single();

  if (error) {
    console.error("[listing submit]", error);
    return NextResponse.json({ error: "Could not submit listing." }, { status: 500 });
  }

  await logActivity({
    userId: user.id,
    type: "listing_submitted",
    summary: `Submitted course for sale review: ${course.title}`,
    metadata: { courseId },
  });

  return NextResponse.json({
    listing: {
      courseId: updated.course_id,
      status: updated.status,
      qualityReview: review.quality,
      originalityReview: review.originality,
    },
  });
}
