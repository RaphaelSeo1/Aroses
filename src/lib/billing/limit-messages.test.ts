import assert from "node:assert/strict";
import test from "node:test";
import { resolveBillingPeriod } from "./billing-period.ts";
import {
  extraQuestionsDailyLimitMessage,
  extraQuestionsUsedUpMessage,
  formatLectureHours,
  lectureMinutesUsedUpMessage,
  lectureMinutesWarningMessage,
  resetDateLabel,
  sourcePagesShortMessage,
  sourcePagesUsedUpMessage,
} from "./limit-messages.ts";

const OCT_1 = "2026-10-01T00:00:00.000Z";

test("limit messages say what ran out, when it resets, and how to get more", () => {
  const pages = sourcePagesUsedUpMessage({ tier: "student", cap: 600, periodEnd: OCT_1 });
  assert.match(pages, /all 600 pages of course material/);
  assert.match(pages, /Student plan/);
  assert.match(pages, /reset on October 1/);
  assert.match(pages, /Upgrade your plan for more pages/);

  const lecture = lectureMinutesUsedUpMessage({ tier: "student", capMinutes: 180, periodEnd: OCT_1 });
  assert.match(lecture, /all 3 hours of live lecture notes/);
  assert.match(lecture, /reset on October 1/);
  assert.match(lecture, /more lecture hours/);

  const extra = extraQuestionsUsedUpMessage({ tier: "lite", cap: 50, periodEnd: OCT_1 });
  assert.match(extra, /all 50 extra question sets in your Lite plan/);
  assert.match(
    extraQuestionsUsedUpMessage({ tier: "max", cap: 1000, periodEnd: OCT_1 }),
    /all 1,000 extra question sets/
  );
  const daily = extraQuestionsDailyLimitMessage({
    cap: 60,
    resetsAt: "2026-09-16T00:00:00.000Z",
    now: new Date("2026-09-15T23:40:00.000Z"),
  });
  assert.match(daily, /60 extra question sets today, which is the daily limit/);
  assert.match(daily, /in about 20 minutes/);

  const short = sourcePagesShortMessage({ tier: "plus", remaining: 40, needed: 120, periodEnd: OCT_1 });
  assert.match(short, /120 pages/);
  assert.match(short, /40 pages of course material left/);
});

test("Max has nothing to upgrade to; unpaid accounts are asked to choose a plan", () => {
  assert.doesNotMatch(
    sourcePagesUsedUpMessage({ tier: "max", cap: 5000, periodEnd: OCT_1 }),
    /Upgrade/
  );
  assert.doesNotMatch(
    sourcePagesShortMessage({ tier: "max", remaining: 1, needed: 2, periodEnd: OCT_1 }),
    /upgrade/
  );
  assert.match(sourcePagesUsedUpMessage({ tier: "free", cap: 0, periodEnd: null }), /Choose a plan/);
  assert.match(lectureMinutesUsedUpMessage({ tier: "free", capMinutes: 0, periodEnd: null }), /Choose a plan/);
  assert.match(extraQuestionsUsedUpMessage({ tier: "free", cap: 0, periodEnd: null }), /Choose a plan/);
});

test("hour and date formatting", () => {
  assert.equal(formatLectureHours(60), "1 hour");
  assert.equal(formatLectureHours(120), "2 hours");
  assert.equal(formatLectureHours(90), "1.5 hours");
  assert.equal(formatLectureHours(45), "45 minutes");
  assert.equal(resetDateLabel(OCT_1), "October 1");
  assert.equal(resetDateLabel(null), "your next billing date");
  assert.equal(resetDateLabel("not a date"), "your next billing date");
  assert.match(lectureMinutesWarningMessage(240), /About 4 minutes/);
  assert.match(lectureMinutesWarningMessage(20), /About 1 minute of/);
});

test("resets follow the Stripe period for paid users and the 1st of the month for free", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const paid = resolveBillingPeriod({
    tier: "plus",
    currentPeriodStart: "2026-09-10T08:00:00.000Z",
    currentPeriodEnd: "2026-10-10T08:00:00.000Z",
    now,
  });
  assert.equal(paid.startIso, "2026-09-10T08:00:00.000Z");
  assert.equal(paid.endIso, "2026-10-10T08:00:00.000Z");

  const free = resolveBillingPeriod({ tier: "free", currentPeriodStart: null, currentPeriodEnd: null, now });
  assert.equal(free.startIso, "2026-09-01T00:00:00.000Z");
  assert.equal(free.endIso, OCT_1);

  // A paid row without a Stripe period falls back to the calendar month.
  const noPeriod = resolveBillingPeriod({ tier: "pro", currentPeriodStart: null, currentPeriodEnd: null, now });
  assert.equal(noPeriod.startIso, "2026-09-01T00:00:00.000Z");
});
