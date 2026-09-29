import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { RateLimitedError, SpendRefusedError, StepFatalError } from "./errors.ts";
import { driveBuild, sweepBuilds, type StepHandlers, type TerminalEvent } from "./runner.ts";
import type { StepRow } from "./store.ts";
import { createTestDb, type TestDb } from "./testing/pglite-db.ts";

let t: TestDb;
before(async () => {
  t = await createTestDb();
});
after(async () => {
  await t.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function newBuild() {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId });
  await t.addStep(buildId, { kind: "extract", wave: 0 });
  return buildId;
}

function recorder() {
  const events: TerminalEvent[] = [];
  return { events, onTerminal: async (e: TerminalEvent) => void events.push(e) };
}

/** extract → plan (adds N modules + finalize) → modules in parallel → finalize. */
function pipeline(moduleCount: number, moduleDelayMs = 20) {
  const calls: Record<string, number> = {};
  let running = 0;
  let maxRunning = 0;
  const count = (s: StepRow) => {
    const key = `${s.kind}:${s.ordinal}`;
    calls[key] = (calls[key] ?? 0) + 1;
  };
  const handlers: StepHandlers = {
    extract: async (s) => {
      count(s);
      return { output: { pages: 12 }, newSteps: [{ kind: "plan", ordinal: 0, wave: 1 }] };
    },
    plan: async (s) => {
      count(s);
      return {
        output: { modules: moduleCount },
        newSteps: [
          ...Array.from({ length: moduleCount }, (_, i) => ({ kind: "module" as const, ordinal: i, wave: 2, input: { i } })),
          { kind: "finalize", ordinal: 0, wave: 3 },
        ],
      };
    },
    module: async (s) => {
      count(s);
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await sleep(moduleDelayMs);
      running -= 1;
      return { output: { title: `Module ${s.ordinal + 1}` } };
    },
    finalize: async (s) => {
      count(s);
      return { output: { ok: true } };
    },
  };
  return { handlers, calls, maxRunning: () => maxRunning };
}

test("a build runs extract → plan → parallel modules → finalize, each step once", async () => {
  const buildId = await newBuild();
  const p = pipeline(5);
  const rec = recorder();
  const res = await driveBuild({ buildId, store: t.store, handlers: p.handlers, onTerminal: rec.onTerminal, concurrency: 3 });

  assert.deepEqual(res, { outcome: "finished", status: "complete" });
  assert.equal(p.maxRunning(), 3, "modules run in parallel up to the concurrency limit");
  assert.ok(Object.values(p.calls).every((n) => n === 1), JSON.stringify(p.calls));
  assert.equal(Object.keys(p.calls).length, 8);
  assert.equal(rec.events.length, 1);
  assert.equal(rec.events[0].status, "complete");

  const steps = await t.steps(buildId);
  assert.ok(steps.every((s) => s.status === "done"));
  assert.deepEqual(steps.find((s) => s.kind === "module" && s.ordinal === 2)?.output, { title: "Module 3" });
  assert.equal((await t.build(buildId)).status, "complete");
});

test("two workers started at once: one runs the build, the other backs off", async () => {
  const buildId = await newBuild();
  const p = pipeline(3);
  const [a, b] = await Promise.all([
    driveBuild({ buildId, store: t.store, handlers: p.handlers, owner: "A" }),
    driveBuild({ buildId, store: t.store, handlers: p.handlers, owner: "B" }),
  ]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ["finished", "not_claimed"]);
  assert.ok(Object.values(p.calls).every((n) => n === 1));
});

test("a finished build is never re-run", async () => {
  const buildId = await newBuild();
  const p = pipeline(1);
  await driveBuild({ buildId, store: t.store, handlers: p.handlers });
  const before = { ...p.calls };
  assert.deepEqual(await driveBuild({ buildId, store: t.store, handlers: p.handlers }), { outcome: "not_claimed" });
  assert.deepEqual(p.calls, before);
});

