import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_APP_ADMIN_EMAILS } from "../app-admin-env.ts";
import { buildImpersonationPayload } from "./cookie.ts";
import {
  canStartImpersonationSession,
  isValidImpersonator,
  parseImpersonateTarget,
  resolveProxyViewer,
} from "./guard.ts";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const TARGET_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ID = "33333333-3333-4333-8333-333333333333";

const admin = {
  id: ADMIN_ID,
  email: BUILT_IN_APP_ADMIN_EMAILS[0],
};
const student = { id: TARGET_ID, email: "student@example.com" };

const payload = buildImpersonationPayload({
  adminId: ADMIN_ID,
  targetId: TARGET_ID,
  targetEmail: "student@example.com",
});

test("non-admins cannot start impersonation", () => {
  const denied = canStartImpersonationSession({
    realUser: student,
    existingPayload: null,
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.status, 403);
    assert.equal(denied.error, "Forbidden");
  }
  assert.equal(
    canStartImpersonationSession({
      realUser: null,
      existingPayload: null,
    }).ok,
    false
  );
});

test("admins can start impersonation", () => {
  const allowed = canStartImpersonationSession({
    realUser: admin,
    existingPayload: null,
  });
  assert.equal(allowed.ok, true);
});

test("nested impersonation is rejected", () => {
  const nested = canStartImpersonationSession({
    realUser: admin,
    existingPayload: payload,
  });
  assert.equal(nested.ok, false);
  if (!nested.ok) {
    assert.equal(nested.status, 409);
  }
});

test("cookie is bound to the admin who started it", () => {
  assert.equal(isValidImpersonator(admin, payload), true);
  assert.equal(isValidImpersonator(student, payload), false);
  assert.equal(
    isValidImpersonator({ id: OTHER_ID, email: admin.email }, payload),
    false
  );
});

test("proxy viewer switches to the target and hides the admin hub", () => {
  const viewing = resolveProxyViewer({
    realUser: admin,
    impersonation: payload,
  });
  assert.equal(viewing.isImpersonating, true);
  assert.equal(viewing.viewerId, TARGET_ID);
  assert.equal(viewing.viewerEmail, "student@example.com");
  assert.equal(viewing.allowAdminHub, false);

  const normal = resolveProxyViewer({
    realUser: admin,
    impersonation: null,
  });
  assert.equal(normal.isImpersonating, false);
  assert.equal(normal.viewerId, ADMIN_ID);
  assert.equal(normal.allowAdminHub, true);
});

test("parseImpersonateTarget accepts email or user id", () => {
  assert.deepEqual(parseImpersonateTarget({ email: "  a@b.com  " }), {
    ok: true,
    query: "a@b.com",
  });
  assert.deepEqual(parseImpersonateTarget({ userId: TARGET_ID }), {
    ok: true,
    query: TARGET_ID,
  });
  assert.equal(parseImpersonateTarget({}).ok, false);
  assert.equal(parseImpersonateTarget(null).ok, false);
});
