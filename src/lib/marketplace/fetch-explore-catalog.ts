import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExploreListingCard } from "@/lib/marketplace/types";

export async function fetchExploreCatalog(
  supabase: SupabaseClient
): Promise<{ courses: ExploreListingCard[]; error: string | null }> {
  const [freeRes, paidRes] = await Promise.all([
    supabase
      .from("courses")
      .select("id, title, description, created_at, user_id")
      .eq("is_public", true)
      .eq("is_self_study", false)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("course_listings")
      .select(
        "price_cents, currency, courses!inner(id, title, description, created_at, user_id, is_self_study)"
      )
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(200),
  ]);

  if (freeRes.error && paidRes.error) {
    return { courses: [], error: freeRes.error.message };
  }

  const cards: ExploreListingCard[] = [];

  for (const c of freeRes.data ?? []) {
    cards.push({
      id: c.id,
      title: c.title,
      description: c.description,
      created_at: c.created_at,
      user_id: c.user_id,
      listingKind: "free",
    });
  }

  for (const row of paidRes.data ?? []) {
    const joined = row.courses as
      | {
          id: string;
          title: string;
          description: string | null;
          created_at: string;
          user_id: string;
          is_self_study: boolean;
        }
      | {
          id: string;
          title: string;
          description: string | null;
          created_at: string;
          user_id: string;
          is_self_study: boolean;
        }[]
      | null;
    const course = Array.isArray(joined) ? (joined[0] ?? null) : joined;
    if (!course || course.is_self_study) continue;
    cards.push({
      id: course.id,
      title: course.title,
      description: course.description,
      created_at: course.created_at,
      user_id: course.user_id,
      listingKind: "for_sale",
      price_cents: row.price_cents,
      currency: row.currency,
    });
  }

  const sellerIds = [...new Set(cards.map((c) => c.user_id))];
  if (sellerIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, display_name, username")
      .in("id", sellerIds);
    const byId = new Map(
      (profiles ?? []).map((p) => [p.id, p])
    );
    for (const card of cards) {
      const p = byId.get(card.user_id);
      card.seller_display_name = p?.display_name ?? null;
      card.seller_username = p?.username ?? null;
    }
  }

  cards.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return { courses: cards, error: null };
}
