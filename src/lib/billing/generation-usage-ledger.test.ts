import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryGenerationLedger,
  additionalMaterialIdempotencyKey,
  initialGenerationIdempotencyKey,
  remainingAfterUpgrade,
  sumUsage,
} from "./generation-usage-ledger.ts";
import { CHECKOUT_PLAN_ORDER, generationDepthForTier } from "./plans.ts";
import { sumSourcePageUnits } from "./source-page-units.ts";
import {
  pdfCapWouldExceed,
  sumActivePdfsForCourse,
} from "./pdf-per-course.ts";
import { resolveCheckoutPriceId } from "./sale.ts";

const PERIOD = "2026-09-01T00:00:00.000Z";
const USER = "user-student";

function studentLedger() {
  return new InMemoryGenerationLedger();
}

test("delete exploit: deleting a course never restores generation credits", () => {
  const ledger = studentLedger();
  const cap = 3;

  const a = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-a",
    jobId: "job-a",
    idempotencyKey: initialGenerationIdempotencyKey("course-a"),
    reason: "initial",
    generationUnits: 1,
    cap,
  });
  assert.equal(a.ok, true);
  if (a.ok) ledger.finalize(a.row.id);
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 1);

  ledger.deleteCourse("course-a");
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 1);

  const b = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-b",
    jobId: "job-b",
    idempotencyKey: initialGenerationIdempotencyKey("course-b"),
    reason: "initial",
    generationUnits: 1,
    cap,
  });
  assert.equal(b.ok, true);
  if (b.ok) ledger.finalize(b.row.id);
  ledger.deleteCourse("course-b");
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 2);

  const c = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-c",
    jobId: "job-c",
    idempotencyKey: initialGenerationIdempotencyKey("course-c"),
    reason: "initial",
    generationUnits: 1,
    cap,
  });
  assert.equal(c.ok, true);
  if (c.ok) ledger.finalize(c.row.id);
  ledger.deleteCourse("course-c");
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 3);

  const d = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-d",
    jobId: "job-d",
    idempotencyKey: initialGenerationIdempotencyKey("course-d"),
    reason: "initial",
    generationUnits: 1,
    cap,
  });
  assert.equal(d.ok, false);
  if (!d.ok) assert.equal(d.code, "course_generation_cap_reached");
});

test("empty course shell without AI generation does not consume a credit", () => {
  const ledger = studentLedger();
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 0);
  ledger.deleteCourse("empty-shell");
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 0);
});

test("failed generation releases the reservation", () => {
  const ledger = studentLedger();
  const reserved = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-fail",
    jobId: "job-fail",
    idempotencyKey: initialGenerationIdempotencyKey("course-fail"),
    reason: "initial",
    generationUnits: 1,
    cap: 3,
  });
  assert.equal(reserved.ok, true);
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 1);
  if (reserved.ok) ledger.release(reserved.row.id);
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 0);
});

test("concurrency: only one of two simultaneous last-slot reserves succeeds", () => {
  const ledger = studentLedger();
  const first = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "basic",
    courseId: "c2",
    jobId: "j2",
    idempotencyKey: initialGenerationIdempotencyKey("c2"),
    reason: "initial",
    generationUnits: 1,
    cap: 1,
  });
  const second = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "basic",
    courseId: "c3",
    jobId: "j3",
    idempotencyKey: initialGenerationIdempotencyKey("c3"),
    reason: "initial",
    generationUnits: 1,
    cap: 1,
  });
  const successes = [first, second].filter((r) => r.ok);
  const failures = [first, second].filter((r) => !r.ok);
  assert.equal(successes.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(ledger.totals(USER, PERIOD).courseGenerations, 1);
});

test("source pages survive course delete and block before AI when exceeded", () => {
  const ledger = studentLedger();
  const cap = 250;
  const a = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "pages-a",
    jobId: "jp-a",
    idempotencyKey: initialGenerationIdempotencyKey("pages-a"),
    reason: "initial",
    generationUnits: 1,
    cap: 3,
  });
  assert.equal(a.ok, true);
  if (!a.ok) return;
  const pagesA = ledger.reserveSourcePages({
    reservationId: a.row.id,
    sourcePageUnits: 100,
    cap,
    userId: USER,
    periodStart: PERIOD,
  });
  assert.equal(pagesA.ok, true);
  ledger.finalize(a.row.id);
  ledger.deleteCourse("pages-a");
  assert.equal(ledger.totals(USER, PERIOD).sourcePages, 100);

  const b = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "pages-b",
    jobId: "jp-b",
    idempotencyKey: initialGenerationIdempotencyKey("pages-b"),
    reason: "initial",
    generationUnits: 1,
    cap: 3,
  });
  assert.equal(b.ok, true);
  if (!b.ok) return;
  const pagesB = ledger.reserveSourcePages({
    reservationId: b.row.id,
    sourcePageUnits: 100,
    cap,
    userId: USER,
    periodStart: PERIOD,
  });
  assert.equal(pagesB.ok, true);
  ledger.finalize(b.row.id);
  assert.equal(ledger.totals(USER, PERIOD).sourcePages, 200);

  const c = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "pages-c",
    jobId: "jp-c",
    idempotencyKey: initialGenerationIdempotencyKey("pages-c"),
    reason: "initial",
    generationUnits: 1,
    cap: 3,
  });
  assert.equal(c.ok, true);
  if (!c.ok) return;
  const over = ledger.reserveSourcePages({
    reservationId: c.row.id,
    sourcePageUnits: 60,
    cap,
    userId: USER,
    periodStart: PERIOD,
  });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.equal(over.code, "source_page_cap_reached");
    assert.equal(over.remaining, 50);
  }
});