test("a flaky step is retried and the build completes", async () => {
  const buildId = await newBuild();
  let n = 0;
  const res = await driveBuild({
    buildId,
    store: t.store,
    backoffSeconds: () => 0,
    handlers: {
      extract: async () => {
        n += 1;
        if (n < 3) throw new Error("model returned invalid JSON");
        return { output: {} };
      },
    },
  });
  assert.deepEqual(res, { outcome: "finished", status: "complete" });
  assert.equal(n, 3);
});

test("a step out of retries fails the build with a plain-English error", async () => {
  const buildId = await newBuild();
  const rec = recorder();
  let n = 0;
  const res = await driveBuild({
    buildId,
    store: t.store,
    onTerminal: rec.onTerminal,
    backoffSeconds: () => 0,
    handlers: {
      extract: async () => {
        n += 1;
        throw new Error("boom");
      },
    },
  });
  assert.deepEqual(res, { outcome: "finished", status: "failed" });
  assert.equal(n, 3, "fixed retry count");
  const b = await t.build(buildId);
  assert.equal(b.error_code, "step_failed");
  assert.equal(b.error_message, "Reading your files failed after 3 tries.");
  assert.equal(rec.events[0].status, "failed");
});

test("rate limits reschedule the step and hand the build back instead of waiting", async () => {
  const buildId = await newBuild();
  let n = 0;
  const handlers: StepHandlers = {
    extract: async () => {
      n += 1;
      if (n === 1) throw new RateLimitedError(60_000, "429");
      return { output: {} };
    },
  };
  const first = await driveBuild({ buildId, store: t.store, handlers });
  assert.equal(first.outcome, "yielded");
  assert.ok(first.outcome === "yielded" && first.nextRunAfter && first.nextRunAfter.getTime() > Date.now() + 50_000);
  const [step] = await t.steps(buildId);
  assert.equal(step.attempts, 0, "rate limit does not use up an attempt");
  assert.equal((await t.build(buildId)).lease_owner, null, "lease released for the cron");

  await t.db.query("update public.course_build_steps set run_after = now() where build_id = $1", [buildId]);
  const second = await driveBuild({ buildId, store: t.store, handlers });
  assert.deepEqual(second, { outcome: "finished", status: "complete" });
});

test("a spend refusal fails the build at once with no retries", async () => {
  const buildId = await newBuild();
  let n = 0;
  const res = await driveBuild({
    buildId,
    store: t.store,
    handlers: {
      extract: async () => {
        n += 1;
        throw new SpendRefusedError("build_cap");
      },
    },
  });
  assert.deepEqual(res, { outcome: "finished", status: "failed" });
  assert.equal(n, 1);
  assert.equal((await t.build(buildId)).error_code, "build_cap");
});

test("a build-cap refusal while sibling calls are in flight waits for them instead of failing", async () => {
  const buildId = await newBuild();
  const p = pipeline(3, 40);
  let refused = 0;
  const base = p.handlers.module!;
  const handlers: StepHandlers = {
    ...p.handlers,
    module: async (s, ctx) => {
      if (s.ordinal === 1 && refused === 0) {
        refused += 1;
        throw new SpendRefusedError("build_cap");
      }
      return base(s, ctx);
    },
  };
  const waits: number[] = [];
  const res = await driveBuild({
    buildId,
    store: t.store,
    handlers,
    maxIdleWaitMs: 15_000,
    sleep: async (ms) => {
      waits.push(ms);
      await t.db.query("update public.course_build_steps set run_after = now() where build_id = $1", [buildId]);
    },
  });
  assert.deepEqual(res, { outcome: "finished", status: "complete" });
  assert.equal(refused, 1);
  assert.equal(p.calls["module:1"], 1, "the refused module ran once it had room");
  assert.ok(waits.length >= 1 && waits.every((ms) => ms <= 15_100), JSON.stringify(waits));
});

test("a build-cap refusal with nothing else in flight still fails at once", async () => {
  const buildId = await newBuild();
  const res = await driveBuild({
    buildId,
    store: t.store,
    maxIdleWaitMs: 15_000,
    handlers: {
      extract: async () => {
        throw new SpendRefusedError("build_cap");
      },
    },
  });
  assert.deepEqual(res, { outcome: "finished", status: "failed" });
  assert.equal((await t.build(buildId)).error_code, "build_cap");
});

