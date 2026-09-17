import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeNoteOutput } from "./sanitize-note-output";
import { createMarkerParser } from "./marker-protocol";
import { takeDeckSeedBatch } from "./slide-pages";
import {
  applyAppendChunkActions,
  applyAiLineDeletes,
  applySurgicalNoteRevision,
  assertNoDuplicateTopics,
  classifyAppendChunks,
  deleteExactNoteLines,
  findDuplicateTopicGroups,
  formatDeckDraftExcerpt,
  looksLikeRecapOrOutlineSlide,
  mergeDuplicateGroup,
  placeIncomingNoteLines,
  uniqueIncomingNoteLines,
} from "./fold-note-markdown";

const topicA = {
  sectionId: "s-topic-a",
  markdown: [
    "## Topic A",
    "- **Alpha process:** Starts the workflow.",
    "- **Beta gate:** Checks the input size.",
  ].join("\n"),
};

const topicB = {
  sectionId: "s-topic-b",
  markdown: [
    "## Topic B",
    "- **Gamma rule:** Applies after Topic A.",
  ].join("\n"),
};

test("seed: two batches covering Topic A stay one section", () => {
  const batch1 = applyAppendChunkActions(
    [],
    "## Topic A\n- **Alpha process:** Starts the workflow.",
    "s-1"
  );
  const batch2 = applyAppendChunkActions(
    batch1,
    "## Topic A (continued)\n- **Beta gate:** Checks the input size.\n- **Alpha process:** Starts the workflow.",
    "s-2"
  );
  assert.equal(batch2.length, 1);
  assert.match(batch2[0]!.markdown, /Alpha process/);
  assert.match(batch2[0]!.markdown, /Beta gate/);
  assertNoDuplicateTopics(batch2);
});

test("seed: recap batch restating A and B creates no new sections", () => {
  const seeded = [topicA, topicB];
  assert.equal(
    looksLikeRecapOrOutlineSlide(
      "Key concepts review",
      "Topic A\nTopic B\nAlpha process\nGamma rule",
      ["Topic A", "Topic B"]
    ),
    true
  );
  const afterRecap = applyAppendChunkActions(
    seeded,
    [
      "## Topic A summary",
      "- **Alpha process:** Starts the workflow.",
      "## Topic B overview",
      "- **Gamma rule:** Applies after Topic A.",
    ].join("\n"),
    "s-recap"
  );
  assert.equal(afterRecap.length, 2);
  assertNoDuplicateTopics(afterRecap);

  // Production hard filter: a review-titled chunk that does not match a
  // section heading must not create a new section.
  const reviewOnly = classifyAppendChunks(
    [
      "## Key concepts review",
      "- Topic A",
      "- Topic B",
      "- Alpha process",
      "- Gamma rule",
    ].join("\n"),
    seeded
  );
  assert.equal(
    reviewOnly.filter((a) => a.kind === "new").length,
    0,
    "recap/outline slide must not become a new section"
  );
});

test("seed: empty-text slides produce no output lines", () => {
  const cleaned = sanitizeNoteOutput("");
  assert.equal(cleaned, "");
  const actions = classifyAppendChunks("", [topicA]);
  assert.deepEqual(actions, []);

  const batch = takeDeckSeedBatch(
    [
      { pageNum: 1, title: "", extractedText: "   " },
      { pageNum: 2, title: "Topic A", extractedText: "## Topic A\n- point" },
      { pageNum: 3, title: "", extractedText: "" },
    ],
    0
  );
  assert.equal(batch.pages.length, 1);
  assert.equal(batch.pages[0]!.pageNum, 2);
  assert.doesNotMatch(batch.text, /\[slide 1\]/);
  assert.doesNotMatch(batch.text, /\[slide 3\]/);
});

