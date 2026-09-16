import assert from "node:assert/strict";
import test from "node:test";
import { addCalendarDays } from "../calendar/dates.ts";
import {
  displayStreak,
  evaluateCheckIn,
  markPlusGranted,
  publicStatusFromState,
} from "./logic.ts";
import { plusGrantSkipReason, shouldGrantPlusForStreak } from "./plus-grant.ts";
import type { CheckInState } from "./types.ts";

const TZ = "America/Los_Angeles";

function stateFromOk(now: Date, prev: CheckInState | null = null): CheckInState {
  const result = evaluateCheckIn({ prev, now, timeZone: TZ });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  return result.next;
}

test("first check-in starts a 1-day streak on the local calendar date", () => {
  // 18:00 UTC = 11:00 PDT on 10 Mar 2026.
  const now = new Date("2026-03-10T18:00:00.000Z");
  const result = evaluateCheckIn({ prev: null, now, timeZone: TZ });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.today, "2026-03-10");
  assert.equal(result.next.currentStreak, 1);
  assert.equal(result.next.longestStreak, 1);
  assert.equal(result.shouldGrantPlus, false);
});

test("second check-in on the same local day is rejected", () => {
  const morning = new Date("2026-03-10T18:00:00.000Z");
  const prev = stateFromOk(morning);
  const later = new Date("2026-03-11T06:30:00.000Z"); // still 10 Mar in LA (UTC-7)
  const result = evaluateCheckIn({ prev, now: later, timeZone: TZ });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "already_checked_in");
  assert.equal(result.today, "2026-03-10");
});

test("next local day increments the streak", () => {
  const day1 = stateFromOk(new Date("2026-03-10T18:00:00.000Z"));
  const result = evaluateCheckIn({
    prev: day1,
    now: new Date("2026-03-11T18:00:00.000Z"),
    timeZone: TZ,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.today, "2026-03-11");
  assert.equal(result.next.currentStreak, 2);
  assert.equal(result.next.totalCheckins, 2);
});

test("skipping a local day resets the streak to 1 and keeps longest", () => {
  let prev: CheckInState | null = null;
  prev = stateFromOk(new Date("2026-03-10T18:00:00.000Z"), prev);
  prev = stateFromOk(new Date("2026-03-11T18:00:00.000Z"), prev);
  const result = evaluateCheckIn({
    prev,
    now: new Date("2026-03-13T18:00:00.000Z"),
    timeZone: TZ,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.next.currentStreak, 1);
  assert.equal(result.next.longestStreak, 2);
  assert.equal(result.next.totalCheckins, 3);
});

test("local midnight is the day boundary, not UTC midnight", () => {
  const evening = stateFromOk(new Date("2026-03-11T06:59:00.000Z"));
  assert.equal(evening.lastCheckinDate, "2026-03-10");
  const afterMidnight = evaluateCheckIn({
    prev: evening,
    now: new Date("2026-03-11T07:00:00.000Z"),
    timeZone: TZ,
  });
  assert.equal(afterMidnight.ok, true);
  if (!afterMidnight.ok) return;
  assert.equal(afterMidnight.today, "2026-03-11");
  assert.equal(afterMidnight.next.currentStreak, 2);
});

test("display streak stays alive until the local day after last check-in", () => {
  const prev = stateFromOk(new Date("2026-03-10T18:00:00.000Z"));
  assert.equal(displayStreak(prev, "2026-03-10"), 1);
  assert.equal(displayStreak(prev, "2026-03-11"), 1);
  assert.equal(displayStreak(prev, "2026-03-12"), 0);
});

test("timezone hop within 12 hours that would mint an extra day is rejected", () => {
  const prev = stateFromOk(new Date("2026-03-10T18:00:00.000Z"));
  const hop = evaluateCheckIn({
    prev,
    now: new Date("2026-03-10T18:05:00.000Z"),
    timeZone: "Pacific/Kiritimati",
  });
  assert.equal(hop.ok, false);
  if (hop.ok) return;
  assert.equal(hop.reason, "timezone_abuse");
});

test("invalid timezone fails closed", () => {
  const result = evaluateCheckIn({
    prev: null,
    now: new Date("2026-03-10T18:00:00.000Z"),
    timeZone: "Not/AZone",
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, "invalid_timezone");
});

test("Plus is granted only on the 30th day of a streak, once", () => {
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 29,
      lastPlusGrantedOnDate: null,
      today: "2026-04-29",
    }),
    false
  );
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 30,
      lastPlusGrantedOnDate: null,
      today: "2026-04-30",
    }),
    true
  );
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 30,
      lastPlusGrantedOnDate: "2026-04-30",
      today: "2026-04-30",
    }),
    false
  );
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 31,
      lastPlusGrantedOnDate: "2026-04-30",
      today: "2026-05-01",
    }),
    false
  );
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 30,
      lastPlusGrantedOnDate: "2026-04-30",
      today: "2026-06-15",
    }),
    true
  );
});

