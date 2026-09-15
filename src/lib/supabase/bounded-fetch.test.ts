import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  AUTH_SUPABASE_TIMEOUT_MS,
  DEFAULT_SUPABASE_TIMEOUT_MS,
  WIDGET_SUPABASE_TIMEOUT_MS,
  createBoundedSupabaseFetch,
  createBoundedSupabaseFetchWithRetry,
} from "./bounded-fetch.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("returns a successful upstream response", async () => {
  globalThis.fetch = async () => new Response("ok", { status: 200 });

  const response = await createBoundedSupabaseFetch(50)(
    "https://example.test"
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "ok");
});

test("aborts a stalled upstream request at the configured deadline", async () => {
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
    createBoundedSupabaseFetch(20)("https://example.test"),
    /exceeded 20ms/
  );
  assert.ok(Date.now() - startedAt < 250);
});

test("preserves cancellation from the caller", async () => {
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(init.signal?.reason),
        { once: true }
      );
    });

  const controller = new AbortController();
  const request = createBoundedSupabaseFetch(1_000)(
    "https://example.test",
    { signal: controller.signal }
  );
  controller.abort(new Error("caller cancelled"));

  await assert.rejects(request, /caller cancelled/);
});

test("retries once after a deadline abort then succeeds", async () => {
  let attempts = 0;
  globalThis.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Promise<Response>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Supabase request exceeded 20ms")), 25);
      });
    }
    return new Response("ok", { status: 200 });
  };

  const response = await createBoundedSupabaseFetchWithRetry(20, 1)(
    "https://example.test"
  );

  assert.equal(attempts, 2);
  assert.equal(response.status, 200);
});

test("badge widgets fail open much faster than proxy/page auth", () => {
  assert.equal(WIDGET_SUPABASE_TIMEOUT_MS, 1_000);
  assert.equal(AUTH_SUPABASE_TIMEOUT_MS, 12_000);
  assert.equal(DEFAULT_SUPABASE_TIMEOUT_MS, 5_000);
  assert.ok(WIDGET_SUPABASE_TIMEOUT_MS < DEFAULT_SUPABASE_TIMEOUT_MS);
  assert.ok(DEFAULT_SUPABASE_TIMEOUT_MS < AUTH_SUPABASE_TIMEOUT_MS);
});
