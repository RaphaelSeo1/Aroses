import assert from "node:assert/strict";
import test from "node:test";
import { BIO_1A_COURSE_ID } from "../product-tour/bio-1a.ts";
import {
  hasPaidProductAccess,
  isUnpaidProductAllowedPath,
  unpaidUserHasTourAccess,
} from "./paid-access.ts";

test("unpaid free/inactive users cannot use the product", () => {
  assert.equal(hasPaidProductAccess(null), false);
  assert.equal(hasPaidProductAccess({ tier: "free", status: "inactive" }), false);
  assert.equal(hasPaidProductAccess({ tier: "student", status: "canceled" }), false);
});

test("active paid tiers and admin-granted paid tiers have access", () => {
  assert.equal(
    hasPaidProductAccess({ tier: "student", status: "active" }),
    true
  );
  assert.equal(
    hasPaidProductAccess({ tier: "advanced", status: "trialing" }),
    true
  );
  assert.equal(
    hasPaidProductAccess({
      tier: "premium",
      status: "inactive",
      adminGranted: true,
    }),
    true
  );
});

test("unpaid users may reach onboarding, billing, help, and tour query starts", () => {
  assert.equal(isUnpaidProductAllowedPath("/onboarding"), true);
  assert.equal(isUnpaidProductAllowedPath("/dashboard/profile", "tab=billing"), true);
  assert.equal(isUnpaidProductAllowedPath("/help"), true);
  assert.equal(isUnpaidProductAllowedPath("/", "tour=1"), true);
  assert.equal(isUnpaidProductAllowedPath("/", "setupUpgrade=1"), true);
  assert.equal(isUnpaidProductAllowedPath("/notes"), false);
  assert.equal(isUnpaidProductAllowedPath("/"), false);
});

test("a tour demo cookie unlocks the in-progress walkthrough", () => {
  assert.equal(unpaidUserHasTourAccess(BIO_1A_COURSE_ID), true);
  assert.equal(unpaidUserHasTourAccess(null), false);
});
