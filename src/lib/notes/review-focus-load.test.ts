import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

function src(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

test("Review fetch paths do not UPDATE or DELETE personal quiz rows", () => {
  const files = [
    "src/app/api/srs/practice-scope/route.ts",
    "src/app/api/srs/session/route.ts",
    "src/lib/srs-due-counts-server.ts",
  ];
  for (const file of files) {
    const text = src(file);
    assert.equal(
      text.includes("repairOrphanNotesFocusCards"),
      false,
      `${file} must not call orphan repair`
    );
    assert.equal(
      text.includes("relinkNoteFocusQuestionsForExistingMaterial"),
      false,
      `${file} must not attach-to-course on fetch`
    );
    assert.match(
      text,
      /from\("user_personal_quiz_items"\)/,
      `${file} should read quiz rows`
    );
    assert.equal(
      /user_personal_quiz_items[\s\S]{0,400}\.update\(/.test(text),
      false,
      `${file} must not UPDATE user_personal_quiz_items`
    );
    assert.equal(
      /user_personal_quiz_items[\s\S]{0,400}\.delete\(/.test(text),
      false,
      `${file} must not DELETE user_personal_quiz_items`
    );
  }
});
