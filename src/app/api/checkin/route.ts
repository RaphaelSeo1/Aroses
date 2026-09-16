import { NextResponse } from "next/server";
import { isMissingAuthSessionError } from "@/lib/auth/public-routes";
import { dateKeyInZone } from "@/lib/calendar/dates";
import { grantCheckInPlusMonth } from "@/lib/checkin/grant-plus";
import {
  evaluateCheckIn,
  isValidTimeZone,
  markPlusGranted,
  publicStatusFromState,
} from "@/lib/checkin/logic";
import {
  emptyPublicStatus,
  loadCheckInState,
  saveCheckInState,
  savePlusGrantMarkers,
} from "@/lib/checkin/store";
import type { CheckInPublicStatus, PlusGrantOutcome } from "@/lib/checkin/types";
import { getUserSubscription } from "@/lib/billing/subscription";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { decideWidgetAuth } from "@/lib/supabase/widget-auth";
import { WIDGET_SUPABASE_TIMEOUT_MS } from "@/lib/supabase/bounded-fetch";

export const runtime = "nodejs";

const MIGRATION_HINT =
  "Database is missing daily check-in. In the Supabase SQL Editor, run supabase/migrations/111_daily_checkin.sql, then try again.";

type CheckInResponse = CheckInPublicStatus & {
  plusGranted: boolean;
  plusGrantPeriodEnd: string | null;
  plusGrantSkippedHigherPlan: boolean;
  alreadyCheckedIn: boolean;
  justCheckedIn: boolean;
};

function emptyResponse(
  now: Date,
  timeZone: string,
  extra?: Partial<CheckInResponse>
): CheckInResponse {
  return {
    ...emptyPublicStatus(now, timeZone),
    plusGranted: false,
    plusGrantPeriodEnd: null,
    plusGrantSkippedHigherPlan: false,
    alreadyCheckedIn: false,
    justCheckedIn: false,
    ...extra,
  };
}

function parseTimeZone(raw: unknown, fallback = "UTC"): string {
  if (typeof raw === "string") {
    return isValidTimeZone(raw) ?? fallback;
  }
  return fallback;
}

async function attachPlusPeriod(
  userId: string,
  status: CheckInPublicStatus
): Promise<Pick<CheckInResponse, "plusGrantPeriodEnd">> {
  try {
    const sub = await getUserSubscription(userId);
    if (sub.grantSource === "checkin" && sub.currentPeriodEnd) {
      return { plusGrantPeriodEnd: sub.currentPeriodEnd };
    }
  } catch {
    /* ignore */
  }
  if (status.lastPlusGrantedOnDate) {
    return { plusGrantPeriodEnd: null };
  }
  return { plusGrantPeriodEnd: null };
}

async function applyPendingPlusGrant(
  userId: string,
  status: CheckInPublicStatus,
  state: Awaited<ReturnType<typeof loadCheckInState>>["state"]
): Promise<{
  status: CheckInPublicStatus;
  grant: PlusGrantOutcome;
  state: NonNullable<typeof state> | null;
}> {
  const notAttempted: PlusGrantOutcome = {
    applied: false,
    reason: "not_attempted",
  };
  if (!status.pendingPlusGrant || !state) {
    return { status, grant: notAttempted, state };
  }
  const grant = await grantCheckInPlusMonth(userId);
  if (!grant.applied) {
    return { status, grant, state };
  }
  const marked = markPlusGranted(state, new Date());
  const admin = createAdminClient();
  if (admin) {
    await savePlusGrantMarkers(admin, userId, marked);
  }
  return {
    status: {
      ...status,
      plusGrants: marked.plusGrants,
      lastPlusGrantedOnDate: marked.lastPlusGrantedOnDate,
      pendingPlusGrant: false,
    },
    grant,
    state: marked,
  };
}

