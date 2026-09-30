import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import { readCourseBuildConfig } from "./config.ts";
import {
  AiCallError,
  BudgetUnavailableError,
  CourseBuildDisabledError,
  RateLimitedError,
  SpendRefusedError,
} from "./errors.ts";
import {
  meteredClaudeCall,
  resetStructuredOutputOutage,
  structuredOutputOutage,
  type MessagesClient,
  type MeteredRequest,
} from "./metered-call.ts";
import { createTestDb, type TestDb } from "./testing/pglite-db.ts";

let t: TestDb;
before(async () => {
  t = await createTestDb();
});
after(async () => {
  await t.close();
});

const ON = readCourseBuildConfig({ COURSE_BUILD_ENABLED: "1", COURSE_BUILD_MODEL: "claude-haiku-4-5" });

function reply(usage: Partial<Anthropic.Usage>): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "ok", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      ...usage,
    } as Anthropic.Usage,
  } as Anthropic.Message;
}

type Call = { body: Anthropic.MessageCreateParamsNonStreaming; options: unknown };

function fakeClient(impl: () => Promise<Anthropic.Message>): MessagesClient & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    messages: {
      create: (body, options) => {
        calls.push({ body, options });
        return impl();
      },
    },
  };
}

function httpError(status: number, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { status, headers: new Headers(headers) });
}

const REQ: MeteredRequest = {
  max_tokens: 1000,
  system: "Write lessons.",
  messages: [{ role: "user", content: "Page 1: supply and demand." }],
};

async function ctx(opts: { spendCapUsd?: number; dailyCapUsd?: number } = {}) {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId, ...opts });
  return { userId, buildId, stepId: null, purpose: "module:0" };
}

test("disabled switch refuses before any ledger write or API call", async () => {
  const c = await ctx();
  const client = fakeClient(async () => reply({}));
  await assert.rejects(
    meteredClaudeCall({ store: t.store, client, config: readCourseBuildConfig({}) }, c, REQ),
    CourseBuildDisabledError
  );
  assert.equal(client.calls.length, 0);
  assert.equal((await t.ledger(c.buildId)).length, 0);
});

test("a successful call reserves the worst case, then settles the real cost", async () => {
  const c = await ctx();
  const client = fakeClient(async () => reply({ input_tokens: 2000, output_tokens: 500 }));
  const res = await meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ);

  assert.equal(res.costUsd, 0.0045); // 2000 × $1/M + 500 × $5/M
  assert.ok(res.estCostUsd >= 0.005, "estimate includes max_tokens of output");
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].body.model, "claude-haiku-4-5");
  assert.equal((client.calls[0].options as { maxRetries: number }).maxRetries, 0);

  const [row] = await t.ledger(c.buildId);
  assert.equal(row.status, "settled");
  assert.equal(Number(row.cost_usd), 0.0045);
  assert.equal(row.input_tokens, 2000);
  assert.equal(row.output_tokens, 500);
  assert.equal(row.purpose, "module:0");
});

test("the build cap refuses the call before it is sent", async () => {
  const c = await ctx({ spendCapUsd: 0.02 });
  const client = fakeClient(async () => reply({ input_tokens: 100, output_tokens: 3000 }));
  const big: MeteredRequest = { ...REQ, max_tokens: 5000 }; // $0.025 of output alone

  await assert.rejects(meteredClaudeCall({ store: t.store, client, config: ON }, c, big), (err) => {
    assert.ok(err instanceof SpendRefusedError);
    assert.equal(err.code, "build_cap");
    return true;
  });
  assert.equal(client.calls.length, 0);
  assert.equal((await t.ledger(c.buildId))[0].status, "refused");
});

test("spend accumulates across calls until the cap stops them", async () => {
  const c = await ctx({ spendCapUsd: 0.02 });
  const client = fakeClient(async () => reply({ input_tokens: 1000, output_tokens: 1000 })); // $0.006 each
  let ok = 0;
  let refused = 0;
  for (let i = 0; i < 10; i += 1) {
    try {
      await meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ);
      ok += 1;
    } catch (err) {
      assert.ok(err instanceof SpendRefusedError);
      refused += 1;
    }
  }
  assert.equal(ok, 3);
  assert.equal(refused, 7);
  const settled = (await t.ledger(c.buildId)).filter((r) => r.status === "settled");
  const total = settled.reduce((s, r) => s + Number(r.cost_usd), 0);
  assert.ok(total <= 0.02, `settled ${total} stays under the cap`);
});

