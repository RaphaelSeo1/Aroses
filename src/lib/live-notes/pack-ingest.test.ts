import assert from "node:assert/strict";
import test from "node:test";
import { splitCombinedSourceBlocks } from "../study-ingest/combine";
import { liveNotesToSourceMarkdown } from "./notes-review";
import {
  LIVE_LECTURE_INGEST_MAX,
  packLiveLectureIngestBlob,
} from "./pack-ingest";

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

test("packLiveLectureIngestBlob keeps notes, transcript, slides, and screen", () => {
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
  assert.match(blob, /===== SOURCE 1\/4 — FILE: Pharm 1 \[notes\] =====/);
  assert.match(blob, /===== SOURCE 3\/4 — FILE: Pharm 1 \[slides\] =====/);
});

test("packLiveLectureIngestBlob omits empty optional parts", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Talk",
    transcript: "Hello class.",
  });
  assert.match(blob, /\[from Talk transcript\]/);
  assert.doesNotMatch(blob, /\[from Talk notes\]/);
  assert.doesNotMatch(blob, /\[from Talk screen\]/);
  assert.doesNotMatch(blob, /===== SOURCE/);
});

test("packLiveLectureIngestBlob includes a chat handout when present", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Talk",
    transcript: "Hello class, see the worksheet.",
    handoutContent: "Worksheet Q1: name the receptor subtypes.",
  });
  assert.match(blob, /\[from Talk handout\]/);
  assert.match(blob, /receptor subtypes/);
});

test("long notes and transcript cannot drop unique slide content", () => {
  const blob = packLiveLectureIngestBlob({
    title: "X",
    notesMarkdown: `NOTES_TOKEN ${"N".repeat(250_000)}`,
    transcript: `SPEECH_TOKEN ${"T".repeat(250_000)}`,
    deckContent: `SLIDE_TOKEN unique-page-never-spoken ${"S".repeat(250_000)}`,
  });
  assert.ok(blob.length <= LIVE_LECTURE_INGEST_MAX);
  assert.match(blob, /\[from X notes\]/);
  assert.match(blob, /NOTES_TOKEN/);
  assert.match(blob, /\[from X transcript\]/);
  assert.match(blob, /SPEECH_TOKEN/);
  assert.match(blob, /\[from X slides\]/);
  assert.match(blob, /SLIDE_TOKEN unique-page-never-spoken/);
  const slideIdx = blob.indexOf("[from X slides]");
  const afterSlides = blob.slice(slideIdx);
  assert.ok(
    afterSlides.length > 80_000,
    `slides share too small: ${afterSlides.length}`
  );
});

test("unused notes budget is donated to slides rather than left empty", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Y",
    notesMarkdown: "Short notes.",
    transcript: `SPEECH ${"T".repeat(200_000)}`,
    deckContent: `DECK_START ${"S".repeat(200_000)} DECK_END`,
  });
  assert.match(blob, /Short notes/);
  assert.match(blob, /DECK_START/);
  const slideIdx = blob.indexOf("[from Y slides]");
  assert.ok(slideIdx >= 0);
  assert.ok(
    blob.slice(slideIdx).length > 90_000,
    "slides should inherit unused notes budget"
  );
});

test("packed multi-source blob splits on SOURCE markers for fair truncation", () => {
  const blob = packLiveLectureIngestBlob({
    title: "Z",
    notesMarkdown: "Note body unique.",
    transcript: "Speech body unique.",
    deckContent: "Slide body unique.",
  });
  const { preamble, blocks } = splitCombinedSourceBlocks(blob);
  assert.match(preamble, /Live lecture capture/);
  assert.equal(blocks.length, 3);
  assert.ok(blocks.some((b) => b.body.includes("[from Z notes]")));
  assert.ok(blocks.some((b) => b.body.includes("[from Z transcript]")));
  assert.ok(blocks.some((b) => b.body.includes("[from Z slides]")));
  assert.ok(blocks.every((b) => b.marker.startsWith("===== SOURCE ")));
});
