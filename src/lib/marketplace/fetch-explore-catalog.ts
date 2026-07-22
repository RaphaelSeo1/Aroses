import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExploreListingCard } from "@/lib/marketplace/types";
import { isMarketplaceUiEnabled } from "@/lib/marketplace/feature-flag";

function isMissingColumnError(err: { message?: string; code?: string } | null) {
  if (!err) return false;
  return (
    err.code === "42703" ||
    /school_name|show_school_label|schema cache|column .* does not exist/i.test(
      err.message ?? ""
    )
  );
}

export async function fetchExploreCatalog(
  supabase: SupabaseClient
): Promise<{ courses: ExploreListingCard[]; error: string | null }> {
  const includePaid = isMarketplaceUiEnabled();

  let freeData: Record<string, unknown>[] | null = null;
  let freeError: { message: string; code?: string } | null = null;

  {
    const full = await supabase
      .from("courses")
      .select(
        "id, title, description, created_at, user_id, school_name, show_school_label"
      )
      .eq("is_public", true)
      .eq("is_self_study", false)
      .order("created_at", { ascending: false })
      .limit(200);

    if (!full.error) {
      freeData = (full.data as Record<string, unknown>[] | null) ?? [];
    } else if (isMissingColumnError(full.error)) {
      const mid = await supabase
        .from("courses")
        .select("id, title, description, created_at, user_id, school_name")
        .eq("is_public", true)
        .eq("is_self_study", false)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!mid.error) {
        freeData = (mid.data as Record<string, unknown>[] | null) ?? [];
      } else if (isMissingColumnError(mid.error)) {
        const plain = await supabase
          .from("courses")
          .select("id, title, description, created_at, user_id")
          .eq("is_public", true)
          .eq("is_self_study", false)
          .order("created_at", { ascending: false })
          .limit(200);
        freeData = (plain.data as Record<string, unknown>[] | null) ?? [];
        freeError = plain.error;
      } else {
        freeError = mid.error;
      }
    } else {
      freeError = full.error;
    }
  }

  type CourseBits = {
    id: string;
    title: string;
    description: string | null;
    created_at: string;
    user_id: string;
    is_self_study?: boolean;
    school_name?: string | null;
    show_school_label?: boolean | null;
  };

  let paidData: {
    price_cents: number;
    currency: string;
    courses: unknown;
  }[] = [];
  let paidError: { message: string; code?: string } | null = null;

  if (includePaid) {
    const paidSelectFull =
      "price_cents, currency, courses!inner(id, title, description, created_at, user_id, is_self_study, school_name, show_school_label)";
    const paidSelectSchool =
      "price_cents, currency, courses!inner(id, title, description, created_at, user_id, is_self_study, school_name)";
    const paidSelectPlain =
      "price_cents, currency, courses!inner(id, title, description, created_at, user_id, is_self_study)";

    const full = await supabase
      .from("course_listings")
      .select(paidSelectFull)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(200);

    if (!full.error) {
      paidData = (full.data ?? []) as typeof paidData;
    } else if (isMissingColumnError(full.error)) {
      const mid = await supabase
        .from("course_listings")
        .select(paidSelectSchool)
        .eq("status", "approved")
        .order("approved_at", { ascending: false })
        .limit(200);
      if (!mid.error) {
        paidData = (mid.data ?? []) as typeof paidData;
      } else if (isMissingColumnError(mid.error)) {
        const plain = await supabase
          .from("course_listings")
          .select(paidSelectPlain)
          .eq("status", "approved")
          .order("approved_at", { ascending: false })
          .limit(200);
        paidData = (plain.data ?? []) as typeof paidData;
        paidError = plain.error;
      } else {
        paidError = mid.error;
      }
    } else {
      paidError = full.error;
    }
  }

  if (freeError && paidError) {
    return { courses: [], error: freeError.message };
  }

  const cards: ExploreListingCard[] = [];
  const courseSchoolTag = new Map<string, string | null>();
  const courseShowSchool = new Map<string, boolean>();

  for (const c of freeData ?? []) {
    const id = String(c.id);
    const rawSchool = c.school_name;
    const tagged =
      typeof rawSchool === "string" ? rawSchool.trim() || null : null;
    courseSchoolTag.set(id, tagged);
    courseShowSchool.set(
      id,
      c.show_school_label === undefined || c.show_school_label === null
        ? true
        : Boolean(c.show_school_label)
    );
    cards.push({
      id,
      title: String(c.title ?? ""),
      description: (c.description as string | null) ?? null,
      created_at: String(c.created_at ?? ""),
      user_id: String(c.user_id ?? ""),
      listingKind: "free",
    });
  }

  for (const row of paidData ?? []) {
    const joined = row.courses as CourseBits | CourseBits[] | null;
    const course = Array.isArray(joined) ? (joined[0] ?? null) : joined;
    if (!course || course.is_self_study) continue;
    const tagged =
      typeof course.school_name === "string"
        ? course.school_name.trim() || null
        : null;
    courseSchoolTag.set(course.id, tagged);
    courseShowSchool.set(
      course.id,
      course.show_school_label === undefined || course.show_school_label === null
        ? true
        : Boolean(course.show_school_label)
    );
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
    const withSchool = await supabase
      .from("profiles")
      .select("id, display_name, username, school_name")
      .in("id", sellerIds);

    const profiles =
      withSchool.error && isMissingColumnError(withSchool.error)
        ? (
            await supabase
              .from("profiles")
              .select("id, display_name, username")
              .in("id", sellerIds)
          ).data
        : withSchool.data;

    const byId = new Map(
      (profiles ?? []).map((p) => [
        p.id,
        p as {
          id: string;
          display_name: string | null;
          username: string | null;
          school_name?: string | null;
        },
      ])
    );
    for (const card of cards) {
      const p = byId.get(card.user_id);
      card.seller_display_name = p?.display_name ?? null;
      card.seller_username = p?.username ?? null;

      const showLabel = courseShowSchool.get(card.id) !== false;
      if (!showLabel) {
        card.school_name = null;
        card.school_source = null;
        continue;
      }

      const tagged = courseSchoolTag.get(card.id) ?? null;
      const creatorSchool =
        typeof p?.school_name === "string" && p.school_name.trim()
          ? p.school_name.trim()
          : null;
      if (tagged) {
        card.school_name = tagged;
        card.school_source = "tagged";
      } else if (creatorSchool) {
        card.school_name = creatorSchool;
        card.school_source = "creator";
      } else {
        card.school_name = null;
        card.school_source = null;
      }
    }
  }

  cards.sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  return { courses: cards, error: null };
}
