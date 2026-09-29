import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CHAT_LIMITS,
  InMemoryChatMeterStore,
  chatLimitForTier,
  chatLimitReachedMessage,
  chatLimitResetsAt,
  chatLimitsEnabled,
  reserveChatQuota,
  usesFallbackModel,
  type ChatMeterStore,
  type ChatQuota,
} from "./chat-limits.ts";
import { PLAN_ORDER } from "./plans.ts";

const USER = "user-1";
const SEPT = { startIso: "2026-09-01T00:00:00.000Z", endIso: "2026-10-01T00:00:00.000Z" };
const OCT = { startIso: "2026-10-01T00:00:00.000Z", endIso: "2026-11-01T00:00:00.000Z" };
const NO_ENV = {};

function reserve(
  store: ChatMeterStore | null,
  opts: Partial<Parameters<typeof reserveChatQuota>[1]> = {}
): Promise<ChatQuota> {
  return reserveChatQuota(store, {
    userId: USER,
    tier: "student",
    period: SEPT,
    unlimited: false,
    upgradeAvailable: true,
    env: NO_ENV,
    ...opts,
  });
}

test("every plan tier has a default chat limit; paid tiers map to 100/200/400/600/1000", () => {
  for (const tier of PLAN_ORDER) {
    const limit = DEFAULT_CHAT_LIMITS[tier];
    assert.ok(limit, `missing limit for ${tier}`);
    assert.ok(limit.premiumMessages <= limit.monthlyMessages);
  }
  assert.equal(DEFAULT_CHAT_LIMITS.lite.monthlyMessages, 100);
  assert.equal(DEFAULT_CHAT_LIMITS.student.monthlyMessages, 200);
  assert.equal(DEFAULT_CHAT_LIMITS.plus.monthlyMessages, 400);
  assert.equal(DEFAULT_CHAT_LIMITS.pro.monthlyMessages, 600);
  assert.equal(DEFAULT_CHAT_LIMITS.max.monthlyMessages, 1000);
  for (const tier of ["lite", "student", "plus", "pro", "max"] as const) {
    assert.equal(DEFAULT_CHAT_LIMITS[tier].premiumMessages, 50, tier);
  }
  assert.deepEqual(DEFAULT_CHAT_LIMITS.free, { monthlyMessages: 20, premiumMessages: 10 });
  assert.ok(DEFAULT_CHAT_LIMITS.free.monthlyMessages < DEFAULT_CHAT_LIMITS.student.monthlyMessages);
});

test("env overrides replace defaults; invalid values are ignored; premium clamps to cap", () => {
  assert.deepEqual(
    chatLimitForTier("student", {
      CHAT_LIMIT_STUDENT_MESSAGES: "250",
      CHAT_LIMIT_STUDENT_SONNET: "75",
    }),
    { monthlyMessages: 250, premiumMessages: 75 }
  );
  assert.deepEqual(
    chatLimitForTier("plus", {
      CHAT_LIMIT_PLUS_MESSAGES: "-5",
      CHAT_LIMIT_PLUS_SONNET: "abc",
    }),
    DEFAULT_CHAT_LIMITS.plus
  );
  assert.deepEqual(
    chatLimitForTier("free", { CHAT_LIMIT_FREE_MESSAGES: "5" }),
    { monthlyMessages: 5, premiumMessages: 5 }
  );
  assert.deepEqual(
    chatLimitForTier("free", { CHAT_LIMIT_FREE_MESSAGES: "0" }),
    { monthlyMessages: 0, premiumMessages: 0 }
  );
});

test("CHAT_LIMITS_ENABLED defaults on and accepts common off values", () => {
  assert.equal(chatLimitsEnabled({}), true);
  assert.equal(chatLimitsEnabled({ CHAT_LIMITS_ENABLED: "true" }), true);
  for (const off of ["0", "false", "OFF", "no"]) {
    assert.equal(chatLimitsEnabled({ CHAT_LIMITS_ENABLED: off }), false);
  }
});

test("first premium messages stay on the normal model, then fall back", () => {
  const limit = { monthlyMessages: 200, premiumMessages: 50 };
  assert.equal(usesFallbackModel(1, limit), false);
  assert.equal(usesFallbackModel(50, limit), false);
  assert.equal(usesFallbackModel(51, limit), true);
  assert.equal(usesFallbackModel(200, limit), true);
});

