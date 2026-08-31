import assert from "node:assert/strict";
import test from "node:test";
import type { DeckPage } from "./slide-pages";
import {
  formatDeckToc,
  parseSlideNumsFromQuery,
  pickRelevantSlidePages,
  pickRevisableByTranscript,
  pickSlidePagesForChat,
} from "./pick-relevant-slide-pages";

function page(pageNum: number, title: string, extractedText: string): DeckPage {
  return { pageNum, title, extractedText };
}

const DECK: DeckPage[] = [
  page(1, "Agenda", "Welcome and overview of the course."),
  page(2, "Adrenergic receptors", "Alpha-1 on vessels. Beta-1 on the heart."),
  page(12, "Dose table", "Epinephrine 1 mg IV. Norepinephrine drip."),
  page(13, "Summary", "Match receptor to organ and pick the right pressor."),
  page(40, "Appendix", "Extra reading list and citations."),
  ...Array.from({ length: 60 }, (_, i) =>
    page(41 + i, `Filler ${41 + i}`, `Padding slide ${41 + i} about weather.`)
  ),
];

test("parseSlideNumsFromQuery reads slide and page ranges", () => {
  assert.deepEqual(parseSlideNumsFromQuery("what's on slide 12?"), [12]);
  assert.deepEqual(parseSlideNumsFromQuery("slides 12-14 please"), [12, 13, 14]);
  assert.deepEqual(parseSlideNumsFromQuery("see page 3 and pages 5–6"), [3, 5, 6]);
});

test("pickRelevantSlidePages still requires overlap for synth", () => {
  const none = pickRelevantSlidePages({
    pages: DECK,
    transcriptSlice: "um okay right",
  });
  assert.equal(none.text, "");
  const hit = pickRelevantSlidePages({
    pages: DECK,
    transcriptSlice: "adrenergic receptors on the heart",
  });
  assert.ok(hit.pageNums.includes(2));
  assert.ok(!hit.pageNums.includes(40));
});

test("pickSlidePagesForChat prefers an explicit slide over dumping the deck", () => {
  const picked = pickSlidePagesForChat({
    pages: DECK,
    message: "What dose is on slide 12?",
  });
  assert.ok(picked.pageNums.includes(12));
  assert.match(picked.text, /Epinephrine 1 mg IV/);
  assert.doesNotMatch(picked.text, /Padding slide 80/);
  assert.match(picked.text, /DECK INDEX/);
  assert.match(picked.text, /40\. Appendix/);
  assert.ok(picked.text.length < 16_000);
});

test("pickSlidePagesForChat matches a topical question to the right slides", () => {
  const picked = pickSlidePagesForChat({
    pages: DECK,
    message: "What did the slides say about adrenergic receptors?",
  });
  assert.ok(picked.pageNums.includes(2));
  assert.match(picked.text, /Alpha-1 on vessels/);
  assert.doesNotMatch(picked.text, /Padding slide 80/);
});

test("pickSlidePagesForChat falls back to a prefix plus TOC when nothing matches", () => {
  const picked = pickSlidePagesForChat({
    pages: DECK,
    message: "??",
  });
  assert.ok(picked.pageNums.includes(1));
  assert.ok(picked.pageNums.length <= 6);
  assert.match(picked.text, /Welcome and overview/);
  assert.match(picked.text, /DECK INDEX/);
  assert.doesNotMatch(picked.text, /Padding slide 80/);
});

test("formatDeckToc lists titles and caps long decks", () => {
  const toc = formatDeckToc(DECK, 200);
  assert.match(toc, /1\. Agenda/);
  assert.match(toc, /more slides/);
});

test("pickRevisableByTranscript keeps an early slide draft when speech matches it", () => {
  const filler = Array.from({ length: 8 }, (_, i) => ({
    markdown: `## Filler ${i + 1}\n- Padding about weather and logistics.`,
  }));
  const sections = [
    { markdown: "## Adrenergic receptors\n- Alpha-1 on vessels. Beta-1 on the heart." },
    ...filler,
    { markdown: "## Appendix\n- Extra reading list and citations." },
  ];
  const picked = pickRevisableByTranscript(
    sections,
    "let's go back to adrenergic receptors on the heart",
    4
  );
  assert.ok(
    picked.some((s) => s.markdown.includes("Adrenergic receptors")),
    "early draft must stay revisable, not only the last-N sections"
  );
  assert.ok(picked.length <= 4);
  assert.ok(
    picked.some((s) => s.markdown.includes("Appendix")),
    "newest sections stay in the window for live continuation"
  );
});