test("the daily cap refuses across builds", async () => {
  const userId = await t.createUser();
  const b1 = await t.createBuild({ userId, dailyCapUsd: 0.01 });
  const b2 = await t.createBuild({ userId, dailyCapUsd: 0.01 });
  const client = fakeClient(async () => reply({ input_tokens: 1000, output_tokens: 1000 }));
  const deps = { store: t.store, client, config: ON };

  await meteredClaudeCall(deps, { userId, buildId: b1, stepId: null, purpose: "plan" }, REQ);
  await assert.rejects(
    meteredClaudeCall(deps, { userId, buildId: b2, stepId: null, purpose: "plan" }, REQ),
    (err) => err instanceof SpendRefusedError && err.code === "daily_cap"
  );
  assert.equal(client.calls.length, 1);
});

test("if the cap check cannot run, the call is refused", async () => {
  const c = await ctx();
  const client = fakeClient(async () => reply({}));
  t.breakRpc(true);
  try {
    await assert.rejects(meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ), BudgetUnavailableError);
  } finally {
    t.breakRpc(false);
  }
  assert.equal(client.calls.length, 0);
});

test("an unpriced model is refused", async () => {
  const c = await ctx();
  const client = fakeClient(async () => reply({}));
  const config = readCourseBuildConfig({ COURSE_BUILD_ENABLED: "1", COURSE_BUILD_MODEL: "claude-opus-9" });
  await assert.rejects(meteredClaudeCall({ store: t.store, client, config }, c, REQ), BudgetUnavailableError);
  assert.equal(client.calls.length, 0);
});

test("429 and 529 become RateLimitedError with the server's retry-after; not billed", async () => {
  for (const status of [429, 529]) {
    const c = await ctx();
    const client = fakeClient(async () => {
      throw httpError(status, { "retry-after": "7" });
    });
    await assert.rejects(meteredClaudeCall({ store: t.store, client, config: ON, sleep: noWait }, c, REQ), (err) => {
      assert.ok(err instanceof RateLimitedError);
      assert.equal(err.retryAfterMs, 7000);
      assert.equal(err.reason, status === 429 ? "rate_limit" : "overloaded");
      return true;
    });
    assert.equal(client.calls.length, status === 429 ? 1 : 3, "only an overload is retried in place");
    for (const row of await t.ledger(c.buildId)) {
      assert.equal(row.status, "failed");
      assert.equal(Number(row.cost_usd), 0);
    }
  }
});

const noWait = async () => {};

const STRICT_TOOL: Anthropic.Tool = {
  name: "submit_plan",
  strict: true,
  input_schema: { type: "object", properties: { title: { type: "string" } }, required: ["title"], additionalProperties: false },
};
const TOOL_REQ: MeteredRequest = { ...REQ, tools: [STRICT_TOOL], tool_choice: { type: "tool", name: "submit_plan" } };

function grammarError() {
  return Object.assign(
    new Error(
      '503 {"type":"error","error":{"type":"overloaded_error","message":"Grammar compilation is temporarily unavailable. Please try again."}}'
    ),
    { status: 503, headers: new Headers() }
  );
}

const isStrict = (body: Anthropic.MessageCreateParamsNonStreaming) =>
  (body.tools ?? []).some((t) => (t as Anthropic.Tool).strict === true);

test("structured output down (grammar 503): one quick retry without strict tools succeeds", async () => {
  resetStructuredOutputOutage();
  try {
    const c = await ctx();
    const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const waits: number[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (body) => {
          calls.push(body);
          if (isStrict(body)) throw grammarError();
          return reply({ input_tokens: 1000, output_tokens: 100 });
        },
      },
    };
    const deps = { store: t.store, client, config: ON, sleep: async (ms: number) => void waits.push(ms) };
    const res = await meteredClaudeCall(deps, c, TOOL_REQ);
    assert.ok(res.costUsd > 0);
    assert.deepEqual(calls.map(isStrict), [true, false]);
    assert.equal(calls[1].tools?.[0].name, "submit_plan", "same tool, schema kept, only strict dropped");
    assert.ok(waits.length === 1 && waits[0] <= 1_500, `quick jittered wait, got ${waits}`);
    assert.deepEqual((await t.ledger(c.buildId)).map((r) => [r.status, Number(r.cost_usd) > 0]), [
      ["failed", false],
      ["settled", true],
    ]);

    // Other calls skip strict for a while instead of waiting on the same failure.
    assert.equal(structuredOutputOutage(), true);
    await meteredClaudeCall(deps, c, TOOL_REQ);
    assert.deepEqual(calls.map(isStrict), [true, false, false]);
  } finally {
    resetStructuredOutputOutage();
  }
});