test("handler-declared fatal errors show their own message", async () => {
  const buildId = await newBuild();
  await driveBuild({
    buildId,
    store: t.store,
    handlers: {
      extract: async () => {
        throw new StepFatalError("pdf_no_text", "Lecture 3.pdf has no readable text. It may be a scanned image.");
      },
    },
  });
  const b = await t.build(buildId);
  assert.equal(b.error_code, "pdf_no_text");
  assert.equal(b.error_message, "Lecture 3.pdf has no readable text. It may be a scanned image.");
});

test("cancel aborts running steps and releases the build", async () => {
  const buildId = await newBuild();
  const rec = recorder();
  let aborted = false;
  const drive = driveBuild({
    buildId,
    store: t.store,
    onTerminal: rec.onTerminal,
    heartbeatMs: 20,
    handlers: {
      extract: (_s, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
    },
  });
  await sleep(40);
  await t.db.query("update public.course_builds set cancel_requested_at = now() where id = $1", [buildId]);
  assert.deepEqual(await drive, { outcome: "finished", status: "canceled" });
  assert.equal(aborted, true);
  assert.equal(rec.events[0]?.status, "canceled");
  assert.equal((await t.steps(buildId))[0].status, "canceled");
});

test("cancel reaches an in-flight step at the cancel check, long before the next heartbeat", async () => {
  const buildId = await newBuild();
  const rec = recorder();
  let abortedAt = 0;
  const drive = driveBuild({
    buildId,
    store: t.store,
    onTerminal: rec.onTerminal,
    heartbeatMs: 60_000,
    cancelPollMs: 25,
    handlers: {
      extract: (_s, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => {
            abortedAt = Date.now();
            reject(new Error("aborted"));
          });
        }),
    },
  });
  await sleep(40);
  const canceledAt = Date.now();
  await t.db.query("update public.course_builds set cancel_requested_at = now() where id = $1", [buildId]);
  assert.deepEqual(await drive, { outcome: "finished", status: "canceled" });
  assert.ok(abortedAt > 0 && abortedAt - canceledAt < 1_000, `aborted ${abortedAt - canceledAt}ms after cancel`);
  assert.equal(rec.events[0]?.status, "canceled");
});

test("a worker that loses its lease stops without finishing the build", async () => {
  const buildId = await newBuild();
  const drive = driveBuild({
    buildId,
    store: t.store,
    heartbeatMs: 20,
    handlers: {
      extract: (_s, ctx) =>
        new Promise((_resolve, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    },
  });
  await sleep(40);
  await t.db.query("update public.course_builds set lease_owner = 'someone-else' where id = $1", [buildId]);
  assert.deepEqual(await drive, { outcome: "lease_lost" });
  const b = await t.build(buildId);
  assert.equal(b.status, "running");
  assert.equal(b.lease_owner, "someone-else");
});

test("the cron sweep resumes a build whose worker died mid-step", async () => {
  const buildId = await newBuild();
  await t.store.claimBuildLease(buildId, "dead", 60);
  const step = await t.store.claimStep(buildId, "dead", 60);
  await t.db.query("update public.course_builds set lease_until = now() - interval '1 second' where id = $1", [buildId]);
  await t.db.query("update public.course_build_steps set lease_until = now() - interval '1 second' where id = $1", [step!.id]);

  const p = pipeline(2);
  const results = await sweepBuilds({ store: t.store, handlers: p.handlers, limit: 100 });
  const mine = results.find((r) => r.buildId === buildId);
  assert.deepEqual(mine?.result, { outcome: "finished", status: "complete" });
  assert.equal(p.calls["extract:0"], 1);
  assert.equal(await t.store.completeStep(step!.id, "dead", {}), false, "the dead worker cannot overwrite");
});

test("past the deadline no new steps start and the lease is released", async () => {
  const buildId = await newBuild();
  const p = pipeline(1);
  const res = await driveBuild({ buildId, store: t.store, handlers: p.handlers, deadlineAt: Date.now() - 1 });
  assert.equal(res.outcome, "yielded");
  assert.equal(Object.keys(p.calls).length, 0);
  assert.equal((await t.build(buildId)).lease_owner, null);
});
