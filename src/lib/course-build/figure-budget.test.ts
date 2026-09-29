import assert from "node:assert/strict";
import { test } from "node:test";
import { FigureBudget, OverBudget, eachWithinBudget, spreadOrder } from "./figure-budget.ts";

/** A clock that a slow fake page advances, like a slow serverless CPU would. */
function slowClock() {
  let now = 1_000_000;
  return { now: () => now, spend: (ms: number) => void (now += ms) };
}

test("a slow scan stops at the budget, keeps what it found, and never touches the rest", async () => {
  const clock = slowClock();
  const budget = new FigureBudget(clock.now() + 25_000, clock.now);
  const touched: number[] = [];
  const t0 = Date.now();
  const out = await eachWithinBudget<number, string>(spreadOrder(46), budget, undefined, async (page, emit) => {
    touched.push(page);
    clock.spend(4_000); // each page "takes" 4 s
    emit(`p${page}`);
  });
  assert.equal(out.truncated, true);
  assert.equal(touched.length, 7, "25 s at 4 s a page");
  assert.equal(out.results.length, 7);
  assert.ok(Date.now() - t0 < 1_000, "real time stays tiny: nothing waits on the budget");
  assert.ok(Math.max(...touched) > 40, `the sample reaches the end of the file: ${touched}`);
});

test("a page that runs out of budget part-way keeps its finished crops", async () => {
  const clock = slowClock();
  const budget = new FigureBudget(clock.now() + 10_000, clock.now);
  const out = await eachWithinBudget<number, string>([1, 2, 3], budget, undefined, async (page, emit) => {
    for (let crop = 1; crop <= 6; crop++) {
      budget.check();
      clock.spend(1_500);
      emit(`p${page}c${crop}`);
    }
  });
  assert.equal(out.truncated, true);
  assert.deepEqual(out.results, ["p1c1", "p1c2", "p1c3", "p1c4", "p1c5", "p1c6", "p2c1"]);
  assert.equal(out.processed, 2);
});

test("time already spent (download, queue) counts: an expired budget does no work", async () => {
  const clock = slowClock();
  const budget = new FigureBudget(clock.now() - 1, clock.now);
  let calls = 0;
  const out = await eachWithinBudget([1, 2, 3], budget, undefined, async () => void (calls += 1));
  assert.deepEqual(out, { results: [], processed: 0, truncated: true });
  assert.equal(calls, 0);
});

test("the scan gets half the remaining budget so rendering still has time", () => {
  const clock = slowClock();
  const budget = new FigureBudget(clock.now() + 20_000, clock.now);
  clock.spend(4_000);
  const scan = budget.portion(0.5);
  assert.equal(scan.remainingMs(), 8_000);
  assert.equal(budget.remainingMs(), 16_000);
});

test("a render that would run past the deadline is cancelled, not awaited", async () => {
  const budget = new FigureBudget(Date.now() + 60);
  let cancelled = false;
  let reject: (e: Error) => void = () => {};
  const task = {
    promise: new Promise<void>((_resolve, rej) => (reject = rej)),
    cancel: () => {
      cancelled = true;
      reject(new Error("Rendering cancelled"));
    },
  };
  const t0 = Date.now();
  await assert.rejects(budget.within(task), OverBudget);
  assert.equal(cancelled, true);
  assert.ok(Date.now() - t0 < 1_000);
});

test("a render error inside the budget is a real error, not a budget stop", async () => {
  const budget = new FigureBudget(Date.now() + 5_000);
  await assert.rejects(
    budget.within({ promise: Promise.reject(new Error("bad page")), cancel: () => {} }),
    (err) => !(err instanceof OverBudget) && (err as Error).message === "bad page"
  );
});

test("spread order visits every page once and covers the whole file early", () => {
  const order = spreadOrder(46);
  assert.equal(order.length, 46);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 46 }, (_, i) => i + 1));
  assert.deepEqual(order.slice(0, 6), [1, 33, 17, 9, 41, 25]);
  const firstQuarter = [...order.slice(0, 12)].sort((a, b) => a - b);
  const gaps = firstQuarter.slice(1).map((p, i) => p - firstQuarter[i]);
  assert.ok(Math.max(...gaps) <= 8 && firstQuarter.at(-1)! >= 40, `a quarter of the scan spans the file: ${firstQuarter}`);
  assert.deepEqual(spreadOrder(3), [1, 3, 2]);
  assert.deepEqual(spreadOrder(1), [1]);
  assert.deepEqual(spreadOrder(0), []);
});

test("an abort stops the loop with a plain error", async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    eachWithinBudget([1], new FigureBudget(Date.now() + 5_000), ac.signal, async () => {}),
    (err) => !(err instanceof OverBudget)
  );
});
