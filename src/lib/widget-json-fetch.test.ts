import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  clearSharedJsonGetForTests,
  sharedJsonGet,
} from "./widget-json-fetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  clearSharedJsonGetForTests();
});

test("coalesces concurrent GETs for the same URL into one fetch", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    return new Response(JSON.stringify({ total: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const [a, b] = await Promise.all([
    sharedJsonGet<{ total: number }>("/api/srs/due-counts"),
    sharedJsonGet<{ total: number }>("/api/srs/due-counts"),
  ]);

  assert.equal(attempts, 1);
  assert.equal(a.total, 3);
  assert.equal(b.total, 3);
});

test("aborts a stalled widget request at the client deadline", async () => {
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true }
      );
    });

  const startedAt = Date.now();
  await assert.rejects(
    sharedJsonGet("/api/social/badge-counts", 20),
    /exceeded 20ms/
  );
  assert.ok(Date.now() - startedAt < 250);
});