test("student: 50 Sonnet, 150 Haiku, then blocked with a reset date", async () => {
  const store = new InMemoryChatMeterStore();
  const models: boolean[] = [];
  for (let i = 0; i < 200; i++) {
    const q = await reserve(store);
    assert.equal(q.allowed, true);
    if (q.allowed) models.push(q.useFallbackModel);
  }
  assert.equal(models.filter((f) => !f).length, 50);
  assert.equal(models.filter((f) => f).length, 150);
  assert.equal(models.slice(0, 50).every((f) => !f), true);

  const blocked = await reserve(store);
  assert.equal(blocked.allowed, false);
  if (!blocked.allowed) {
    assert.equal(blocked.used, 200);
    assert.equal(blocked.resetsAt, SEPT.endIso);
    assert.match(blocked.message, /monthly chat limit/);
    assert.match(blocked.message, /October 1/);
  }
  assert.equal(store.usedFor(USER), 200, "blocked attempts are not counted");
});

test("new billing period resets the counter", async () => {
  const store = new InMemoryChatMeterStore();
  const limitEnv = { CHAT_LIMIT_STUDENT_MESSAGES: "2", CHAT_LIMIT_STUDENT_SONNET: "1" };
  await reserve(store, { env: limitEnv });
  await reserve(store, { env: limitEnv });
  assert.equal((await reserve(store, { env: limitEnv })).allowed, false);

  const fresh = await reserve(store, { env: limitEnv, period: OCT });
  assert.equal(fresh.allowed, true);
  if (fresh.allowed) {
    assert.equal(fresh.used, 1);
    assert.equal(fresh.useFallbackModel, false);
  }
});

test("an older period (downgrade) keeps counting instead of granting a fresh allowance", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { CHAT_LIMIT_STUDENT_MESSAGES: "3", CHAT_LIMIT_FREE_MESSAGES: "3" };
  const paidPeriod = { startIso: "2026-09-15T00:00:00.000Z", endIso: "2026-10-15T00:00:00.000Z" };
  await reserve(store, { env, period: paidPeriod });
  await reserve(store, { env, period: paidPeriod });
  const afterDowngrade = await reserve(store, { env, tier: "free", period: SEPT });
  assert.equal(afterDowngrade.allowed, true);
  if (afterDowngrade.allowed) assert.equal(afterDowngrade.used, 3);
  assert.equal((await reserve(store, { env, tier: "free", period: SEPT })).allowed, false);
});

test("refund gives the message back once, even if called twice", async () => {
  const store = new InMemoryChatMeterStore();
  const a = await reserve(store);
  const b = await reserve(store);
  assert.equal(store.usedFor(USER), 2);
  assert.ok(b.allowed);
  if (b.allowed) {
    await b.refund();
    await b.refund();
  }
  assert.equal(store.usedFor(USER), 1);
  assert.ok(a.allowed);
});

test("a refund after the period rolled over does not touch the new period", async () => {
  const store = new InMemoryChatMeterStore();
  const sept = await reserve(store);
  await reserve(store, { period: OCT });
  assert.ok(sept.allowed);
  if (sept.allowed) await sept.refund();
  assert.equal(store.usedFor(USER), 1);
});

test("concurrent reservations never exceed the cap", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { CHAT_LIMIT_STUDENT_MESSAGES: "5" };
  const results = await Promise.all(
    Array.from({ length: 12 }, () => reserve(store, { env }))
  );
  assert.equal(results.filter((r) => r.allowed).length, 5);
  assert.equal(store.usedFor(USER), 5);
});

test("unmetered: disabled, exempt admins, or no store — normal model, nothing counted", async () => {
  const store = new InMemoryChatMeterStore();
  for (const q of [
    await reserve(store, { env: { CHAT_LIMITS_ENABLED: "false" } }),
    await reserve(store, { unlimited: true }),
    await reserve(null),
  ]) {
    assert.equal(q.allowed, true);
    if (q.allowed) {
      assert.equal(q.metered, false);
      assert.equal(q.useFallbackModel, false);
    }
  }
  assert.equal(store.usedFor(USER), 0);
});

test("store failure (e.g. migration not applied) fails open and reports", async () => {
  const errors: unknown[] = [];
  const broken: ChatMeterStore = {
    reserve: async () => {
      throw new Error("function chat_message_reserve does not exist");
    },
    refund: async () => {},
  };
  const q = await reserve(broken, { onStoreError: (e) => errors.push(e) });
  assert.equal(q.allowed, true);
  if (q.allowed) {
    assert.equal(q.metered, false);
    assert.equal(q.useFallbackModel, false);
  }
  assert.equal(errors.length, 1);
});