test("a rebuilt streak after a miss can earn Plus again", () => {
  const start = addCalendarDays("2026-06-15", -29);
  assert.equal(start, "2026-05-17");
  assert.equal(
    shouldGrantPlusForStreak({
      nextStreak: 30,
      lastPlusGrantedOnDate: "2026-04-30",
      today: "2026-06-15",
    }),
    true
  );
});

test("evaluateCheckIn flags Plus on the 30th consecutive day only", () => {
  let prev: CheckInState | null = null;
  for (let i = 0; i < 29; i++) {
    const day = addCalendarDays("2026-03-10", i);
    const now = new Date(`${day}T18:00:00.000Z`);
    const result = evaluateCheckIn({ prev, now, timeZone: "UTC" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.shouldGrantPlus, false);
    prev = result.next;
  }
  const day30 = evaluateCheckIn({
    prev,
    now: new Date("2026-04-08T18:00:00.000Z"),
    timeZone: "UTC",
  });
  assert.equal(day30.ok, true);
  if (!day30.ok) return;
  assert.equal(day30.next.currentStreak, 30);
  assert.equal(day30.shouldGrantPlus, true);

  const granted = markPlusGranted(day30.next, new Date("2026-04-08T18:00:00.000Z"));
  const day31 = evaluateCheckIn({
    prev: granted,
    now: new Date("2026-04-09T18:00:00.000Z"),
    timeZone: "UTC",
  });
  assert.equal(day31.ok, true);
  if (!day31.ok) return;
  assert.equal(day31.next.currentStreak, 31);
  assert.equal(day31.shouldGrantPlus, false);
});

test("Plus grant skips Plus/Advanced/Premium and does not skip free/basic/student", () => {
  assert.equal(
    plusGrantSkipReason({
      tier: "premium",
      status: "inactive",
      adminGranted: true,
    }),
    "already_plus_or_higher"
  );
  assert.equal(
    plusGrantSkipReason({
      tier: "advanced",
      status: "active",
      adminGranted: false,
    }),
    "already_plus_or_higher"
  );
  assert.equal(
    plusGrantSkipReason({
      tier: "plus",
      status: "active",
      adminGranted: false,
    }),
    "already_plus_or_higher"
  );
  assert.equal(
    plusGrantSkipReason({
      tier: "student",
      status: "active",
      adminGranted: false,
    }),
    null
  );
  assert.equal(
    plusGrantSkipReason({
      tier: "basic",
      status: "active",
      adminGranted: false,
    }),
    null
  );
  assert.equal(
    plusGrantSkipReason({
      tier: "free",
      status: "inactive",
      adminGranted: false,
    }),
    null
  );
});

test("expired check-in Plus does not block a later grant", () => {
  assert.equal(
    plusGrantSkipReason(
      {
        tier: "plus",
        status: "active",
        adminGranted: true,
        grantSource: "checkin",
        currentPeriodEnd: "2020-01-01T00:00:00.000Z",
      },
      new Date("2026-09-16T00:00:00.000Z")
    ),
    null
  );
});

test("public status shows progress toward 30 and a pending grant on day 30", () => {
  const status = publicStatusFromState(
    {
      lastCheckinDate: "2026-04-08",
      lastCheckinAt: "2026-04-08T18:00:00.000Z",
      timezone: "UTC",
      currentStreak: 12,
      longestStreak: 12,
      totalCheckins: 12,
      plusGrants: 0,
      lastPlusGrantedOnDate: null,
      lastPlusGrantedAt: null,
    },
    "2026-04-08",
    "UTC"
  );
  assert.equal(status.checkedInToday, true);
  assert.equal(status.goalProgress, 12);
  assert.equal(status.goal, 30);
  assert.equal(status.pendingPlusGrant, false);
});