test("multi-PDF source units sum every file, not the first PDF only", () => {
  const units = sumSourcePageUnits([
    { kind: "pdf", pageCount: 40 },
    { kind: "pdf", pageCount: 60 },
    { kind: "pdf", pageCount: 20 },
  ]);
  assert.equal(units, 120);
});

test("PDF-per-course cap is cumulative across requests", () => {
  const existing = sumActivePdfsForCourse([
    {
      status: "complete",
      source_files: [
        { originalFileName: "a.pdf", kind: "pdf" },
        { originalFileName: "b.pdf", kind: "pdf" },
      ],
    },
  ]);
  assert.equal(existing, 2);
  assert.equal(
    pdfCapWouldExceed({ activePdfs: existing, incomingPdfs: 2, cap: 3 }),
    true
  );
  assert.equal(
    pdfCapWouldExceed({ activePdfs: existing, incomingPdfs: 1, cap: 3 }),
    false
  );
});

test("additional material on an existing course does not consume another generation", () => {
  const ledger = studentLedger();
  const first = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-a",
    jobId: "job-1",
    idempotencyKey: initialGenerationIdempotencyKey("course-a"),
    reason: "initial",
    generationUnits: 1,
    cap: 3,
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  ledger.reserveSourcePages({
    reservationId: first.row.id,
    sourcePageUnits: 40,
    cap: 250,
    userId: USER,
    periodStart: PERIOD,
  });
  ledger.finalize(first.row.id);

  const extra = ledger.reserveCourseGeneration({
    userId: USER,
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "student",
    courseId: "course-a",
    jobId: "job-2",
    idempotencyKey: additionalMaterialIdempotencyKey("job-2"),
    reason: "additional_material",
    generationUnits: 0,
    cap: 3,
  });
  assert.equal(extra.ok, true);
  if (!extra.ok) return;
  ledger.reserveSourcePages({
    reservationId: extra.row.id,
    sourcePageUnits: 25,
    cap: 250,
    userId: USER,
    periodStart: PERIOD,
  });
  ledger.finalize(extra.row.id);

  const totals = ledger.totals(USER, PERIOD);
  assert.equal(totals.courseGenerations, 1);
  assert.equal(totals.sourcePages, 65);
});

test("legacy Student/Advanced/Premium price IDs still map to those tiers", () => {
  const catalog: Record<string, string[]> = {
    student: ["price_legacy_student", "price_student_reg", "price_student_promo"],
    advanced: ["price_legacy_advanced", "price_adv_reg", "price_adv_promo"],
    premium: ["price_legacy_premium", "price_prem_reg", "price_prem_promo"],
  };
  function match(id: string): string | null {
    for (const [tier, ids] of Object.entries(catalog)) {
      if (ids.includes(id)) return tier;
    }
    return null;
  }
  assert.equal(match("price_legacy_student"), "student");
  assert.equal(match("price_legacy_advanced"), "advanced");
  assert.equal(match("price_legacy_premium"), "premium");
  assert.equal(match("price_student_promo"), "student");
});

test("upgrade raises the cap without resetting used usage", () => {
  const gens = remainingAfterUpgrade({ used: 2, previousCap: 3, nextCap: 10 });
  const pages = remainingAfterUpgrade({
    used: 220,
    previousCap: 250,
    nextCap: 750,
  });
  assert.equal(gens.used, 2);
  assert.equal(gens.cap, 10);
  assert.equal(gens.remaining, 8);
  assert.equal(pages.used, 220);
  assert.equal(pages.cap, 750);
  assert.equal(pages.remaining, 530);
});

test("downgrade never deletes content and future usage uses the lower cap", () => {
  const rows = [
    {
      id: "1",
      userId: USER,
      billingPeriodStart: PERIOD,
      billingPeriodEnd: null,
      tierSnapshot: "advanced",
      courseId: "keep-me",
      jobId: "j",
      idempotencyKey: "k",
      generationReason: "initial" as const,
      courseGenerationUnits: 4,
      sourcePageUnits: 100,
      status: "completed" as const,
      createdAt: PERIOD,
      completedAt: PERIOD,
      releasedAt: null,
    },
  ];
  const used = sumUsage(rows);
  assert.equal(used.courseGenerations, 4);
  const next = remainingAfterUpgrade({
    used: used.courseGenerations,
    previousCap: 10,
    nextCap: 3,
  });
  assert.equal(next.remaining, 0);
  assert.equal(rows[0]?.courseId, "keep-me");
});

test("internal free has no generation entitlement", () => {
  const ledger = studentLedger();
  const blocked = ledger.reserveCourseGeneration({
    userId: "free-user",
    periodStart: PERIOD,
    periodEnd: null,
    tierSnapshot: "free",
    courseId: "c",
    jobId: "j",
    idempotencyKey: "free-c",
    reason: "initial",
    generationUnits: 1,
    cap: 0,
  });
  assert.equal(blocked.ok, false);
});

test("each paid plan snapshots the correct generation depth", () => {
  assert.equal(generationDepthForTier("basic"), "essential");
  assert.equal(generationDepthForTier("student"), "standard");
  assert.equal(generationDepthForTier("plus"), "detailed");
  assert.equal(generationDepthForTier("advanced"), "comprehensive");
  assert.equal(generationDepthForTier("premium"), "maximum");
  for (const tier of CHECKOUT_PLAN_ORDER) {
    assert.notEqual(generationDepthForTier(tier), undefined);
  }
});

test("promo vs regular checkout IDs agree with display charged price path", () => {
  assert.equal(
    resolveCheckoutPriceId(
      { stripePriceId: "reg", stripePromoPriceId: "promo" },
      true
    ),
    "promo"
  );
  assert.equal(
    resolveCheckoutPriceId(
      { stripePriceId: "reg", stripePromoPriceId: "promo" },
      false
    ),
    "reg"
  );
});
