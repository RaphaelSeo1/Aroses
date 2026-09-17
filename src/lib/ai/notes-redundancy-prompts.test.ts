import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CONFIDENCE_RULES,
  UNIFIED_NOTES_RULES,
} from "./tutor-notes-quality";
import { buildMentoredNotesPrompt } from "./generate-mentored-notes";
import { buildConceptCoverageBlock } from "@/lib/notes/concept-coverage";
import type { MentoredLessonChunk } from "@/types/mentored";

test("unified document rules: one explanation, later mentions add only new info", () => {
  assert.match(UNIFIED_NOTES_RULES, /one coherent set of notes/i);
  assert.match(UNIFIED_NOTES_RULES, /repeated EVIDENCE, not new note content/);
  assert.match(UNIFIED_NOTES_RULES, /do not re-define or re-explain/i);
  assert.match(UNIFIED_NOTES_RULES, /genuinely new/i);
  assert.match(UNIFIED_NOTES_RULES, /repeated terminology is expected/i);
  assert.match(UNIFIED_NOTES_RULES, /not for shorter output/i);
  // Subject-neutral: no domain vocabulary baked in.
  assert.doesNotMatch(UNIFIED_NOTES_RULES, /\b(virus|cell|enzyme|accounting|treaty|derivative)\b/i);
});

test("source confidence rules: uncertain transcript tokens never become facts", () => {
  assert.match(SOURCE_CONFIDENCE_RULES, /Never turn an unclear token into a confident fact/);
  assert.match(SOURCE_CONFIDENCE_RULES, /instructor-provided written material; slides/);
  assert.match(SOURCE_CONFIDENCE_RULES, /\*\*Open question:\*\*/);
  assert.match(SOURCE_CONFIDENCE_RULES, /Never fabricate/);
});

test("mentored chunk prompt carries prior-notes coverage so later chunks add, not repeat", () => {
  const chunk = {
    id: "c2",
    concept: "Topic B",
    explanation: "Now we connect Topic B to the alpha process.",
    keyPoints: ["Gamma rule applies after alpha"],
    referenceAnswer: "",
  } as unknown as MentoredLessonChunk;
  const prior = buildConceptCoverageBlock(
    [
      {
        sectionId: "s-a",
        markdown:
          "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.\n  - Runs once per request.",
      },
    ],
    { relevanceText: chunk.concept }
  );
  const prompt = buildMentoredNotesPrompt({
    chunk,
    courseTitle: "Course",
    moduleTitle: "Module",
    priorNotesCoverage: prior,
  });
  assert.match(prompt, /ALREADY IN THE STUDENT'S NOTES/);
  assert.match(prompt, /\*\*Alpha process\*\* — DEFINED \+ EXPLAINED in \[s-a\] Topic A/);
  assert.match(prompt, /do not re-define or re-explain/);

  const without = buildMentoredNotesPrompt({
    chunk,
    courseTitle: "Course",
    moduleTitle: "Module",
  });
  assert.doesNotMatch(without, /ALREADY IN THE STUDENT'S NOTES/);
});
