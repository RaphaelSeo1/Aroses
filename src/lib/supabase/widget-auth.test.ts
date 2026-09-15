import assert from "node:assert/strict";
import test from "node:test";
import { decideWidgetAuth, firstResolvedOrNull } from "./widget-auth.ts";

test("transport timeouts fail open to empty counts", () => {
  assert.equal(
    decideWidgetAuth(null, { message: "Supabase request exceeded 1000ms" }),
    "empty"
  );
});

test("missing session and signed-out callers fail open to empty counts", () => {
  assert.equal(
    decideWidgetAuth(null, { message: "Auth session missing!" }),
    "empty"
  );
  assert.equal(decideWidgetAuth(null, null), "empty");
});

test("a signed-in user proceeds", () => {
  assert.equal(decideWidgetAuth({ id: "user-1" }, null), "proceed");
});

test("non-transport auth errors stay unavailable", () => {
  assert.equal(
    decideWidgetAuth(null, { message: "Invalid JWT" }),
    "unavailable"
  );
});

test("firstResolvedOrNull returns the value before the deadline", async () => {
  const value = await firstResolvedOrNull(
    Promise.resolve("ok"),
    50
  );
  assert.equal(value, "ok");
});

test("firstResolvedOrNull returns null when the deadline elapses", async () => {
  const startedAt = Date.now();
  const value = await firstResolvedOrNull(
    new Promise<string>(() => {}),
    20
  );
  assert.equal(value, null);
  assert.ok(Date.now() - startedAt < 250);
});
