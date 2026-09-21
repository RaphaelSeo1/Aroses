import assert from "node:assert/strict";
import test from "node:test";
import {
  isSitePauseExemptPath,
  isSitePaused,
  sitePauseAllowsUser,
} from "./site-pause.ts";

function withPauseEnv(value: string | undefined, run: () => void) {
  const prevPublic = process.env.NEXT_PUBLIC_SITE_PAUSED;
  const prev = process.env.SITE_PAUSED;
  if (value === undefined) {
    delete process.env.NEXT_PUBLIC_SITE_PAUSED;
    delete process.env.SITE_PAUSED;
  } else {
    process.env.NEXT_PUBLIC_SITE_PAUSED = value;
    delete process.env.SITE_PAUSED;
  }
  try {
    run();
  } finally {
    if (prevPublic === undefined) delete process.env.NEXT_PUBLIC_SITE_PAUSED;
    else process.env.NEXT_PUBLIC_SITE_PAUSED = prevPublic;
    if (prev === undefined) delete process.env.SITE_PAUSED;
    else process.env.SITE_PAUSED = prev;
  }
}

test("site pause defaults on", () => {
  withPauseEnv(undefined, () => {
    assert.equal(isSitePaused(), true);
  });
});

test("site pause turns off only for an explicit disable", () => {
  for (const off of ["0", "false", "off"]) {
    withPauseEnv(off, () => {
      assert.equal(isSitePaused(), false);
    });
  }
  withPauseEnv("1", () => {
    assert.equal(isSitePaused(), true);
  });
});

test("only the founder account gets through while paused", () => {
  withPauseEnv("1", () => {
    assert.equal(
      sitePauseAllowsUser({ id: "founder", email: "raphaelxseo@gmail.com" }),
      true
    );
    assert.equal(
      sitePauseAllowsUser({ id: "student", email: "student@berkeley.edu" }),
      false
    );
    assert.equal(sitePauseAllowsUser(null), false);
  });
});

test("pause keeps login, password reset, the notice, and Stripe webhooks", () => {
  assert.equal(isSitePauseExemptPath("/paused"), true);
  assert.equal(isSitePauseExemptPath("/login"), true);
  assert.equal(isSitePauseExemptPath("/reset-password"), true);
  assert.equal(isSitePauseExemptPath("/api/billing/webhook"), true);
  assert.equal(isSitePauseExemptPath("/"), false);
  assert.equal(isSitePauseExemptPath("/intro"), false);
  assert.equal(isSitePauseExemptPath("/signup"), false);
  assert.equal(isSitePauseExemptPath("/api/process-pdf"), false);
});
