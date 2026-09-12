import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImpersonationPayload,
  signImpersonationCookie,
  verifyImpersonationCookie,
} from "./cookie.ts";

const SECRET = "test-impersonation-secret";
const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";

test("signed impersonation cookie round-trips", async () => {
  const payload = buildImpersonationPayload({
    adminId: ADMIN_ID,
    targetId: TARGET_ID,
    targetEmail: "Student@Example.com",
    nowMs: 1_700_000_000_000,
  });
  const token = await signImpersonationCookie(payload, SECRET);
  const verified = await verifyImpersonationCookie(
    token,
    SECRET,
    1_700_000_000_000
  );
  assert.deepEqual(verified, {
    ...payload,
    targetEmail: "student@example.com",
  });
});

test("tampered or unsigned cookies are rejected", async () => {
  const payload = buildImpersonationPayload({
    adminId: ADMIN_ID,
    targetId: TARGET_ID,
    targetEmail: "student@example.com",
  });
  const token = await signImpersonationCookie(payload, SECRET);
  const [body, sig] = token.split(".");
  assert.equal(
    await verifyImpersonationCookie(`${body}.${sig}x`, SECRET),
    null
  );
  assert.equal(await verifyImpersonationCookie(token, "other-secret"), null);
  assert.equal(await verifyImpersonationCookie(token, null), null);
  assert.equal(await verifyImpersonationCookie("not-a-cookie", SECRET), null);
});

test("expired impersonation cookies are rejected", async () => {
  const now = 1_700_000_000_000;
  const payload = buildImpersonationPayload({
    adminId: ADMIN_ID,
    targetId: TARGET_ID,
    targetEmail: "student@example.com",
    nowMs: now,
    maxAgeSec: 60,
  });
  const token = await signImpersonationCookie(payload, SECRET);
  assert.ok(await verifyImpersonationCookie(token, SECRET, now + 30_000));
  assert.equal(
    await verifyImpersonationCookie(token, SECRET, now + 61_000),
    null
  );
});
