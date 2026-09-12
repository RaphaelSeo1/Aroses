import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_APP_ADMIN_EMAILS } from "../app-admin-env.ts";
import { resolvePlanMeterCaps } from "./plan-meter-caps.ts";
import { lectureRecordingCap, voiceCapSeconds } from "./plans.ts";

const OTHER_ID = "22222222-2222-4222-8222-222222222222";

test("app admins get unlimited courses, voice, and recordings", () => {
  const caps = resolvePlanMeterCaps(
    { id: OTHER_ID, email: BUILT_IN_APP_ADMIN_EMAILS[0] },
    "premium"
  );
  assert.equal(caps.unlimited, true);
  assert.equal(caps.coursesCap, null);
  assert.equal(caps.voiceCapSeconds, null);
  assert.equal(caps.recordingsCap, null);
});

test("admin unlimited is not the Stripe Premium quota", () => {
  const premium = resolvePlanMeterCaps(
    { id: OTHER_ID, email: "student@example.com" },
    "premium"
  );
  assert.equal(premium.unlimited, false);
  assert.equal(premium.coursesCap, null);
  assert.equal(premium.voiceCapSeconds, voiceCapSeconds("premium"));
  assert.equal(premium.recordingsCap, lectureRecordingCap("premium"));
  assert.equal(premium.voiceCapSeconds, 15 * 3600);
  assert.equal(premium.recordingsCap, 20);
});

test("normal paid and free users keep their plan meters", () => {
  const student = resolvePlanMeterCaps(
    { id: OTHER_ID, email: "student@example.com" },
    "student"
  );
  assert.equal(student.unlimited, false);
  assert.equal(student.coursesCap, 2);
  assert.equal(student.voiceCapSeconds, 5 * 3600);
  assert.equal(student.recordingsCap, 5);

  const free = resolvePlanMeterCaps(
    { id: OTHER_ID, email: "unpaid@example.com" },
    "free"
  );
  assert.equal(free.unlimited, false);
  assert.equal(free.coursesCap, 0);
  assert.equal(free.voiceCapSeconds, 0);
  assert.equal(free.recordingsCap, 0);
});
