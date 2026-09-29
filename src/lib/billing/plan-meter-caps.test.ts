import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_APP_ADMIN_EMAILS } from "../app-admin-env.ts";
import { resolvePlanMeterCaps } from "./plan-meter-caps.ts";
import {
  extraQuestionCap,
  lectureCapSeconds,
  sourcePageCap,
  voiceCapSeconds,
} from "./plans.ts";

const OTHER_ID = "22222222-2222-4222-8222-222222222222";

test("app admins get unlimited everything regardless of tier", () => {
  for (const tier of ["free", "lite", "max"] as const) {
    const caps = resolvePlanMeterCaps(
      { id: OTHER_ID, email: BUILT_IN_APP_ADMIN_EMAILS[0] },
      tier
    );
    assert.equal(caps.unlimited, true, tier);
    assert.equal(caps.courseGenerationsCap, null);
    assert.equal(caps.sourcePagesCap, null);
    assert.equal(caps.lectureCapSeconds, null);
    assert.equal(caps.voiceCapSeconds, null);
    assert.equal(caps.chatMessagesCap, null);
    assert.equal(caps.extraQuestionsCap, null);
  }
});

test("a top-tier student gets Max quotas, not admin unlimited", () => {
  const max = resolvePlanMeterCaps({ id: OTHER_ID, email: "student@example.com" }, "max");
  assert.equal(max.unlimited, false);
  assert.equal(max.courseGenerationsCap, null);
  assert.equal(max.sourcePagesCap, 5000);
  assert.equal(max.lectureCapSeconds, 25 * 3600);
  assert.equal(max.voiceCapSeconds, 150 * 60);
  assert.equal(max.chatMessagesCap, 1000);
  assert.equal(max.extraQuestionsCap, 1000);
});

test("normal paid and free users keep their plan meters", () => {
  const student = resolvePlanMeterCaps(
    { id: OTHER_ID, email: "student@example.com" },
    "student"
  );
  assert.equal(student.unlimited, false);
  assert.equal(student.sourcePagesCap, sourcePageCap("student"));
  assert.equal(student.lectureCapSeconds, lectureCapSeconds("student"));
  assert.equal(student.voiceCapSeconds, voiceCapSeconds("student"));
  assert.equal(student.extraQuestionsCap, extraQuestionCap("student"));

  const free = resolvePlanMeterCaps({ id: OTHER_ID, email: "unpaid@example.com" }, "free");
  assert.equal(free.unlimited, false);
  assert.equal(free.courseGenerationsCap, 0);
  assert.equal(free.sourcePagesCap, 0);
  assert.equal(free.lectureCapSeconds, 0);
  assert.equal(free.voiceCapSeconds, 0);
  assert.equal(free.extraQuestionsCap, 0);
  assert.equal(free.chatMessagesCap, 20);
});
