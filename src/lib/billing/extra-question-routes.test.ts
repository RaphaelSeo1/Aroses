import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

/**
 * Every AI question-set route shares the monthly + daily extra-question
 * meter: reserve before the AI call, answer the limit with the shared 429,
 * refund when generation or saving fails.
 */
const ROUTES: Array<{ file: string; generate: string; refunds: number }> = [
  {
    file: "src/app/api/study-materials/[materialId]/modules/[moduleId]/append-quiz/route.ts",
    generate: "generateAdditionalModuleQuizItems(",
    refunds: 2,
  },
  {
    file: "src/app/api/notes/focus-questions/route.ts",
    generate: "generatePersonalQuizFromNotes(",
    refunds: 3,
  },
  {
    file: "src/app/api/study-materials/[materialId]/personal-quiz/generate/route.ts",
    generate: "generatePersonalQuizFromNotes(",
    refunds: 2,
  },
];

for (const route of ROUTES) {
  test(`${route.file} is metered as one extra question set per click`, () => {
    const src = readFileSync(route.file, "utf8");
    const reserveAt = src.indexOf("await reserveExtraQuestionClick(user)");
    const generateAt = src.indexOf(route.generate, src.indexOf("export async function POST"));
    assert.ok(reserveAt > 0, "reserves a click");
    assert.ok(generateAt > reserveAt, "reserves before the AI call");
    assert.match(src, /if \(!quota\.allowed\) return extraQuestionLimitResponse\(quota\);/);
    const refunds = src.match(/await quota\.refund\(\);/g)?.length ?? 0;
    assert.equal(refunds, route.refunds, "refunds on every failure path");
  });
}