test("live: multi-target revise parser flushes each revision", () => {
  const parser = createMarkerParser(
    new Set(["s-topic-a", "s-topic-b"]),
    "s-new"
  );
  const events = [
    ...parser.push("@@revise s-topic-a\n"),
    ...parser.push("- **Alpha process:** Starts the workflow with a timer.\n"),
    ...parser.push("@@revise s-topic-b\n"),
    ...parser.push("- **Gamma rule:** Applies after Topic A quietly.\n"),
    ...parser.push("@@append\n"),
    ...parser.push("## Topic C\n- **Delta note:** Brand new idea.\n"),
    ...parser.push("@@summary\n"),
    ...parser.push("A then B then C\n"),
    ...parser.flush(),
  ];
  const ops = events.filter((e) => e.type === "op");
  assert.equal(ops.length, 3);
  assert.equal(ops[0]!.type === "op" && ops[0].op, "revise");
  assert.equal(ops[0]!.type === "op" && ops[0].sectionId, "s-topic-a");
  assert.equal(ops[1]!.type === "op" && ops[1].op, "revise");
  assert.equal(ops[1]!.type === "op" && ops[1].sectionId, "s-topic-b");
  assert.equal(ops[2]!.type === "op" && ops[2].op, "append");

  // Simulate pump fold: two revises + append only C.
  let doc = [topicA, topicB];
  doc = doc.map((s) =>
    s.sectionId === "s-topic-a"
      ? {
          ...s,
          markdown: applySurgicalNoteRevision(
            s.markdown,
            "- **Alpha process:** Starts the workflow with a timer."
          ).markdown,
        }
      : s.sectionId === "s-topic-b"
        ? {
            ...s,
            markdown: applySurgicalNoteRevision(
              s.markdown,
              "- **Gamma rule:** Applies after Topic A quietly."
            ).markdown,
          }
        : s
  );
  doc = applyAppendChunkActions(
    doc,
    "## Topic C\n- **Delta note:** Brand new idea.",
    "s-new"
  );
  assert.equal(doc.length, 3);
  assert.match(doc[2]!.markdown, /Topic C/);
  assert.doesNotMatch(doc[2]!.markdown, /Topic A/);
  assertNoDuplicateTopics(doc);
});

test("live append: reworded A folds; C becomes new section", () => {
  const doc = applyAppendChunkActions(
    [topicA, topicB],
    [
      "## Topic A basics",
      "- **Alpha process:** Starts the workflow.",
      "- Extra detail about the timer.",
      "## Topic C",
      "- **Delta note:** Brand new idea.",
    ].join("\n"),
    "s-c"
  );
  assert.equal(doc.length, 3);
  assert.match(doc[0]!.markdown, /timer|Extra detail/i);
  assert.match(doc[2]!.markdown, /Topic C/);
  assertNoDuplicateTopics(doc);
});

test("sanitizer drops placeholders, protocol leaks, meta, empty heading, dangling colon", () => {
  const dirty = [
    "<nothing — all content folded into @@revise>",
    "@@revise leaked",
    "Slides 91 and 92 contain minimal or no selectable text; this section will be updated.",
    "## Orphan heading",
    "- Dangling lead-in:",
    "## Topic A",
    "- **Alpha process:** Starts the workflow.",
  ].join("\n");
  const clean = sanitizeNoteOutput(dirty);
  assert.doesNotMatch(clean, /folded into/);
  assert.doesNotMatch(clean, /@@/);
  assert.doesNotMatch(clean, /selectable text/);
  assert.doesNotMatch(clean, /Orphan heading/);
  assert.doesNotMatch(clean, /Dangling lead-in/);
  assert.match(clean, /Alpha process/);
});

test("sanitizer drops truncated trailing line on abnormal end", () => {
  const cut = "## Topic A\n- **Alpha process:** Starts the workflow.\n- while the cell sur";
  const kept = sanitizeNoteOutput(cut, { dropTruncatedTrailing: true });
  assert.match(kept, /Alpha process/);
  assert.doesNotMatch(kept, /while the cell sur/);
  const normal = sanitizeNoteOutput(cut);
  assert.match(normal, /while the cell sur/);
});

test("extension placement: sub-detail lands under its parent", () => {
  const existing = [
    "## Topic A",
    "- **Alpha process:** Starts the workflow.",
    "- **Beta gate:** Checks the input size.",
  ].join("\n");
  const placed = placeIncomingNoteLines(
    existing,
    "  - Uses a helper step shown for Alpha process."
  );
  const lines = placed.split("\n");
  const alphaIdx = lines.findIndex((l) => /Alpha process/.test(l));
  const childIdx = lines.findIndex((l) => /helper step/.test(l));
  const betaIdx = lines.findIndex((l) => /Beta gate/.test(l));
  assert.ok(alphaIdx >= 0 && childIdx >= 0 && betaIdx >= 0);
  assert.ok(childIdx > alphaIdx && childIdx < betaIdx);
});

