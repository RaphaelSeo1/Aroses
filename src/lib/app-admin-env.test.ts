import assert from "node:assert/strict";
import test from "node:test";
import { isAppAdminEnvUser, requireAppAdminUser } from "./app-admin-env.ts";

const ENV_KEYS = [
  "APP_ADMIN_USER_IDS",
  "APP_ADMIN_EMAILS",
  "NEXT_PUBLIC_APP_ADMIN_USER_IDS",
  "NEXT_PUBLIC_APP_ADMIN_EMAILS",
] as const;

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function withAdminEnv(
  env: Partial<Record<(typeof ENV_KEYS)[number], string>>,
  fn: () => void
) {
  const prev = Object.fromEntries(
    ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<(typeof ENV_KEYS)[number], string | undefined>;
  try {
    for (const key of ENV_KEYS) {
      const next = env[key];
      if (next === undefined) delete process.env[key];
      else process.env[key] = next;
    }
    fn();
  } finally {
    for (const key of ENV_KEYS) {
      const value = prev[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("requireAppAdminUser rejects missing session (API guard)", () => {
  withAdminEnv({ APP_ADMIN_USER_IDS: ADMIN_ID }, () => {
    const missing = requireAppAdminUser(null);
    assert.equal(missing.ok, false);
    if (!missing.ok) {
      assert.equal(missing.status, 403);
      assert.equal(missing.error, "Forbidden");
    }
  });
});

test("requireAppAdminUser rejects non-admin users (API guard)", () => {
  withAdminEnv(
    {
      APP_ADMIN_USER_IDS: ADMIN_ID,
      APP_ADMIN_EMAILS: "founder@aroses.app",
    },
    () => {
      const denied = requireAppAdminUser({
        id: OTHER_ID,
        email: "seller@example.com",
      });
      assert.equal(denied.ok, false);
      if (!denied.ok) {
        assert.equal(denied.status, 403);
        assert.equal(denied.error, "Forbidden");
      }
      assert.equal(
        isAppAdminEnvUser({ id: OTHER_ID, email: "seller@example.com" }),
        false
      );
    }
  );
});

test("requireAppAdminUser allows allowlisted id or email", () => {
  withAdminEnv(
    {
      APP_ADMIN_USER_IDS: ADMIN_ID,
      APP_ADMIN_EMAILS: "founder@aroses.app",
    },
    () => {
      const byId = requireAppAdminUser({
        id: ADMIN_ID,
        email: "other@example.com",
      });
      assert.equal(byId.ok, true);

      const byEmail = requireAppAdminUser({
        id: OTHER_ID,
        email: "Founder@Aroses.app",
      });
      assert.equal(byEmail.ok, true);
    }
  );
});
