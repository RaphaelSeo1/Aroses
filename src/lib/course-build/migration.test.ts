import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDb, type TestDb } from "./testing/pglite-db.ts";

let t: TestDb;

before(async () => {
  t = await createTestDb();
});

after(async () => {
  await t.close();
});

async function freshBuild(opts: { spendCapUsd?: number; dailyCapUsd?: number } = {}) {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId, ...opts });
  return { userId, buildId };
}

async function expireStep(stepId: string) {
  await t.db.query(
    "update public.course_build_steps set lease_until = now() - interval '1 second' where id = $1",
    [stepId]
  );
}

async function expireBuildLease(buildId: string) {
  await t.db.query(
    "update public.course_builds set lease_until = now() - interval '1 second' where id = $1",
    [buildId]
  );
}

test("only one worker can hold a build lease", async () => {
  const { buildId } = await freshBuild();
  assert.equal(await t.store.claimBuildLease(buildId, "w1", 60), true);
  assert.equal(await t.store.claimBuildLease(buildId, "w2", 60), false);
  assert.equal(await t.store.renewBuildLease(buildId, "w1", 60), true);
  assert.equal(await t.store.renewBuildLease(buildId, "w2", 60), false);
  assert.equal(await t.store.releaseBuildLease(buildId, "w2"), false);
  assert.equal((await t.build(buildId)).status, "running");
});

test("an expired lease can be taken over and the old holder is locked out", async () => {
  const { buildId } = await freshBuild();
  await t.addStep(buildId, { kind: "extract", wave: 0 });
  assert.equal(await t.store.claimBuildLease(buildId, "w1", 60), true);
  await expireBuildLease(buildId);
  assert.equal(await t.store.claimBuildLease(buildId, "w2", 60), true);
  assert.equal(await t.store.renewBuildLease(buildId, "w1", 60), false);
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null);
  assert.ok(await t.store.claimStep(buildId, "w2", 60));
});

test("steps cannot be claimed without the build lease", async () => {
  const { buildId } = await freshBuild();
  await t.addStep(buildId, { kind: "extract", wave: 0 });
  assert.equal(await t.store.claimStep(buildId, "nobody", 60), null);
});

test("a step waits until every lower wave is done", async () => {
  const { buildId } = await freshBuild();
  await t.addStep(buildId, { kind: "extract", wave: 0 });
  await t.addStep(buildId, { kind: "plan", wave: 1 });
  await t.store.claimBuildLease(buildId, "w1", 60);

  const extract = await t.store.claimStep(buildId, "w1", 60);
  assert.equal(extract?.kind, "extract");
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null, "plan must wait for extract");

  assert.equal(await t.store.completeStep(extract!.id, "w1", { pages: 3 }), true);
  const plan = await t.store.claimStep(buildId, "w1", 60);
  assert.equal(plan?.kind, "plan");
});

test("completing a step saves its output and adds follow-up steps once", async () => {
  const { buildId } = await freshBuild();
  await t.addStep(buildId, { kind: "plan", wave: 0 });
  await t.store.claimBuildLease(buildId, "w1", 60);
  const plan = await t.store.claimStep(buildId, "w1", 60);
  const modules = [0, 1, 2].map((i) => ({ kind: "module" as const, ordinal: i, wave: 1, input: { i } }));

  assert.equal(await t.store.completeStep(plan!.id, "w2", {}, modules), false, "non-owner cannot complete");
  assert.equal(await t.store.completeStep(plan!.id, "w1", { modules: 3 }, modules), true);
  assert.equal(await t.store.completeStep(plan!.id, "w1", { modules: 3 }, modules), false, "cannot complete twice");

  const rows = await t.steps(buildId);
  assert.equal(rows.filter((r) => r.kind === "module").length, 3);
  assert.deepEqual(rows.find((r) => r.kind === "plan")?.output, { modules: 3 });

  const claimed = new Set<string>();
  for (;;) {
    const s = await t.store.claimStep(buildId, "w1", 60);
    if (!s) break;
    assert.equal(s.kind, "module");
    assert.ok(!claimed.has(s.id), "a step is never handed out twice");
    claimed.add(s.id);
  }
  assert.equal(claimed.size, 3);
});

test("failed steps retry with backoff up to max_attempts, then fail", async () => {
  const { buildId } = await freshBuild();
  const stepId = await t.addStep(buildId, { kind: "extract", wave: 0, maxAttempts: 2 });
  await t.store.claimBuildLease(buildId, "w1", 60);

  await t.store.claimStep(buildId, "w1", 60);
  assert.equal(await t.store.failStep(stepId, "w2", "boom", true, 0), "stale");
  assert.equal(await t.store.failStep(stepId, "w1", "boom", true, 30), "retry");
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null, "backoff not over yet");

  await t.db.query("update public.course_build_steps set run_after = now() where id = $1", [stepId]);
  const again = await t.store.claimStep(buildId, "w1", 60);
  assert.equal(again?.attempts, 2);
  assert.equal(await t.store.failStep(stepId, "w1", "boom", true, 0), "failed");
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null);
  const row = (await t.steps(buildId))[0];
  assert.equal(row.status, "failed");
  assert.equal(row.last_error, "boom");
});

