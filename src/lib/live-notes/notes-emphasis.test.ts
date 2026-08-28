import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_LECTURE_CONTEXT_MARKER,
  buildLiveNotesStudyContext,
  extractLiveNotesEmphasis,
  formatLiveLectureGenerationBlock,
  isLiveLectureStudyContext,
} from "./notes-emphasis";

test("extractLiveNotesEmphasis pulls student lines and AI headings", () => {
  const emphasis = extractLiveNotesEmphasis({
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { provenance: "ai", level: 2 },
        content: [{ type: "text", text: "Adrenergic receptors" }],
      },
      {
        type: "paragraph",
        attrs: { provenance: null },
        content: [{ type: "text", text: "Ask about the dose table." }],
      },
    ],
  });
  assert.deepEqual(emphasis.aiHeadings, ["Adrenergic receptors"]);
  assert.deepEqual(emphasis.studentLines, ["Ask about the dose table."]);
});

test("buildLiveNotesStudyContext always emits live-lecture source rules", () => {
  const blob = buildLiveNotesStudyContext({
    emphasis: { studentLines: [], aiHeadings: [] },
    lectureTitle: "Pharm 1",
    liveLectureSources: true,
  });
  assert.ok(blob.includes(LIVE_LECTURE_CONTEXT_MARKER));
  assert.match(blob, /speech transcript/);
  assert.match(blob, /slides/);
  assert.match(blob, /once at the richest version/);
  assert.doesNotMatch(blob, /transcript is the only source/i);
  assert.equal(isLiveLectureStudyContext(blob), true);
});

test("buildLiveNotesStudyContext stays quiet for standalone notes without emphasis", () => {
  const blob = buildLiveNotesStudyContext({
    emphasis: { studentLines: [], aiHeadings: [] },
    lectureTitle: "My note",
  });
  assert.equal(blob, "");
  assert.equal(isLiveLectureStudyContext(blob), false);
});

test("formatLiveLectureGenerationBlock instructs thoroughness and de-dupe", () => {
  const ctx = buildLiveNotesStudyContext({
    emphasis: { studentLines: ["focus on MAC"], aiHeadings: [] },
    lectureTitle: "Anesthesia",
    liveLectureSources: true,
  });
  const block = formatLiveLectureGenerationBlock(ctx);
  assert.match(block, /not transcript-only/);
  assert.match(block, /EQUAL primary sources/);
  assert.match(block, /never spoke/);
  assert.match(block, /teach it ONCE/);
  assert.match(block, /Do NOT copy the same table/);
  assert.equal(formatLiveLectureGenerationBlock("plain self-study goal"), "");
});