test("extension placement: new top-level bullet appends at end; duplicates drop", () => {
  const existing = "## Topic A\n- **Alpha process:** Starts the workflow.";
  const withNew = placeIncomingNoteLines(
    existing,
    "- **Omega flag:** Completely separate idea."
  );
  assert.match(withNew, /Omega flag/);
  assert.ok(withNew.trimEnd().endsWith("Completely separate idea."));

  const dup = uniqueIncomingNoteLines(
    existing,
    "- **Alpha process:** Starts the workflow."
  );
  assert.equal(dup, "");

  const nearDup = uniqueIncomingNoteLines(
    existing,
    "- **Alpha process:** Starts the overall workflow."
  );
  assert.equal(nearDup, "");
});

test("@@delete removes exact AI line; ignored for student-edited and unknown", () => {
  const existing = [
    "## Topic A",
    "- **Alpha process:** Starts the workflow.",
    "- **Beta gate:** Checks the input size.",
  ].join("\n");
  const next = deleteExactNoteLines(
    existing,
    "- **Beta gate:** Checks the input size."
  );
  assert.doesNotMatch(next, /Beta gate/);
  assert.match(next, /Alpha process/);

  // Unknown / non-matching body leaves doc unchanged.
  assert.equal(
    deleteExactNoteLines(existing, "- **Zeta:** Not present."),
    existing
  );

  // Student-edited sections ignore @@delete (production pump uses this helper).
  const student = applyAiLineDeletes(
    { markdown: existing, studentEdited: true },
    "- **Alpha process:** Starts the workflow."
  );
  assert.equal(student, existing);
  assert.match(student, /Alpha process/);

  const aiOk = applyAiLineDeletes(
    { markdown: existing, studentEdited: false },
    "- **Alpha process:** Starts the workflow."
  );
  assert.doesNotMatch(aiOk, /Alpha process/);
  assert.match(aiOk, /Beta gate/);
});

test("wrap-up: three reworded Topic A copies consolidate to one earliest id", () => {
  const copies = [
    {
      sectionId: "s-early",
      markdown: "## Topic A\n- **Alpha process:** Starts the workflow.",
    },
    {
      sectionId: "s-mid",
      markdown:
        "## Topic A overview\n- **Alpha process:** Starts the workflow.\n- **Beta gate:** Checks the input size.",
    },
    {
      sectionId: "s-late",
      markdown:
        "## Topic A basics\n- **Omega flag:** Completely separate idea under A.",
    },
  ];
  const groups = findDuplicateTopicGroups(copies);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]!.keep.sectionId, "s-early");
  const merged = mergeDuplicateGroup(groups[0]!);
  assert.equal(merged.sectionId, "s-early");
  assert.deepEqual(merged.removeSectionIds.sort(), ["s-late", "s-mid"]);
  assert.match(merged.markdown, /Alpha process/);
  assert.match(merged.markdown, /Beta gate/);
  assert.match(merged.markdown, /Omega flag/);
  assertNoDuplicateTopics([
    { sectionId: merged.sectionId, markdown: merged.markdown },
  ]);
});

test("formatDeckDraftExcerpt stores page range", () => {
  assert.equal(
    formatDeckDraftExcerpt(3, 8),
    "[drafted from uploaded slides; pages 3-8]"
  );
});

test("marker parser handles @@delete body and unknown id skip", () => {
  const parser = createMarkerParser(new Set(["s-topic-a"]), "s-new");
  const events = [
    ...parser.push("@@delete s-topic-a\n"),
    ...parser.push("- **Beta gate:** Checks the input size.\n"),
    ...parser.push("@@delete s-unknown\n"),
    ...parser.push("- should be swallowed\n"),
    ...parser.push("@@append\n"),
    ...parser.flush(),
  ];
  const ops = events.filter((e) => e.type === "op");
  assert.equal(ops.length, 2);
  assert.equal(ops[0]!.type === "op" && ops[0].op, "delete");
  assert.equal(ops[1]!.type === "op" && ops[1].op, "append");
  const texts = events
    .filter((e) => e.type === "text")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
  assert.match(texts, /Beta gate/);
  assert.doesNotMatch(texts, /swallowed/);
});
