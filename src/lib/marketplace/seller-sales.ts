import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type SellerSaleRow = {
  id: string;
  courseId: string;
  courseTitle: string;
  buyerUserId: string;
  buyerLabel: string;
  priceCents: number;
  platformFeeCents: number;
  netCents: number;
  currency: string;
  status: "completed" | "refunded" | "pending";
  purchasedAt: string | null;
};

export type SellerCourseSalesSummary = {
  courseId: string;
  courseTitle: string;
  listingStatus: string | null;
  priceCents: number | null;
  currency: string;
  saleCount: number;
  grossCents: number;
  netCents: number;
};

export type SellerSalesAnalytics = {
  sales: SellerSaleRow[];
  byCourse: SellerCourseSalesSummary[];
  totals: {
    saleCount: number;
    grossCents: number;
    feeCents: number;
    netCents: number;
    currency: string;
  };
  payoutsReady: boolean;
};

type PurchaseJoin = {
  id: string;
  course_id: string;
  buyer_user_id: string;
  price_cents: number;
  platform_fee_cents: number;
  currency: string;
  status: string;
  purchased_at: string | null;
  courses: { title: string } | { title: string }[] | null;
};

function courseTitleFromJoin(
  courses: PurchaseJoin["courses"],
  fallback: string
): string {
  if (!courses) return fallback;
  if (Array.isArray(courses)) return courses[0]?.title?.trim() || fallback;
  return courses.title?.trim() || fallback;
}

function buyerLabelFromProfile(profile: {
  display_name: string | null;
  username: string | null;
} | null): string {
  if (!profile) return "Learner";
  if (profile.username?.trim()) return `@${profile.username.trim()}`;
  if (profile.display_name?.trim()) return profile.display_name.trim();
  return "Learner";
}

async function loadBuyerLabels(
  buyerIds: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(buyerIds.filter(Boolean))];
  if (unique.length === 0) return map;

  const admin = createAdminClient();
  if (!admin) {
    for (const id of unique) map.set(id, "Learner");
    return map;
  }

  const { data } = await admin
    .from("profiles")
    .select("id, display_name, username")
    .in("id", unique);

  for (const id of unique) {
    const row = (data ?? []).find((p) => p.id === id) ?? null;
    map.set(
      id,
      buyerLabelFromProfile(
        row
          ? {
              display_name: row.display_name,
              username: row.username,
            }
          : null
      )
    );
  }
  return map;
}

/**
 * Seller-facing sales analytics from `course_purchases` (RLS: own rows only).
 * Buyer display names are loaded via service role (profiles aren't otherwise
 * readable for non-friends). Includes listed courses with zero sales.
 */
export async function loadSellerSalesAnalytics(
  supabase: SupabaseClient,
  sellerUserId: string
): Promise<SellerSalesAnalytics> {
  const [{ data: purchaseRows }, { data: listingRows }, { data: payoutRow }] =
    await Promise.all([
      supabase
        .from("course_purchases")
        .select(
          "id, course_id, buyer_user_id, price_cents, platform_fee_cents, currency, status, purchased_at, courses(title)"
        )
        .eq("seller_user_id", sellerUserId)
        .in("status", ["completed", "refunded"])
        .order("purchased_at", { ascending: false }),
      supabase
        .from("course_listings")
        .select("course_id, status, price_cents, currency, courses(title)")
        .eq("seller_user_id", sellerUserId)
        .in("status", ["approved", "pending_review", "rejected"]),
      supabase
        .from("seller_payout_accounts")
        .select("charges_enabled, details_submitted")
        .eq("user_id", sellerUserId)
        .maybeSingle(),
    ]);

  const buyerLabels = await loadBuyerLabels(
    (purchaseRows ?? []).map((r) => (r as PurchaseJoin).buyer_user_id)
  );

  const sales: SellerSaleRow[] = (purchaseRows ?? []).map((row) => {
    const r = row as PurchaseJoin;
    const priceCents = r.price_cents ?? 0;
    const platformFeeCents = r.platform_fee_cents ?? 0;
    const buyerUserId = r.buyer_user_id;
    return {
      id: r.id,
      courseId: r.course_id,
      courseTitle: courseTitleFromJoin(r.courses, "Course"),
      buyerUserId,
      buyerLabel: buyerLabels.get(buyerUserId) ?? "Learner",
      priceCents,
      platformFeeCents,
      netCents: Math.max(0, priceCents - platformFeeCents),
      currency: (r.currency ?? "usd").toLowerCase(),
      status: (r.status as SellerSaleRow["status"]) ?? "completed",
      purchasedAt: r.purchased_at,
    };
  });

  const byCourseMap = new Map<string, SellerCourseSalesSummary>();

  for (const listing of listingRows ?? []) {
    const courseId = listing.course_id as string;
    const courses = listing.courses as PurchaseJoin["courses"];
    byCourseMap.set(courseId, {
      courseId,
      courseTitle: courseTitleFromJoin(courses, "Course"),
      listingStatus: (listing.status as string) ?? null,
      priceCents:
        typeof listing.price_cents === "number" ? listing.price_cents : null,
      currency: String(listing.currency ?? "usd").toLowerCase(),
      saleCount: 0,
      grossCents: 0,
      netCents: 0,
    });
  }

  for (const sale of sales) {
    if (sale.status !== "completed") continue;
    const existing = byCourseMap.get(sale.courseId);
    if (existing) {
      existing.saleCount += 1;
      existing.grossCents += sale.priceCents;
      existing.netCents += sale.netCents;
      if (!existing.courseTitle || existing.courseTitle === "Course") {
        existing.courseTitle = sale.courseTitle;
      }
    } else {
      byCourseMap.set(sale.courseId, {
        courseId: sale.courseId,
        courseTitle: sale.courseTitle,
        listingStatus: null,
        priceCents: sale.priceCents,
        currency: sale.currency,
        saleCount: 1,
        grossCents: sale.priceCents,
        netCents: sale.netCents,
      });
    }
  }

  const byCourse = [...byCourseMap.values()].sort((a, b) => {
    if (b.saleCount !== a.saleCount) return b.saleCount - a.saleCount;
    return a.courseTitle.localeCompare(b.courseTitle);
  });

  const completed = sales.filter((s) => s.status === "completed");
  const currency = completed[0]?.currency ?? byCourse[0]?.currency ?? "usd";

  return {
    sales,
    byCourse,
    totals: {
      saleCount: completed.length,
      grossCents: completed.reduce((sum, s) => sum + s.priceCents, 0),
      feeCents: completed.reduce((sum, s) => sum + s.platformFeeCents, 0),
      netCents: completed.reduce((sum, s) => sum + s.netCents, 0),
      currency,
    },
    payoutsReady: Boolean(
      payoutRow?.charges_enabled && payoutRow?.details_submitted
    ),
  };
}
