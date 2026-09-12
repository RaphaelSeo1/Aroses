import assert from "node:assert/strict";
import test from "node:test";
import { BIO_1A_COURSE_ID } from "../product-tour/bio-1a.ts";
import {
  hasPaidProductAccess,
  isBillingSettingsPath,
  isPaidFeaturePath,
  isStripeCheckoutSuccessStatus,
  isUnpaidMutationAllowedApi,
  isUnpaidProductAllowedPath,
  unpaidBillingSettingsShouldRedirect,
  unpaidGateShouldIntercept,
  unpaidGateShouldRedirect,
  unpaidUserHasTourAccess,
  unpaidUserShouldBlockFeaturePath,
  UPGRADE_POPUP_PATH,
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

test("unpaid users may browse hubs but not billing settings or study/create routes", () => {
  assert.equal(isUnpaidProductAllowedPath("/"), true);
  assert.equal(isUnpaidProductAllowedPath("/notes"), true);
  assert.equal(isUnpaidProductAllowedPath("/explore"), true);
  assert.equal(isUnpaidProductAllowedPath("/onboarding"), true);
  assert.equal(isPaidFeaturePath("/dashboard/courses/new"), true);
  assert.equal(
    isPaidFeaturePath("/explore/4b2be649-2da4-4790-a71c-36de0adf704e/study"),
    true
  );
  assert.equal(
    isPaidFeaturePath("/notes/doc/abc/record/sess"),
    true
  );
  assert.equal(isPaidFeaturePath("/notes"), false);
  assert.equal(isBillingSettingsPath("/dashboard/profile", "tab=billing"), true);
  assert.equal(isBillingSettingsPath("/dashboard/profile", "tab=general"), false);
  assert.equal(UPGRADE_POPUP_PATH, "/?upgrade=1");
  assert.equal(
    unpaidBillingSettingsShouldRedirect(
      "/dashboard/profile",
      "tab=billing&status=success"
    ),
    false
  );
  assert.equal(
    unpaidBillingSettingsShouldRedirect(
      "/dashboard/profile",
      "tab=billing&status=cancel"
    ),
    true
  );
  assert.equal(
    unpaidUserShouldBlockFeaturePath("/dashboard/courses/new"),
    true
  );
  assert.equal(unpaidUserShouldBlockFeaturePath("/notes"), false);
  assert.equal(
    unpaidUserShouldBlockFeaturePath(
      "/dashboard/profile",
      "tab=billing&status=success"
    ),
    false
  );
  assert.equal(isStripeCheckoutSuccessStatus("success"), true);
  assert.equal(isStripeCheckoutSuccessStatus("cancel"), false);
});

test("learn, tutor, live notes, review, and note-doc routes are paid features", () => {
  assert.equal(isPaidFeaturePath("/tutor-session"), true);
  assert.equal(isPaidFeaturePath("/tutor-session/active/sess"), true);
  assert.equal(isPaidFeaturePath("/tutor-session/recap/sess"), true);
  assert.equal(isPaidFeaturePath("/sessions"), true);
  assert.equal(isPaidFeaturePath("/sessions/"), true);
  assert.equal(
    isPaidFeaturePath("/dashboard/courses/abc/learn"),
    true
  );
  assert.equal(
    isPaidFeaturePath("/explore/4b2be649-2da4-4790-a71c-36de0adf704e/learn"),
    true
  );
  assert.equal(
    isPaidFeaturePath("/dashboard/courses/abc/live-notes/sess"),
    true
  );
  assert.equal(isPaidFeaturePath("/dashboard/review"), true);
  assert.equal(isPaidFeaturePath("/notes/doc/abc"), true);
  assert.equal(isPaidFeaturePath("/notes/tutor/sess"), true);
  assert.equal(isPaidFeaturePath("/notes/material/mat"), true);
  assert.equal(isPaidFeaturePath("/dashboard/courses/abc"), true);
  assert.equal(isPaidFeaturePath("/dashboard/courses/abc/settings"), true);
  assert.equal(
    isPaidFeaturePath("/dashboard/courses/abc/study/quiz"),
    true
  );
  assert.equal(
    isPaidFeaturePath("/dashboard/courses/abc/study/build"),
    true
  );
  assert.equal(
    isPaidFeaturePath("/dashboard/courses/abc/study/course-mix"),
    true
  );
  assert.equal(unpaidUserShouldBlockFeaturePath("/tutor-session"), true);
  assert.equal(
    unpaidUserShouldBlockFeaturePath("/dashboard/courses/abc/learn"),
    true
  );
  assert.equal(
    unpaidUserShouldBlockFeaturePath("/dashboard/courses/abc"),
    true
  );
  assert.equal(unpaidUserShouldBlockFeaturePath("/notes/tutor/sess"), true);
  assert.equal(unpaidUserShouldBlockFeaturePath("/notes/material/mat"), true);
  assert.equal(unpaidUserShouldBlockFeaturePath("/dashboard/courses"), false);
});

test("hubs, profile, help, and public pages stay browseable", () => {
  assert.equal(isPaidFeaturePath("/"), false);
  assert.equal(isPaidFeaturePath("/notes"), false);
  assert.equal(isPaidFeaturePath("/notes/"), false);
  assert.equal(isPaidFeaturePath("/explore"), false);
  assert.equal(
    isPaidFeaturePath("/explore/4b2be649-2da4-4790-a71c-36de0adf704e"),
    false
  );
  assert.equal(isPaidFeaturePath("/dashboard"), false);
  assert.equal(isPaidFeaturePath("/dashboard/courses"), false);
  assert.equal(isPaidFeaturePath("/dashboard/courses/"), false);
  assert.equal(isPaidFeaturePath("/dashboard/profile"), false);
  assert.equal(isPaidFeaturePath("/dashboard/profile", "tab=general"), false);
  assert.equal(isPaidFeaturePath("/help"), false);
  assert.equal(isPaidFeaturePath("/onboarding"), false);
  assert.equal(isPaidFeaturePath("/login"), false);
  assert.equal(isPaidFeaturePath("/intro"), false);
  assert.equal(isPaidFeaturePath("/forum"), false);
  assert.equal(isPaidFeaturePath("/calendar"), false);
  assert.equal(isPaidFeaturePath("/library/courses"), false);
  assert.equal(unpaidUserShouldBlockFeaturePath("/dashboard/profile"), false);
  assert.equal(
    unpaidUserShouldBlockFeaturePath("/dashboard/profile", "tab=billing"),
    true
  );
});

test("unknown client access intercepts like unpaid without redirecting yet", () => {
  assert.equal(unpaidGateShouldIntercept("unknown", false), true);
  assert.equal(unpaidGateShouldIntercept("unpaid", false), true);
  assert.equal(unpaidGateShouldIntercept("paid", false), false);
  assert.equal(unpaidGateShouldIntercept("unknown", true), false);
  assert.equal(unpaidGateShouldRedirect("unknown", false), false);
  assert.equal(unpaidGateShouldRedirect("unpaid", false), true);
  assert.equal(unpaidGateShouldRedirect("paid", false), false);
  assert.equal(unpaidGateShouldRedirect("unpaid", true), false);
});

test("unpaid mutations may still hit billing, tour, onboarding, and ui-locale APIs", () => {
  assert.equal(isUnpaidMutationAllowedApi("/api/billing/checkout"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/billing/webhook"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/product-tour/complete"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/onboarding"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/ui-locale"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/admin/impersonate"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/admin/impersonate/exit"), true);
  assert.equal(isUnpaidMutationAllowedApi("/api/notes"), false);
  assert.equal(isUnpaidMutationAllowedApi("/api/notes/bulk"), false);
  assert.equal(isUnpaidMutationAllowedApi("/api/courses"), false);
  assert.equal(isUnpaidMutationAllowedApi("/api/courses/reorder"), false);
  assert.equal(isUnpaidMutationAllowedApi("/api/live-notes"), false);
});

test("a tour demo cookie unlocks the in-progress walkthrough", () => {
  assert.equal(unpaidUserHasTourAccess(BIO_1A_COURSE_ID), true);
  assert.equal(unpaidUserHasTourAccess(null), false);
});
