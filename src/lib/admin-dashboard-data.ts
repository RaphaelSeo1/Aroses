import type { SupabaseClient, User } from "@supabase/supabase-js";

export type AdminActivityKind =
  | "course_created"
  | "user_signed_up"
  | "sign_in"
  | "sign_out"
  | "course_built"
  | "course_deleted"
  | "voice_tutor_started"
  | "voice_tutor_ended"
  | "module_completed"
  | "quiz_submitted"
  | "onboarding_completed"
  | "listing_submitted"
  | "listing_approved"
  | "listing_rejected"
  | "course_purchased"
  | "subscription_admin_updated"
  | "other";

export type AdminActivityItem = {
  id: string;
  kind: AdminActivityKind;
  /** Sub-line: who did it (+ optional context). */
  title: string;
  /** Bold line: human-readable action label. */
  detail: string;
  at: string;
};

/** Human label shown (bold) for each recorded event type. */
const EVENT_LABELS: Record<string, string> = {
  course_created: "Course created",
  user_signed_up: "User signed up",
  sign_in: "Logged in",
  sign_out: "Logged out",
  course_built: "Built a course from upload",
  course_deleted: "Deleted a course",
  voice_tutor_started: "Started voice tutor",
  voice_tutor_ended: "Ended voice tutor",
  module_completed: "Completed a module",
  quiz_submitted: "Submitted a quiz answer",
  onboarding_completed: "Completed onboarding",
  listing_submitted: "Submitted course for sale review",
  listing_approved: "Approved marketplace listing",
  listing_rejected: "Rejected marketplace listing",
  course_purchased: "Purchased a course",
  subscription_admin_updated: "Admin updated subscription",
};

function labelForEvent(type: string): string {
  return (
    EVENT_LABELS[type] ??
    type
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

/** Max events returned to the admin timeline (client renders them in a scroll box). */
const ACTIVITY_LIMIT = 200;

export async function countAllAuthUsers(admin: SupabaseClient): Promise<number> {
  let total = 0;
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[admin] listUsers count", error);
      return total;
    }
    const users = data.users;
    total += users.length;
    if (users.length < perPage) break;
    page += 1;
    if (page > 200) break;
  }
  return total;
}

type ActivityEventRow = {
  id: string;
  user_id: string | null;
  type: string;
  summary: string | null;
  created_at: string;
};

/**
 * Full platform audit log for the admin dashboard.
 *
 * Combines two sources, newest first:
 *   1. The real `activity_events` table — logins, logouts, voice-tutor
 *      sessions, module completions, quiz attempts, course builds/deletes, …
 *   2. Derived events (course creations + sign-ups) read straight from the
 *      `courses` table and the Auth user list, so their full history shows up
 *      even for activity that happened before the audit table existed.
 *
 * Actor emails are resolved from the Auth user list so each row reads
 * "<email> · <context>".
 */
