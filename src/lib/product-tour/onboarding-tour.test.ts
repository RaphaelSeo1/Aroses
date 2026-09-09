import assert from "node:assert/strict";
import test from "node:test";
import {
  BIO_1A_COURSE_ID,
  BIO_1A_OWNER_ID,
  BIO_1A_TITLE,
  configuredTourCourseId,
  isBio1ATitle,
  isConfiguredTourCourseId,
  pickTourCourseFromList,
} from "./bio-1a.ts";
import {
  afterOnboardingDestination,
  afterTourSkipDestination,
  completedOnboardingRedirectPath,
  productTourStartHref,
  shouldForceOnboarding,
  SUBSCRIPTION_ACCESS_PATH,
  tourCompletionShouldRedirectToSubscription,
} from "./flow.ts";
import { buildFallbackProductTourSteps, buildProductTourSteps } from "./steps.ts";
import { isTourDemoAccessForCourse, parseTourDemoCookie } from "./tour-demo-cookie.ts";

test("Bio 1A identity matches founder titles and the live course id", () => {
  assert.equal(BIO_1A_TITLE, "Bio 1A");
  assert.equal(configuredTourCourseId(), BIO_1A_COURSE_ID);
  assert.equal(isConfiguredTourCourseId(BIO_1A_COURSE_ID), true);
  assert.equal(isBio1ATitle("Bio 1A"), true);
  assert.equal(isBio1ATitle("Biology 1A"), true);
  assert.equal(isBio1ATitle("Bio 1A — General Biology"), true);
  assert.equal(isBio1ATitle("sociologie"), false);
});

test("pickTourCourseFromList prefers the live Bio 1A id over other biology titles", () => {
  const picked = pickTourCourseFromList([
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Biology Exam Crash Course",
      user_id: "c8741f6a-0e13-4b09-b71d-b39bebc88381",
    },
    {
      id: BIO_1A_COURSE_ID,
      title: "Bio 1A",
      user_id: BIO_1A_OWNER_ID,
    },
  ]);
  assert.equal(picked?.id, BIO_1A_COURSE_ID);
  assert.equal(picked?.title, "Bio 1A");
});

test("pickTourCourseFromList falls back to a Bio 1A title when the live id is missing", () => {
  const localId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const picked = pickTourCourseFromList([
    { id: localId, title: "Biology 1A", user_id: BIO_1A_OWNER_ID },
  ]);
  assert.equal(picked?.id, localId);
  assert.equal(pickTourCourseFromList([{ id: localId, title: "Chem 1A" }]), null);
});

test("site tour comes first, then a short Bio 1A dip at Explore", () => {
  const steps = buildProductTourSteps(BIO_1A_COURSE_ID);
  const ids = steps.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 7), [
    "welcome",
    "create-course",
    "course-modes",
    "library-courses",
    "notes-tile",
    "notes-hub",
    "explore",
  ]);
  const bioStart = ids.indexOf("explore-bio-1a");
  assert.ok(bioStart > ids.indexOf("explore"));
  assert.equal(ids[bioStart + 1], "course-overview");
  assert.equal(
    ids.filter((id) => id === "explore-bio-1a" || id === "course-overview").length,
    2
  );
  assert.ok(ids.includes("tutor"));
  assert.ok(ids.includes("account"));
  assert.ok(steps.length <= 12);
  assert.equal(productTourStartHref(BIO_1A_COURSE_ID), "/?tour=1");
});

test("missing Bio 1A keeps the site tour without a fake course id", () => {
  const steps = buildProductTourSteps(null, false);
  assert.deepEqual(
    steps.map((s) => s.id),
    buildFallbackProductTourSteps().map((s) => s.id)
  );
  assert.ok(!steps.some((s) => s.route.startsWith("/explore/")));
  assert.ok(steps.some((s) => s.id === "welcome"));
  assert.ok(steps.some((s) => s.id === "explore"));
});

test("finishing the tour stays on the celebration popup instead of billing", () => {
  assert.equal(afterOnboardingDestination(), "/?tour=1");
  assert.equal(afterTourSkipDestination(), "/?setupUpgrade=1");
  assert.equal(SUBSCRIPTION_ACCESS_PATH, "/dashboard/profile?tab=billing");
  assert.equal(tourCompletionShouldRedirectToSubscription(false), false);
  assert.equal(tourCompletionShouldRedirectToSubscription(true), false);
});

test("already-onboarded users are not forced through setup again", () => {
  assert.equal(shouldForceOnboarding(null), true);
  assert.equal(shouldForceOnboarding(undefined), true);
  assert.equal(shouldForceOnboarding("2026-05-12T23:07:11.829312+00:00"), false);
  assert.equal(completedOnboardingRedirectPath(), "/");
});

test("tour demo cookie only unlocks the matching course id", () => {
  assert.equal(parseTourDemoCookie(BIO_1A_COURSE_ID), BIO_1A_COURSE_ID);
  assert.equal(parseTourDemoCookie("not-a-uuid"), null);
  assert.equal(
    isTourDemoAccessForCourse(BIO_1A_COURSE_ID, BIO_1A_COURSE_ID),
    true
  );
  assert.equal(
    isTourDemoAccessForCourse(
      "11111111-1111-4111-8111-111111111111",
      BIO_1A_COURSE_ID
    ),
    false
  );
});
