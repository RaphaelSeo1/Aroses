import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryChatMeterStore, type ChatMeterStore } from "./chat-limits.ts";
import {
  nextUtcDayStart,
  reserveExtraQuestionQuota,
  utcDayStart,
} from "./extra-questions.ts";

const USER = "user-1";
const SEPT = { startIso: "2026-09-01T00:00:00.000Z", endIso: "2026-10-01T00:00:00.000Z" };
const OCT = { startIso: "2026-10-01T00:00:00.000Z", endIso: "2026-11-01T00:00:00.000Z" };
const NO_ENV = {};

function reserve(
  store: ChatMeterStore | null,
  opts: Partial<Parameters<typeof reserveExtraQuestionQuota>[1]> = {}
) {
  return reserveExtraQuestionQuota(store, {
    userId: USER,
    tier: "lite",
    period: SEPT,
    unlimited: false,
    env: NO_ENV,
    ...opts,
  });
}

test("each paid tier gets its monthly extra-question clicks, then a friendly block", async () => {
  const caps = { lite: 50, student: 120, plus: 250, pro: 500, max: 1000 } as const;
  for (const [tier, cap] of Object.entries(caps) as [keyof typeof caps, number][]) {
    const store = new InMemoryChatMeterStore();
    for (let i = 0; i < cap; i++) {
      const q = await reserve(store, { tier });
      assert.equal(q.allowed, true, `${tier} click ${i + 1}`);
    }
    const blocked = await reserve(store, { tier });
    assert.equal(blocked.allowed, false, tier);
    if (!blocked.allowed) {
      assert.equal(blocked.cap, cap);
      assert.equal(blocked.used, cap);
      assert.equal(blocked.resetsAt, SEPT.endIso);
      assert.equal(blocked.reason, "monthly");
      assert.match(blocked.message, new RegExp(`all ${cap.toLocaleString("en-US")} extra question sets`));
      assert.match(blocked.message, /reset on October 1/);
      if (tier === "max") assert.doesNotMatch(blocked.message, /Upgrade/);
      else assert.match(blocked.message, /Upgrade your plan/);
    }
  }
});

test("free accounts are blocked with a choose-a-plan message", async () => {
  const q = await reserve(new InMemoryChatMeterStore(), { tier: "free" });
  assert.equal(q.allowed, false);
  if (!q.allowed) assert.match(q.message, /Choose a plan/);
});

test("a failed generation refunds its click (once)", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { PLAN_LIMIT_LITE_EXTRA_QUESTIONS: "5" };
  for (let i = 0; i < 4; i++) await reserve(store, { env });
  const last = await reserve(store, { env });
  assert.equal(last.allowed, true);
  if (last.allowed) {
    await last.refund();
    await last.refund();
  }
  const again = await reserve(store, { env });
  assert.equal(again.allowed, true);
  const over = await reserve(store, { env });
  assert.equal(over.allowed, false);
});

test("a new billing period resets the clicks", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { PLAN_LIMIT_LITE_EXTRA_QUESTIONS: "5" };
  for (let i = 0; i < 5; i++) await reserve(store, { env });
  assert.equal((await reserve(store, { env })).allowed, false);
  assert.equal((await reserve(store, { env, period: OCT })).allowed, true);
});

test("fails open when the meter is missing or errors, and admins are unmetered", async () => {
  const noStore = await reserve(null);
  assert.equal(noStore.allowed, true);
  if (noStore.allowed) assert.equal(noStore.metered, false);

  const errors: unknown[] = [];
  const broken: ChatMeterStore = {
    reserve: async () => {
      throw new Error("plan_meter_reserve missing");
    },
    refund: async () => {},
  };
  const q = await reserve(broken, { onStoreError: (e) => errors.push(e) });
  assert.equal(q.allowed, true);
  assert.equal(errors.length, 1);

  const store = new InMemoryChatMeterStore();
  for (let i = 0; i < 20; i++) {
    const admin = await reserve(store, { tier: "free", unlimited: true });
    assert.equal(admin.allowed, true);
  }
});

test("PLAN_LIMIT_<TIER>_EXTRA_QUESTIONS overrides the cap", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { PLAN_LIMIT_LITE_EXTRA_QUESTIONS: "1" };
  assert.equal((await reserve(store, { env })).allowed, true);
  assert.equal((await reserve(store, { env })).allowed, false);
});

