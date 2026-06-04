import { NextResponse } from "next/server";
import { marketplaceApiUnavailable } from "@/lib/marketplace/api-guard";
import { createClient } from "@/lib/supabase/server";
import { fetchListingForCourse } from "@/lib/marketplace/listing-access";
import {
  MAX_PRICE_CENTS,
  MIN_PRICE_CENTS,
  type CourseListingRow,
} from "@/lib/marketplace/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Params = { params: Promise<{ courseId: string }> };

function serializeListing(row: CourseListingRow) {
  return {
    courseId: row.course_id,
    priceCents: row.price_cents,
    currency: row.currency,
    status: row.status,
    attestedAt: row.attested_at,
    attestationVersion: row.attestation_version,
    submittedAt: row.submitted_at,
    qualityReview: row.quality_review,
    originalityReview: row.originality_review,
    rejectionReason: row.rejection_reason,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
  };
}

export async function GET(_req: Request, ctx: Params) {
  const blocked = marketplaceApiUnavailable();
  if (blocked) return blocked;

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

  const { data: course } = await supabase
    .from("courses")
    .select("user_id, is_self_study")
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

  const { data: listing } = await supabase
    .from("course_listings")
    .select("*")
    .eq("course_id", courseId)
    .maybeSingle();

  return NextResponse.json({
    listing: listing ? serializeListing(listing as CourseListingRow) : null,
  });
}

export async function PUT(request: Request, ctx: Params) {
  const blocked = marketplaceApiUnavailable();
  if (blocked) return blocked;

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

  const priceCentsRaw = (body as { priceCents?: unknown }).priceCents;
  const priceCents =
    typeof priceCentsRaw === "number"
      ? Math.trunc(priceCentsRaw)
      : Number.parseInt(String(priceCentsRaw ?? ""), 10);

  if (
    !Number.isFinite(priceCents) ||
    priceCents < MIN_PRICE_CENTS ||
    priceCents > MAX_PRICE_CENTS
  ) {
    return NextResponse.json(
      {
        error: `Price must be between $${(MIN_PRICE_CENTS / 100).toFixed(2)} and $${(MAX_PRICE_CENTS / 100).toFixed(2)}.`,
      },
      { status: 400 }
    );
  }

  const { data: course } = await supabase
    .from("courses")
    .select("user_id, is_self_study, is_public")
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

  const existing = await fetchListingForCourse(supabase, courseId);
  if (
    existing &&
    (existing.status === "pending_review" || existing.status === "approved")
  ) {
    return NextResponse.json(
      { error: "Listing is under review or live; delist before editing price." },
      { status: 409 }
    );
  }

  if (course.is_public) {
    return NextResponse.json(
      {
        error:
          "Turn off free Explore listing before setting up a paid listing.",
      },
      { status: 409 }
    );
  }

  const now = new Date().toISOString();
  const { data: upserted, error } = await supabase
    .from("course_listings")
    .upsert(
      {
        course_id: courseId,
        seller_user_id: user.id,
        price_cents: priceCents,
        currency: "usd",
        status: existing?.status === "rejected" ? "draft" : "draft",
        updated_at: now,
        ...(existing?.status === "rejected"
          ? {
              rejection_reason: null,
              submitted_at: null,
              attested_at: null,
              attestation_version: null,
            }
          : {}),
      },
      { onConflict: "course_id" }
    )
    .select("*")
    .single();

  if (error) {
    console.error("[listing PUT]", error);
    return NextResponse.json({ error: "Could not save listing." }, { status: 500 });
  }

  return NextResponse.json({
    listing: serializeListing(upserted as CourseListingRow),
  });
}
