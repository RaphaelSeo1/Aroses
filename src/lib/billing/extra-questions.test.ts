import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryChatMeterStore, type ChatMeterStore } from "./chat-limits.ts";
import { reserveExtraQuestionQuota } from "./extra-questions.ts";

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
  const caps = { lite: 5, student: 15, plus: 30, pro: 50, max: 80 } as const;
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
      assert.match(blocked.message, new RegExp(`all ${cap} extra question sets`));
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
  for (let i = 0; i < 4; i++) await reserve(store);
  const last = await reserve(store);
  assert.equal(last.allowed, true);
  if (last.allowed) {
    await last.refund();
    await last.refund();
  }
  const again = await reserve(store);
  assert.equal(again.allowed, true);
  const over = await reserve(store);
  assert.equal(over.allowed, false);
});

test("a new billing period resets the clicks", async () => {
  const store = new InMemoryChatMeterStore();
  for (let i = 0; i < 5; i++) await reserve(store);
  assert.equal((await reserve(store)).allowed, false);
  assert.equal((await reserve(store, { period: OCT })).allowed, true);
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
