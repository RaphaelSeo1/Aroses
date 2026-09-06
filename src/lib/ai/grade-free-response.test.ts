import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_RESPONSE_GRADING_SYSTEM,
  buildFreeResponseGradingPrompt,
  parseFreeResponseGrade,
} from "./grade-free-response";

test("grading policy evaluates concepts instead of reference wording", () => {
  assert.match(FREE_RESPONSE_GRADING_SYSTEM, /not whether they copied/i);
  assert.match(FREE_RESPONSE_GRADING_SYSTEM, /synonyms, paraphrases/i);
  assert.match(FREE_RESPONSE_GRADING_SYSTEM, /Do not penalize grammar/i);
  assert.match(FREE_RESPONSE_GRADING_SYSTEM, /Do not require every detail/i);
});

test("mostly-correct conceptual understanding passes with a nuanced verdict", () => {
  const grade = parseFreeResponseGrade(
    JSON.stringify({
      verdict: "mostly_correct",
      feedback:
        "You correctly explain the core feedback loop; clarify that the receptor detects pressure rather than oxygen.",
    })
  );
  assert.equal(grade.correct, true);
  assert.equal(grade.verdict, "mostly_correct");
  assert.match(grade.feedback, /correctly explain/);
});

test("a material misconception remains incorrect with specific feedback", () => {
  const grade = parseFreeResponseGrade(
    JSON.stringify({
      verdict: "needs_work",
      feedback:
        "You identify the nucleus, but importin—not DNA—carries NLS-tagged cargo through the pore.",
    })
  );
  assert.equal(grade.correct, false);
  assert.equal(grade.verdict, "needs_work");
});

test("legacy boolean model output remains compatible", () => {
  assert.equal(
    parseFreeResponseGrade('{"correct":true,"feedback":"Equivalent reasoning."}')
      .verdict,
    "correct"
  );
});

test("grading prompt clearly separates rubric from student prose", () => {
  const prompt = buildFreeResponseGradingPrompt({
    question: "Why does the response occur?",
    referenceAnswer: "Negative feedback restores the set point.",
    studentAnswer: "The system counteracts the change to return toward normal.",
  });
  assert.match(prompt, /REFERENCE RUBRIC:/);
  assert.match(prompt, /STUDENT ANSWER:/);
  assert.match(prompt, /counteracts the change/);
});
