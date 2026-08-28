import assert from "node:assert/strict";
import test from "node:test";
import { liveNotesToSourceMarkdown } from "./notes-review";
import { packLiveLectureIngestBlob } from "./pack-ingest";

test("liveNotesToSourceMarkdown includes recap and body", () => {
  const md = liveNotesToSourceMarkdown({
    type: "doc",
    attrs: { roseLectureRecap: "## Recap\nBeta blockers lower HR." },
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Adrenergics" }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Slide table of receptors." }],
      },
    ],
  });
  assert.match(md, /Beta blockers lower HR/);
  assert.match(md, /Adrenergics/);
  assert.match(md, /Slide table of receptors/);
});

test("packLiveLectureIngestBlob keeps both notes and transcript", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Pharm 1",
    notesMarkdown: "## Receptors\nAlpha-1 on vessels.",
    transcript: "[0:12] Today we cover adrenergic receptors.",
    screenContent: "alpha-1 table",
    deckContent: "Slide 4: adrenergic",
  });
  assert.match(blob, /\[from Pharm 1 notes\]/);
  assert.match(blob, /Alpha-1 on vessels/);
  assert.match(blob, /\[from Pharm 1 transcript\]/);
  assert.match(blob, /adrenergic receptors/);
  assert.match(blob, /\[from Pharm 1 screen\]/);
  assert.match(blob, /\[from Pharm 1 slides\]/);
});

test("packLiveLectureIngestBlob omits empty optional parts", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Talk",
    transcript: "Hello class.",
  });
  assert.match(blob, /\[from Talk transcript\]/);
  assert.doesNotMatch(blob, /\[from Talk notes\]/);
  assert.doesNotMatch(blob, /\[from Talk screen\]/);
});
