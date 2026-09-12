import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  isPaidPlanTier,
  listPriceCentsForTier,
  sortAdminPlanSubscriptionRows,
  startedAtFromSubscription,
  subscriberLabelFromParts,
  type AdminPlanSubscriptionRow,
  type PaidPlanTier,
} from "@/lib/billing/admin-plan-subscription-rows";

export type { AdminPlanSubscriptionRow, PaidPlanTier };

type SubRow = {
  user_id: string;
  tier: string;
  status: string;
  current_period_start: string | null;
  current_period_end: string | null;
  updated_at: string | null;
  cancel_at_period_end: boolean | null;
  admin_granted?: boolean | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
};

const SUB_SELECT =
  "user_id, tier, status, current_period_start, current_period_end, updated_at, cancel_at_period_end, admin_granted";
const SUB_SELECT_LEGACY =
  "user_id, tier, status, current_period_start, current_period_end, updated_at, cancel_at_period_end";

async function loadAuthEmails(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const emails = new Map<string, string | null>();
  const unique = [...new Set(userIds.filter(Boolean))];
  const chunkSize = 20;
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map((id) => admin.auth.admin.getUserById(id))
    );
    for (let j = 0; j < chunk.length; j += 1) {
      const id = chunk[j];
      const res = results[j];
      if (res.error || !res.data.user) {
        emails.set(id, null);
        continue;
      }
      const email = res.data.user.email?.trim() ?? "";
      emails.set(id, email.length > 0 ? email : null);
    }
  }
  return emails;
}

/**
 * Current Student / Advanced / Premium rows from `user_subscriptions`
 * (Stripe webhook snapshot). One row per user — period start is the
 * started/renewed date we store.
 */
export async function loadAdminPlanSubscriptions(): Promise<
  AdminPlanSubscriptionRow[]
> {
  const admin = createAdminClient();
  if (!admin) return [];

  const full = await admin
    .from("user_subscriptions")
    .select(SUB_SELECT)
    .in("tier", ["student", "advanced", "premium"]);

  let rows: SubRow[] | null = null;
  if (full.error && /admin_granted|schema cache/i.test(full.error.message ?? "")) {
    const legacy = await admin
      .from("user_subscriptions")
      .select(SUB_SELECT_LEGACY)
      .in("tier", ["student", "advanced", "premium"]);
    if (legacy.error) {
      console.error("[admin plan subscriptions]", legacy.error);
      return [];
    }
    rows = (legacy.data ?? []) as SubRow[];
  } else if (full.error) {
    console.error("[admin plan subscriptions]", full.error);
    return [];
  } else {
    rows = (full.data ?? []) as SubRow[];
  }

  const subs = (rows ?? []).filter((row) => isPaidPlanTier(row.tier));
  if (subs.length === 0) return [];

  const userIds = subs.map((row) => row.user_id);
  const [emailMap, profilesRes] = await Promise.all([
    loadAuthEmails(admin, userIds),
    admin
      .from("profiles")
      .select("id, display_name, username")
      .in("id", userIds),
  ]);

  if (profilesRes.error) {
    console.error("[admin plan subscriptions] profiles", profilesRes.error);
  }

  const profileMap = new Map<string, ProfileRow>();
  for (const row of (profilesRes.data ?? []) as ProfileRow[]) {
    if (row?.id) profileMap.set(row.id, row);
  }

  const mapped: AdminPlanSubscriptionRow[] = subs.map((row) => {
    const tier = row.tier.toLowerCase() as PaidPlanTier;
    const profile = profileMap.get(row.user_id);
    const email = emailMap.get(row.user_id) ?? null;
    return {
      userId: row.user_id,
      email,
      displayName: profile?.display_name?.trim() || null,
      subscriberLabel: subscriberLabelFromParts({
        email,
        displayName: profile?.display_name,
        username: profile?.username,
      }),
      tier,
      amountCents: listPriceCentsForTier(tier),
      currency: "usd",
      status: (row.status ?? "inactive").toLowerCase(),
      startedAt: startedAtFromSubscription({
        currentPeriodStart: row.current_period_start,
        updatedAt: row.updated_at,
      }),
      periodEnd: row.current_period_end,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      adminGranted: Boolean(row.admin_granted),
    };
  });

  return sortAdminPlanSubscriptionRows(mapped);
}