test("a failing refund never throws into the chat route", async () => {
  const errors: unknown[] = [];
  const store: ChatMeterStore = {
    reserve: async ({ periodStart }) => ({ allowed: true, used: 1, periodStart }),
    refund: async () => {
      throw new Error("network");
    },
  };
  const q = await reserve(store, { onStoreError: (e) => errors.push(e) });
  assert.ok(q.allowed);
  if (q.allowed) await q.refund();
  assert.equal(errors.length, 1);
});

test("zero-message plans are blocked on the first message", async () => {
  const store = new InMemoryChatMeterStore();
  const q = await reserve(store, { tier: "free", env: { CHAT_LIMIT_FREE_MESSAGES: "0" } });
  assert.equal(q.allowed, false);
  assert.equal(store.usedFor(USER), 0);
});

test("reset date falls back to one month after the start when Stripe has no end", () => {
  assert.equal(
    chatLimitResetsAt({ startIso: "2026-09-15T12:00:00.000Z", endIso: null }),
    "2026-10-15T12:00:00.000Z"
  );
  assert.equal(chatLimitResetsAt(SEPT), SEPT.endIso);
});

test("limit message mentions upgrades only where they exist", () => {
  const base = {
    limit: { monthlyMessages: 200, premiumMessages: 50 },
    resetsAt: "2026-10-01T00:00:00.000Z",
  };
  const student = chatLimitReachedMessage({ ...base, tier: "student", upgradeAvailable: true });
  assert.match(student, /200 messages/);
  assert.match(student, /resets on October 1/);
  assert.match(student, /Upgrade your plan/);
  assert.match(
    chatLimitReachedMessage({ ...base, tier: "free", upgradeAvailable: true }),
    /Choose a plan/
  );
  assert.doesNotMatch(
    chatLimitReachedMessage({ ...base, tier: "max", upgradeAvailable: true }),
    /Upgrade|Choose a plan/
  );
  assert.doesNotMatch(
    chatLimitReachedMessage({ ...base, tier: "student", upgradeAvailable: false }),
    /Upgrade|Choose a plan/
  );
});

test("voice-mode turns charged as voice minutes are not counted as chat", async () => {
  const store = new InMemoryChatMeterStore();
  const cap = { CHAT_LIMIT_STUDENT_MESSAGES: "1", CHAT_LIMIT_STUDENT_SONNET: "0" };
  const voice = await reserve(store, { voiceTurn: true, env: cap });
  assert.equal(voice.allowed, true);
  assert.equal(voice.allowed && voice.metered, false);
  assert.equal(voice.allowed && voice.useFallbackModel, false, "normal model");
  assert.equal(store.usedFor(USER), 0);

  const text = await reserve(store, { env: cap });
  assert.equal(text.allowed && text.metered, true);
  assert.equal(store.usedFor(USER), 1);
  // Text is capped now; voice turns keep going.
  assert.equal((await reserve(store, { env: cap })).allowed, false);
  assert.equal((await reserve(store, { voiceTurn: true, env: cap })).allowed, true);
  assert.equal(store.usedFor(USER), 1);
});

test("blocked chat message is built in the student's language and time zone", async () => {
  const store = new InMemoryChatMeterStore();
  const env = { CHAT_LIMIT_STUDENT_MESSAGES: "0" };
  let lookups = 0;
  const copy = async () => {
    lookups += 1;
    return { locale: "ko", timeZone: "Asia/Seoul" };
  };
  const q = await reserve(store, { env, copy });
  assert.equal(q.allowed, false);
  if (q.allowed) return;
  assert.equal(q.resetsAt, SEPT.endIso);
  assert.match(q.message, /Rose 채팅이 포함되어 있지 않아요/);
  assert.match(q.message, /10월 1일 오전 9:00에 초기화돼요/);
  assert.match(q.message, /업그레이드/);

  const la = chatLimitReachedMessage(
    {
      tier: "student",
      limit: { monthlyMessages: 200, premiumMessages: 50 },
      resetsAt: SEPT.endIso,
      upgradeAvailable: true,
    },
    { locale: "en", timeZone: "America/Los_Angeles" }
  );
  assert.match(la, /resets on September 30 at 5:00\s?PM\./);

  await reserve(store, { copy, env: NO_ENV });
  assert.equal(lookups, 1, "language/time zone only looked up when blocked");
  const failing = await reserve(store, {
    env,
    copy: async () => {
      throw new Error("profile down");
    },
  });
  assert.match(!failing.allowed ? failing.message : "", /resets on October 1 at 12:00\s?AM UTC/);
});