test("repeated overloads: retried quickly, then without strict, then handed to the reschedule path", async () => {
  resetStructuredOutputOutage();
  const c = await ctx();
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const waits: number[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        calls.push(body);
        throw Object.assign(new Error('529 {"type":"overloaded_error","message":"Overloaded"}'), { status: 529 });
      },
    },
  };
  const deps = { store: t.store, client, config: ON, sleep: async (ms: number) => void waits.push(ms), random: () => 1 };
  await assert.rejects(meteredClaudeCall(deps, c, TOOL_REQ), (err) => {
    assert.ok(err instanceof RateLimitedError);
    assert.equal(err.reason, "overloaded");
    assert.ok(err.retryAfterMs <= 8_000, `short reschedule, got ${err.retryAfterMs}`);
    return true;
  });
  assert.deepEqual(calls.map(isStrict), [true, true, false]);
  assert.deepEqual(waits, [1_500, 4_000]);
  assert.equal(structuredOutputOutage(), false, "a plain overload doesn't switch strict off for everyone");
});

test("a cancel during the quick-retry wait stops without another call", async () => {
  const c = await ctx();
  const ac = new AbortController();
  let n = 0;
  const client: MessagesClient = {
    messages: {
      create: async () => {
        n += 1;
        throw Object.assign(new Error("529 overloaded"), { status: 529 });
      },
    },
  };
  const deps = { store: t.store, client, config: ON, sleep: async () => ac.abort() };
  await assert.rejects(meteredClaudeCall(deps, c, REQ, { signal: ac.signal }), AiCallError);
  assert.equal(n, 1);
});

test("an HTTP 400 is not retryable and not billed; a dropped connection keeps its worst-case cost", async () => {
  const bad = await ctx();
  await assert.rejects(
    meteredClaudeCall(
      { store: t.store, client: fakeClient(async () => { throw httpError(400); }), config: ON },
      bad,
      REQ
    ),
    (err) => err instanceof AiCallError && err.retryable === false && err.status === 400
  );
  assert.equal(Number((await t.ledger(bad.buildId))[0].cost_usd), 0);

  const dropped = await ctx();
  await assert.rejects(
    meteredClaudeCall(
      { store: t.store, client: fakeClient(async () => { throw new Error("socket hang up"); }), config: ON },
      dropped,
      REQ
    ),
    (err) => err instanceof AiCallError && err.retryable === true
  );
  const [row] = await t.ledger(dropped.buildId);
  assert.equal(row.status, "failed");
  assert.equal(Number(row.cost_usd), Number(row.est_cost_usd));
});

test("an already-aborted signal refuses without sending", async () => {
  const c = await ctx();
  const client = fakeClient(async () => reply({}));
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ, { signal: ac.signal }),
    AiCallError
  );
  assert.equal(client.calls.length, 0);
  assert.equal(Number((await t.ledger(c.buildId))[0].cost_usd), 0);
});

test("streaming reports partial tool input and settles like a normal call", async () => {
  const c = await ctx();
  const snapshots: unknown[] = [];
  let streamed = 0;
  const client: MessagesClient = {
    messages: {
      create: async () => {
        throw new Error("create should not be used when streaming");
      },
      stream: () => {
        streamed += 1;
        let listener: ((d: string, s: unknown) => void) | null = null;
        return {
          on(_event, fn) {
            listener = fn;
            return this;
          },
          async finalMessage() {
            listener?.('{"lessons":[{"title":"Sup', { lessons: [{ title: "Sup" }] });
            listener?.('ply"}]}', { lessons: [{ title: "Supply" }] });
            return reply({ input_tokens: 1000, output_tokens: 200 });
          },
        };
      },
    },
  };
  const res = await meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ, {
    onToolInput: (s) => snapshots.push(s),
  });
  assert.equal(streamed, 1);
  assert.deepEqual(snapshots, [{ lessons: [{ title: "Sup" }] }, { lessons: [{ title: "Supply" }] }]);
  assert.equal(res.costUsd, 0.002);
  const [row] = await t.ledger(c.buildId);
  assert.equal(row.status, "settled");
});

test("a throwing preview callback never fails the call", async () => {
  const c = await ctx();
  const client: MessagesClient = {
    messages: {
      create: async () => reply({}),
      stream: () => {
        let listener: ((d: string, s: unknown) => void) | null = null;
        return {
          on(_event, fn) {
            listener = fn;
            return this;
          },
          async finalMessage() {
            listener?.("{", {});
            return reply({ input_tokens: 10, output_tokens: 10 });
          },
        };
      },
    },
  };
  const res = await meteredClaudeCall({ store: t.store, client, config: ON }, c, REQ, {
    onToolInput: () => {
      throw new Error("preview broke");
    },
  });
  assert.ok(res.costUsd > 0);
});
