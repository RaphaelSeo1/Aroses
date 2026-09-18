import assert from "node:assert/strict";
import test from "node:test";
import {
  SOURCE_CONFIDENCE_RULES,
  SEED_THOROUGHNESS_RULES,
  UNIFIED_NOTES_RULES,
} from "./tutor-notes-quality";
import { buildMentoredNotesPrompt } from "./generate-mentored-notes";
import { buildConceptCoverageBlock } from "@/lib/notes/concept-coverage";
import { stripLinesAlreadyCovered } from "@/lib/notes/cross-section-dedupe";
import { pickRevisableByTranscript } from "@/lib/live-notes/pick-relevant-slide-pages";
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

test("seed thoroughness rules override fold/skip habits so multi-page decks stay complete", () => {
  assert.match(SEED_THOROUGHNESS_RULES, /Thin notes are a failure/);
  assert.match(SEED_THOROUGHNESS_RULES, /EVERY source unit/);
  assert.match(SEED_THOROUGHNESS_RULES, /do NOT license skipping/i);
  assert.match(SEED_THOROUGHNESS_RULES, /Completeness of unique source content wins/);
  assert.match(SEED_THOROUGHNESS_RULES, /Key concepts/);
  // Must not tell the model that restating a covered concept "adds nothing".
  assert.doesNotMatch(SEED_THOROUGHNESS_RULES, /adds nothing/);
  assert.doesNotMatch(SEED_THOROUGHNESS_RULES, /\b(virus|cell|enzyme|accounting)\b/i);
});

test("pump-time strip keeps later-slide elaborations; only exact restatements go", () => {
  // Early batch drafted a short definition; a later slide elaborates with a
  // qualification + mechanism + numbers. A definition-shaped lead-in that ADDS
  // to the earlier one is new information and must survive the live guard.
  const earlier = [
    {
      sectionId: "s-early",
      markdown:
        "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.",
    },
  ];
  const laterSlideDraft = [
    "## Topic A continued",
    "- **Alpha process:** Starts the workflow and validates the input before the beta gate runs.",
    "  - Emits a heartbeat every 5 seconds while it runs.",
    "- **Gamma rule:** Applies after the alpha process finishes; skipped on weekends.",
    "- The alpha process validates the input and starts the workflow.",
  ].join("\n");
  const stripped = stripLinesAlreadyCovered(laterSlideDraft, earlier);
  assert.match(
    stripped,
    /\*\*Alpha process:\*\* Starts the workflow and validates the input before the beta gate runs\./
  );
  assert.match(stripped, /Emits a heartbeat every 5 seconds/);
  assert.match(stripped, /Gamma rule/);
  // The pure restatement (same tokens, reordered) is the only line removed.
  assert.doesNotMatch(stripped, /^- The alpha process validates the input and starts the workflow\.$/m);
});

test("seed revisable ranking prefers sections overlapping the current slide batch", () => {
  const sections = [
    {
      sectionId: "s1",
      markdown: "## Intro\n- Welcome and logistics for the course.",
    },
    {
      sectionId: "s2",
      markdown:
        "## Alpha process\n- **Alpha process:** Starts the workflow and validates the input.",
    },
    {
      sectionId: "s3",
      markdown:
        "## Beta gate\n- **Beta gate:** Checks the input size before anything else runs.",
    },
  ];
  // Document-order first-2 would be Intro + Alpha; relevance should pick Alpha + Beta.
  const picked = pickRevisableByTranscript(
    sections,
    "[slide 12] Alpha process details\nHeartbeat every 5 seconds\n[slide 13] Beta gate thresholds\nInput size checks",
    2
  );
  const ids = picked.map((s) => s.sectionId);
  assert.ok(ids.includes("s2"), `expected alpha section, got ${ids.join(",")}`);
  assert.ok(ids.includes("s3"), `expected beta section, got ${ids.join(",")}`);
  assert.equal(ids.includes("s1"), false);
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
