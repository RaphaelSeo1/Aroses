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
  completedOnboardingRedirectPath,
  productTourStartHref,
  shouldForceOnboarding,
  SUBSCRIPTION_ACCESS_PATH,
  tourCompletionShouldRedirectToSubscription,
} from "./flow.ts";
import { buildFallbackProductTourSteps, buildProductTourSteps, hrefForTourStep } from "./steps.ts";
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

test("onboarding tour steps walk Explore Bio 1A modules, notes, quiz, and review", () => {
  const steps = buildProductTourSteps(BIO_1A_COURSE_ID);
  const routes = steps.map((s) => s.route);
  assert.ok(routes.includes("/explore"));
  assert.ok(routes.includes(`/explore/${BIO_1A_COURSE_ID}`));
  assert.ok(routes.includes(`/explore/${BIO_1A_COURSE_ID}/study`));
  assert.ok(routes.includes(`/explore/${BIO_1A_COURSE_ID}/study/quiz`));
  assert.ok(routes.includes("/notes"));
  assert.ok(routes.includes("/dashboard/review"));
  assert.equal(
    hrefForTourStep(steps.find((s) => s.id === "lesson-content")!),
    `/explore/${BIO_1A_COURSE_ID}/study?mode=learn`
  );
  assert.equal(productTourStartHref(BIO_1A_COURSE_ID), `/explore/${BIO_1A_COURSE_ID}?tour=1`);
});

test("missing Bio 1A falls back to Explore, notes, and review without a fake course id", () => {
  const steps = buildProductTourSteps(null, false);
  assert.deepEqual(
    steps.map((s) => s.route),
    buildFallbackProductTourSteps().map((s) => s.route)
  );
  assert.ok(!steps.some((s) => s.route.startsWith("/explore/")));
});

test("finishing onboarding or the tour sends new users to subscription access", () => {
  assert.equal(afterOnboardingDestination(), SUBSCRIPTION_ACCESS_PATH);
  assert.equal(SUBSCRIPTION_ACCESS_PATH, "/dashboard/profile?tab=billing");
  assert.equal(tourCompletionShouldRedirectToSubscription(false), true);
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