const NOON = new Date("2026-09-15T12:00:00.000Z");

test("daily cap: 60 clicks per UTC day across both tools, then a friendly block", async () => {
  const monthly = new InMemoryChatMeterStore();
  const daily = new InMemoryChatMeterStore();
  for (let i = 0; i < 60; i++) {
    const q = await reserve(monthly, { tier: "max", dailyStore: daily, now: NOON });
    assert.equal(q.allowed, true, `click ${i + 1}`);
  }
  const blocked = await reserve(monthly, { tier: "max", dailyStore: daily, now: NOON });
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.reason, "daily");
    assert.equal(blocked.cap, 60);
    assert.equal(blocked.resetsAt, "2026-09-16T00:00:00.000Z");
    assert.match(blocked.message, /60 extra question sets today/);
    assert.match(blocked.message, /in about 12 hours/);
  }
  // The blocked click is not charged against the monthly allowance.
  assert.equal(monthly.usedFor(USER), 60);

  const tomorrow = new Date("2026-09-16T00:05:00.000Z");
  const next = await reserve(monthly, { tier: "max", dailyStore: daily, now: tomorrow });
  assert.equal(next.allowed, true);
});

test("daily cap: refund returns both the monthly and the daily click", async () => {
  const monthly = new InMemoryChatMeterStore();
  const daily = new InMemoryChatMeterStore();
  const q = await reserve(monthly, { dailyStore: daily, now: NOON });
  assert.equal(q.allowed, true);
  if (q.allowed) {
    await q.refund();
    await q.refund();
  }
  assert.equal(monthly.usedFor(USER), 0);
  assert.equal(daily.usedFor(USER), 0);
});

test("daily cap: monthly block wins and does not count a daily click", async () => {
  const monthly = new InMemoryChatMeterStore();
  const daily = new InMemoryChatMeterStore();
  const env = { PLAN_LIMIT_LITE_EXTRA_QUESTIONS: "1" };
  await reserve(monthly, { env, dailyStore: daily, now: NOON });
  const blocked = await reserve(monthly, { env, dailyStore: daily, now: NOON });
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) assert.equal(blocked.reason, "monthly");
  assert.equal(daily.usedFor(USER), 1);
});

test("daily cap: fails open when the daily meter is missing; admins skip it", async () => {
  const monthly = new InMemoryChatMeterStore();
  const errors: unknown[] = [];
  const missing: ChatMeterStore = {
    reserve: async () => {
      throw new Error("plan_meter_usage_meter_check");
    },
    refund: async () => {},
  };
  for (let i = 0; i < 70; i++) {
    const q = await reserve(monthly, {
      tier: "max",
      dailyStore: missing,
      now: NOON,
      onStoreError: (e) => errors.push(e),
    });
    assert.equal(q.allowed, true);
  }
  assert.equal(errors.length, 70);

  const daily = new InMemoryChatMeterStore();
  for (let i = 0; i < 70; i++) {
    const q = await reserve(monthly, { tier: "max", unlimited: true, dailyStore: daily, now: NOON });
    assert.equal(q.allowed, true);
  }
  assert.equal(daily.usedFor(USER), 0);
});

test("daily cap: EXTRA_QUESTIONS_DAILY_CAP overrides 60", async () => {
  const monthly = new InMemoryChatMeterStore();
  const daily = new InMemoryChatMeterStore();
  const env = { EXTRA_QUESTIONS_DAILY_CAP: "2" };
  assert.equal((await reserve(monthly, { tier: "max", env, dailyStore: daily, now: NOON })).allowed, true);
  assert.equal((await reserve(monthly, { tier: "max", env, dailyStore: daily, now: NOON })).allowed, true);
  assert.equal((await reserve(monthly, { tier: "max", env, dailyStore: daily, now: NOON })).allowed, false);
});

test("UTC day helpers", () => {
  assert.equal(utcDayStart(new Date("2026-09-15T23:59:59.000Z")), "2026-09-15T00:00:00.000Z");
  assert.equal(nextUtcDayStart(new Date("2026-09-15T00:00:00.000Z")), "2026-09-16T00:00:00.000Z");
});
