import assert from "node:assert/strict";
import test from "node:test";
import {
  LECTURE_WARN_SECONDS,
  lectureAllowanceFrom,
  lectureLimitState,
  lectureMeterDelta,
  sessionLimitSeconds,
} from "./lecture-minutes.ts";
import { lectureCapSeconds } from "./plans.ts";

const NO_ENV = {};

test("each tier's lecture hours become a seconds cap", () => {
  assert.equal(lectureCapSeconds("free", NO_ENV), 0);
  assert.equal(lectureCapSeconds("lite", NO_ENV), 2 * 3600);
  assert.equal(lectureCapSeconds("student", NO_ENV), 3 * 3600);
  assert.equal(lectureCapSeconds("plus", NO_ENV), 8 * 3600);
  assert.equal(lectureCapSeconds("pro", NO_ENV), 12 * 3600);
  assert.equal(lectureCapSeconds("max", NO_ENV), 25 * 3600);
});

test("usage is the larger of the server meter and the session sum", () => {
  const cap = 3 * 3600;
  const a = lectureAllowanceFrom({ capSeconds: cap, meterSeconds: 3000, sessionSeconds: 1200, unlimited: false });
  assert.equal(a.usedSeconds, 3000);
  assert.equal(a.remainingSeconds, cap - 3000);
  assert.equal(a.allowed, true);

  // Before migration 119 the meter is missing (null): the session sum still limits.
  const b = lectureAllowanceFrom({ capSeconds: cap, meterSeconds: null, sessionSeconds: cap, unlimited: false });
  assert.equal(b.usedSeconds, cap);
  assert.equal(b.allowed, false);
});

test("no minutes left blocks a new session; admins are never blocked", () => {
  const free = lectureAllowanceFrom({ capSeconds: 0, meterSeconds: 0, sessionSeconds: 0, unlimited: false });
  assert.equal(free.allowed, false);
  const admin = lectureAllowanceFrom({ capSeconds: 0, meterSeconds: 99999, sessionSeconds: 99999, unlimited: true });
  assert.equal(admin.allowed, true);
  assert.equal(sessionLimitSeconds({ allowance: admin, sessionRecordedSeconds: 10 }), null);
});

test("a running session stops at what it has recorded plus what's left", () => {
  const allowance = lectureAllowanceFrom({ capSeconds: 7200, meterSeconds: 6000, sessionSeconds: 6000, unlimited: false });
  // This session already recorded 600 s (inside the 6000 used).
  assert.equal(sessionLimitSeconds({ allowance, sessionRecordedSeconds: 600 }), 600 + 1200);
});

test("warns near the limit, then reports reached", () => {
  const limit = 3600;
  assert.equal(lectureLimitState(0, limit), "ok");
  assert.equal(lectureLimitState(limit - LECTURE_WARN_SECONDS - 1, limit), "ok");
  assert.equal(lectureLimitState(limit - LECTURE_WARN_SECONDS, limit), "warn");
  assert.equal(lectureLimitState(limit - 1, limit), "warn");
  assert.equal(lectureLimitState(limit, limit), "reached");
  assert.equal(lectureLimitState(limit + 30, limit), "reached");
  assert.equal(lectureLimitState(99999, null), "ok");
});

test("the meter moves in whole-minute steps, with the tail on completion", () => {
  assert.equal(lectureMeterDelta({ durationSeconds: 50, meteredSeconds: 0 }), 0);
  assert.equal(lectureMeterDelta({ durationSeconds: 61, meteredSeconds: 0 }), 61);
  assert.equal(lectureMeterDelta({ durationSeconds: 130, meteredSeconds: 100 }), 0);
  assert.equal(lectureMeterDelta({ durationSeconds: 130, meteredSeconds: 100, final: true }), 30);
  assert.equal(lectureMeterDelta({ durationSeconds: 90, meteredSeconds: 120, final: true }), 0);
});