test("non-retryable failures fail immediately", async () => {
  const { buildId } = await freshBuild();
  const stepId = await t.addStep(buildId, { kind: "extract", wave: 0 });
  await t.store.claimBuildLease(buildId, "w1", 60);
  await t.store.claimStep(buildId, "w1", 60);
  assert.equal(await t.store.failStep(stepId, "w1", "bad pdf", false, 0), "failed");
});

test("rate-limit reschedules give the attempt back and eventually give up", async () => {
  const { buildId } = await freshBuild();
  const stepId = await t.addStep(buildId, { kind: "extract", wave: 0 });
  await t.store.claimBuildLease(buildId, "w1", 60);

  await t.store.claimStep(buildId, "w1", 60);
  assert.equal(await t.store.rescheduleStep(stepId, "w1", 20, "429"), "rescheduled");
  let row = (await t.steps(buildId))[0];
  assert.equal(row.attempts, 0);
  assert.equal(row.rate_limited_count, 1);
  assert.equal(row.status, "pending");
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null, "not before run_after");

  const p = await t.store.progress(buildId);
  assert.equal(p?.ready, 0);
  assert.equal(p?.waiting, 1);
  assert.ok(p?.nextRunAfter && p.nextRunAfter.getTime() > Date.now());

  await t.db.query("update public.course_build_steps set rate_limited_count = 19, run_after = now() where id = $1", [stepId]);
  await t.store.claimStep(buildId, "w1", 60);
  assert.equal(await t.store.rescheduleStep(stepId, "w1", 20, "429"), "failed");
  row = (await t.steps(buildId))[0];
  assert.equal(row.status, "failed");
});

test("a step whose worker died is re-run, and the dead worker's result is rejected", async () => {
  const { buildId } = await freshBuild();
  const stepId = await t.addStep(buildId, { kind: "extract", wave: 0 });
  await t.store.claimBuildLease(buildId, "w1", 60);
  await t.store.claimStep(buildId, "w1", 60);

  await expireBuildLease(buildId);
  await expireStep(stepId);
  await t.store.claimBuildLease(buildId, "w2", 60);
  const retaken = await t.store.claimStep(buildId, "w2", 60);
  assert.equal(retaken?.id, stepId);
  assert.equal(retaken?.attempts, 2);

  assert.equal(await t.store.completeStep(stepId, "w1", { stale: true }), false);
  assert.equal(await t.store.completeStep(stepId, "w2", { fresh: true }), true);
  assert.deepEqual((await t.steps(buildId))[0].output, { fresh: true });
});

test("a timed-out step on its last attempt is failed instead of re-run", async () => {
  const { buildId } = await freshBuild();
  const stepId = await t.addStep(buildId, { kind: "extract", wave: 0, maxAttempts: 1 });
  await t.store.claimBuildLease(buildId, "w1", 60);
  await t.store.claimStep(buildId, "w1", 60);
  await expireStep(stepId);
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null);
  const row = (await t.steps(buildId))[0];
  assert.equal(row.status, "failed");
  assert.equal(row.last_error, "Step timed out");
});

test("cancel stops claims; finishing cancels leftover steps and returns the reservation", async () => {
  const { buildId } = await freshBuild();
  await t.addStep(buildId, { kind: "extract", wave: 0 });
  await t.addStep(buildId, { kind: "plan", wave: 1 });
  const reservation = "11111111-1111-4111-8111-111111111111";
  await t.db.query("update public.course_builds set usage_reservation_id = $2 where id = $1", [buildId, reservation]);
  await t.store.claimBuildLease(buildId, "w1", 60);
  await t.store.claimStep(buildId, "w1", 60);

  await t.db.query("update public.course_builds set cancel_requested_at = now() where id = $1", [buildId]);
  assert.equal(await t.store.claimStep(buildId, "w1", 60), null);
  assert.equal((await t.store.progress(buildId))?.cancelRequested, true);

  assert.deepEqual(await t.store.finishBuild(buildId, "w2", "canceled"), { ok: false, usageReservationId: null });
  assert.deepEqual(await t.store.finishBuild(buildId, "w1", "canceled"), { ok: true, usageReservationId: reservation });
  assert.equal((await t.store.finishBuild(buildId, "w1", "canceled")).ok, false, "finishes once");

  const b = await t.build(buildId);
  assert.equal(b.status, "canceled");
  assert.equal(b.lease_owner, null);
  assert.deepEqual((await t.steps(buildId)).map((s) => s.status), ["canceled", "canceled"]);
  assert.equal(await t.store.claimBuildLease(buildId, "w1", 60), false, "finished builds cannot be leased");
});