export async function fetchRecentAdminActivity(
  admin: SupabaseClient
): Promise<AdminActivityItem[]> {
  const [{ data: recentCourses }, { data: userList, error: userErr }, eventsRes] =
    await Promise.all([
      admin
        .from("courses")
        .select("id, title, created_at, user_id")
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT),
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin
        .from("activity_events")
        .select("id, user_id, type, summary, created_at")
        .order("created_at", { ascending: false })
        .limit(ACTIVITY_LIMIT),
    ]);

  if (userErr) {
    console.error("[admin] listUsers activity", userErr);
  }

  // Map user id → display email so logged events can show who did them.
  const emailById = new Map<string, string>();
  for (const u of userList?.users ?? []) {
    const email = typeof u.email === "string" ? u.email.trim() : "";
    if (email) emailById.set(u.id, email);
  }

  const items: AdminActivityItem[] = [];

  // 1. Real audit events. The `activity_events` table may not exist yet (before
  //    migration 047) — treat any read error as "no events" and fall back to
  //    the derived history below so the timeline never hard-fails.
  if (eventsRes.error) {
    if (!/relation .*activity_events.* does not exist/i.test(eventsRes.error.message ?? "")) {
      console.error("[admin] activity_events", eventsRes.error);
    }
  } else {
    for (const ev of (eventsRes.data ?? []) as ActivityEventRow[]) {
      if (!ev?.id || !ev.created_at) continue;
      const actor = ev.user_id ? emailById.get(ev.user_id) : null;
      const summary =
        typeof ev.summary === "string" && ev.summary.trim().length > 0
          ? ev.summary.trim()
          : "";
      const title = [actor ?? "A user", summary].filter(Boolean).join(" · ");
      items.push({
        id: `event-${ev.id}`,
        kind: (ev.type as AdminActivityKind) ?? "other",
        title,
        detail: labelForEvent(ev.type),
        at: ev.created_at,
      });
    }
  }

  // 2. Derived: course creations (full history from the courses table).
  for (const c of recentCourses ?? []) {
    if (!c?.id || !c.created_at) continue;
    const courseTitle =
      typeof c.title === "string" && c.title.trim().length > 0
        ? c.title.trim()
        : "Untitled course";
    const actor =
      typeof c.user_id === "string" ? emailById.get(c.user_id) : null;
    const title = [actor, courseTitle].filter(Boolean).join(" · ");
    items.push({
      id: `course-${c.id}-${c.created_at}`,
      kind: "course_created",
      title: title || courseTitle,
      detail: "Course created",
      at: c.created_at,
    });
  }

  // 3. Derived: sign-ups (account creation) from the Auth user list.
  const usersSorted = [...(userList?.users ?? [])].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  for (const u of usersSorted.slice(0, ACTIVITY_LIMIT)) {
    if (!u.created_at) continue;
    const email = typeof u.email === "string" ? u.email.trim() : "";
    items.push({
      id: `user-${u.id}-${u.created_at}`,
      kind: "user_signed_up",
      title: email || "New account",
      detail: "User signed up",
      at: u.created_at,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return items.slice(0, ACTIVITY_LIMIT);
}

/** One row for the admin “User directory” table (Auth email + profile fields). */
export type AdminUserRow = {
  id: string;
  email: string;
  signedUpAt: string;
  lastSignInAt: string | null;
  emailConfirmedAt: string | null;
  displayName: string | null;
  username: string | null;
  onboardingCompletedAt: string | null;
  planTier: "free" | "student" | "advanced" | "premium";
  planStatus: string;
  planAdminGranted: boolean;
};

type ProfileDirRow = {
  id: string;
  display_name: string | null;
  username?: string | null;
  onboarding_completed_at?: string | null;
};

/**
 * All Auth users with sign-in email and optional `profiles` fields.
 * Uses the service-role client only (server-side admin page).
 */
export async function fetchAdminUserDirectory(
  admin: SupabaseClient
): Promise<{ users: AdminUserRow[]; error: string | null }> {
  const allAuth: User[] = [];
  let page = 1;
  const perPage = 1000;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      console.error("[admin] listUsers directory", error);
      return { users: [], error: error.message };
    }
    allAuth.push(...data.users);
    if (data.users.length < perPage) break;
    page += 1;
    if (page > 200) break;
  }

  const profileMap = new Map<string, ProfileDirRow>();
  type SubDirRow = {
    user_id: string;
    tier: string | null;
    status: string | null;
    admin_granted?: boolean | null;
  };
  const subMap = new Map<string, SubDirRow>();
  const ids = allAuth.map((u) => u.id);
  const chunkSize = 150;

  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const full = await admin
      .from("profiles")
      .select("id, display_name, username, onboarding_completed_at")
      .in("id", chunk);

    let rows: ProfileDirRow[] | null = null;
    if (
      full.error &&
      /username|onboarding_completed_at|schema cache/i.test(
        full.error.message ?? ""
      )
    ) {
      const minimal = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", chunk);
      if (minimal.error) {
        console.error("[admin] profiles directory chunk", minimal.error);
        continue;
      }
      rows = (minimal.data ?? []) as ProfileDirRow[];
    } else if (full.error) {
      console.error("[admin] profiles directory chunk", full.error);
      continue;
    } else {
      rows = (full.data ?? []) as ProfileDirRow[];
    }

    for (const row of rows ?? []) {
      if (row?.id) profileMap.set(row.id, row);
    }

    const subsFull = await admin
      .from("user_subscriptions")
      .select("user_id, tier, status, admin_granted")
      .in("user_id", chunk);
    if (
      subsFull.error &&
      /admin_granted|schema cache/i.test(subsFull.error.message ?? "")
    ) {
      const subsLegacy = await admin
        .from("user_subscriptions")
        .select("user_id, tier, status")
        .in("user_id", chunk);
      if (subsLegacy.error) {
        console.error("[admin] subscriptions directory chunk", subsLegacy.error);
      } else {
        for (const row of (subsLegacy.data ?? []) as SubDirRow[]) {
          if (row?.user_id) subMap.set(row.user_id, row);
        }
      }
    } else if (subsFull.error) {
      console.error("[admin] subscriptions directory chunk", subsFull.error);
    } else {
      for (const row of (subsFull.data ?? []) as SubDirRow[]) {
        if (row?.user_id) subMap.set(row.user_id, row);
      }
    }
  }

  const users: AdminUserRow[] = allAuth.map((u) => {
    const pr = profileMap.get(u.id);
    const sub = subMap.get(u.id);
    const email = typeof u.email === "string" ? u.email.trim() : "";
    const tierRaw = (sub?.tier ?? "free").toLowerCase();
    const planTier =
      tierRaw === "student" ||
      tierRaw === "advanced" ||
      tierRaw === "premium"
        ? tierRaw
        : "free";
    return {
      id: u.id,
      email: email.length > 0 ? email : "—",
      signedUpAt: u.created_at,
      lastSignInAt: u.last_sign_in_at ?? null,
      emailConfirmedAt: u.email_confirmed_at ?? null,
      displayName: pr?.display_name ?? null,
      username: pr?.username ?? null,
      onboardingCompletedAt: pr?.onboarding_completed_at ?? null,
      planTier,
      planStatus: (sub?.status ?? "inactive").toLowerCase(),
      planAdminGranted: Boolean(sub?.admin_granted),
    };
  });

  users.sort(
    (a, b) =>
      new Date(b.signedUpAt).getTime() - new Date(a.signedUpAt).getTime()
  );

  return { users, error: null };
}