/** Status for the header chip and home card. Guests get an empty payload. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const timeZone = parseTimeZone(url.searchParams.get("tz"));
  const now = new Date();
  const empty = emptyResponse(now, timeZone);

  const supabase = await createClient({ timeoutMs: WIDGET_SUPABASE_TIMEOUT_MS });
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  const auth = decideWidgetAuth(user, authError);
  if (auth !== "proceed" || !user) {
    if (authError && !isMissingAuthSessionError(authError)) {
      console.error("[checkin GET] auth unavailable:", authError.message);
    }
    if (auth === "unavailable") {
      return NextResponse.json(
        { error: "Authentication service temporarily unavailable." },
        { status: 503, headers: { "Retry-After": "5" } }
      );
    }
    return NextResponse.json(empty);
  }

  const { state, missingTable } = await loadCheckInState(supabase, user.id);
  if (missingTable) return NextResponse.json(empty);

  const tz = isValidTimeZone(timeZone) ?? state?.timezone ?? "UTC";
  const today = dateKeyInZone(now, tz);
  let status = publicStatusFromState(state, today, tz);
  const pending = await applyPendingPlusGrant(user.id, status, state);
  status = pending.status;
  const plus = await attachPlusPeriod(user.id, status);

  return NextResponse.json({
    ...status,
    plusGranted: pending.grant.applied,
    plusGrantPeriodEnd:
      pending.grant.applied && pending.grant.periodEnd
        ? pending.grant.periodEnd
        : plus.plusGrantPeriodEnd,
    plusGrantSkippedHigherPlan:
      !pending.grant.applied && pending.grant.reason === "already_plus_or_higher",
    alreadyCheckedIn: status.checkedInToday,
    justCheckedIn: false,
  } satisfies CheckInResponse);
}

/** Record today's check-in. Server decides the local date and streak. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const timeZone = parseTimeZone(
    typeof body === "object" && body && "timeZone" in body
      ? (body as { timeZone?: unknown }).timeZone
      : undefined
  );
  const now = new Date();
  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server misconfigured." },
      { status: 503 }
    );
  }

  const { state, missingTable } = await loadCheckInState(admin, user.id);
  if (missingTable) {
    return NextResponse.json(
      { error: MIGRATION_HINT, code: "schema_migration" },
      { status: 503 }
    );
  }

  const evaluated = evaluateCheckIn({ prev: state, now, timeZone });

  if (!evaluated.ok && evaluated.reason === "already_checked_in") {
    const today = evaluated.today ?? dateKeyInZone(now, timeZone);
    let status = publicStatusFromState(state, today, timeZone);
    const pending = await applyPendingPlusGrant(user.id, status, state);
    status = pending.status;
    const plus = await attachPlusPeriod(user.id, status);
    return NextResponse.json({
      ...status,
      plusGranted: pending.grant.applied,
      plusGrantPeriodEnd:
        pending.grant.applied && pending.grant.periodEnd
          ? pending.grant.periodEnd
          : plus.plusGrantPeriodEnd,
      plusGrantSkippedHigherPlan:
        !pending.grant.applied && pending.grant.reason === "already_plus_or_higher",
      alreadyCheckedIn: true,
      justCheckedIn: false,
    } satisfies CheckInResponse);
  }

  if (!evaluated.ok) {
    const status = 400;
    const message =
      evaluated.reason === "invalid_timezone"
        ? "Timezone is invalid."
        : evaluated.reason === "timezone_abuse"
          ? "Check-in uses your local calendar day. Try again later."
          : "Could not check in.";
    return NextResponse.json({ error: message, code: evaluated.reason }, { status });
  }

  const saved = await saveCheckInState(
    admin,
    user.id,
    evaluated.next,
    state?.lastCheckinDate ?? null
  );
  if (!saved.ok) {
    if (saved.conflict) {
      const { state: latest } = await loadCheckInState(admin, user.id);
      const today = evaluated.today;
      let status = publicStatusFromState(latest, today, evaluated.timeZone);
      const pending = await applyPendingPlusGrant(user.id, status, latest);
      status = pending.status;
      const plus = await attachPlusPeriod(user.id, status);
      return NextResponse.json({
        ...status,
        plusGranted: pending.grant.applied,
        plusGrantPeriodEnd:
          pending.grant.applied && pending.grant.periodEnd
            ? pending.grant.periodEnd
            : plus.plusGrantPeriodEnd,
        plusGrantSkippedHigherPlan:
          !pending.grant.applied && pending.grant.reason === "already_plus_or_higher",
        alreadyCheckedIn: true,
        justCheckedIn: false,
      } satisfies CheckInResponse);
    }
    return NextResponse.json({ error: "Could not check in." }, { status: 500 });
  }

  let nextState = evaluated.next;
  let grant: PlusGrantOutcome = { applied: false, reason: "not_attempted" };
  if (evaluated.shouldGrantPlus) {
    grant = await grantCheckInPlusMonth(user.id);
    if (grant.applied) {
      nextState = markPlusGranted(evaluated.next, now);
      await savePlusGrantMarkers(admin, user.id, nextState);
    }
  }

  const status = publicStatusFromState(
    nextState,
    evaluated.today,
    evaluated.timeZone
  );
  const plus = await attachPlusPeriod(user.id, status);

  return NextResponse.json({
    ...status,
    plusGranted: grant.applied,
    plusGrantPeriodEnd:
      grant.applied && grant.periodEnd ? grant.periodEnd : plus.plusGrantPeriodEnd,
    plusGrantSkippedHigherPlan:
      !grant.applied && grant.reason === "already_plus_or_higher",
    alreadyCheckedIn: false,
    justCheckedIn: true,
  } satisfies CheckInResponse);
}