test("builds_needing_work finds orphaned and due builds only", async () => {
  const orphan = await freshBuild();
  const orphanStep = await t.addStep(orphan.buildId, { kind: "extract", wave: 0 });
  await t.store.claimBuildLease(orphan.buildId, "w1", 60);
  await t.store.claimStep(orphan.buildId, "w1", 60);
  await expireBuildLease(orphan.buildId);
  await expireStep(orphanStep);

  const live = await freshBuild();
  await t.addStep(live.buildId, { kind: "extract", wave: 0 });
  await t.store.claimBuildLease(live.buildId, "w1", 60);

  const later = await freshBuild();
  const laterStep = await t.addStep(later.buildId, { kind: "extract", wave: 0 });
  await t.db.query("update public.course_build_steps set run_after = now() + interval '1 hour' where id = $1", [laterStep]);

  const ids = await t.store.buildsNeedingWork(500);
  assert.ok(ids.includes(orphan.buildId));
  assert.ok(!ids.includes(live.buildId));
  assert.ok(!ids.includes(later.buildId));
});

test("spend reservations refuse past the build cap and count reserved rows at their estimate", async () => {
  const { userId, buildId } = await freshBuild({ spendCapUsd: 0.02 });
  const reserve = (est: number) =>
    t.store.reserveSpend({ buildId, stepId: null, userId, purpose: "module:0", model: "m", maxOutputTokens: 100, estCostUsd: est });

  const a = await reserve(0.012);
  assert.equal(a.ok, true);
  const b = await reserve(0.009);
  assert.equal(b.ok, false);
  assert.equal(b.reason, "build_cap");
  assert.equal(b.buildCommittedUsd, 0.012);

  // Settling at the real (lower) cost frees the difference.
  await t.store.settleSpend({ ledgerId: a.ledgerId, status: "settled", inputTokens: 1000, outputTokens: 400, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0.003 });
  assert.equal((await reserve(0.009)).ok, true);

  const rows = await t.ledger(buildId);
  assert.deepEqual(rows.map((r) => r.status).sort(), ["refused", "reserved", "settled"]);
  assert.equal(
    await t.store.settleSpend({ ledgerId: a.ledgerId, status: "settled", inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, costUsd: 0 }),
    false,
    "a row settles once"
  );
});

test("the daily cap spans all of a user's builds and only the last 24 hours", async () => {
  const userId = await t.createUser();
  const b1 = await t.createBuild({ userId, spendCapUsd: 1, dailyCapUsd: 0.05 });
  const b2 = await t.createBuild({ userId, spendCapUsd: 1, dailyCapUsd: 0.05 });
  const reserve = (buildId: string, est: number) =>
    t.store.reserveSpend({ buildId, stepId: null, userId, purpose: "plan", model: "m", maxOutputTokens: 100, estCostUsd: est });

  assert.equal((await reserve(b1, 0.03)).ok, true);
  const refused = await reserve(b2, 0.03);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "daily_cap");

  await t.db.query(
    "update public.course_build_ai_ledger set created_at = now() - interval '25 hours' where user_id = $1",
    [userId]
  );
  assert.equal((await reserve(b2, 0.03)).ok, true);
});

test("spend is refused for canceled builds and mismatched users", async () => {
  const { userId, buildId } = await freshBuild();
  await t.db.query("update public.course_builds set cancel_requested_at = now() where id = $1", [buildId]);
  const r = await t.store.reserveSpend({ buildId, stepId: null, userId, purpose: "plan", model: "m", maxOutputTokens: 1, estCostUsd: 0.001 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "build_not_running");

  const other = await t.createUser();
  await assert.rejects(
    t.store.reserveSpend({ buildId, stepId: null, userId: other, purpose: "plan", model: "m", maxOutputTokens: 1, estCostUsd: 0.001 }),
    /course_build_user_mismatch/
  );
});

test("functions are service-role only and tables have RLS on", async () => {
  const fns = [
    "course_build_claim_lease(uuid, text, integer)",
    "course_build_claim_step(uuid, text, integer)",
    "course_build_complete_step(uuid, text, jsonb, jsonb)",
    "course_build_reserve_spend(uuid, uuid, uuid, text, text, integer, numeric)",
    "course_build_settle_spend(uuid, text, integer, integer, integer, integer, numeric)",
    "course_build_finish(uuid, text, text, text, text)",
  ];
  for (const fn of fns) {
    for (const role of ["anon", "authenticated"]) {
      const r = await t.db.query<{ ok: boolean }>(`select has_function_privilege($1, 'public.${fn}', 'execute') as ok`, [role]);
      assert.equal(r.rows[0].ok, false, `${role} must not execute ${fn}`);
    }
    const s = await t.db.query<{ ok: boolean }>(`select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`);
    assert.equal(s.rows[0].ok, true, `service_role executes ${fn}`);
  }
  const rls = await t.db.query<{ relname: string; relrowsecurity: boolean }>(
    "select relname, relrowsecurity from pg_class where relname like 'course_build%' and relkind = 'r'"
  );
  assert.equal(rls.rows.length, 4);
  for (const r of rls.rows) assert.equal(r.relrowsecurity, true, `${r.relname} has RLS`);
});
