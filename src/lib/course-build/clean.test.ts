import assert from "node:assert/strict";
import test from "node:test";
import { cleanPages, normalizeLine, paginateText } from "./clean.ts";
import { compactOutline, looksLikeTable, numberPages, pageWeight } from "./outline.ts";
import { enDashRanges, fixLessonText, stripFiller } from "./text-rules.ts";

test("letter-spaced PDF text is collapsed", () => {
  assert.equal(normalizeLine("L e c t u r e   1 :   I n t r o d u c t io n"), "Lecture 1: Introduction");
  assert.equal(normalizeLine("© X i a o - J u n   Z h a n g"), "©Xiao-Jun Zhang");
});

test("tabs inside words from split ligatures are joined; column gaps become spaces", () => {
  assert.equal(normalizeLine("where would you \tfi\tnd molecules"), "where would you find molecules");
  assert.equal(normalizeLine("Standards Board (F\tASB) ."), "Standards Board (FASB).");
  assert.equal(normalizeLine("via \tfl\tuorescence microscopy"), "via fluorescence microscopy");
  assert.equal(normalizeLine("Assets\tLiabilities"), "Assets Liabilities");
  assert.equal(normalizeLine("• Specifi c signal sequence"), "• Specific signal sequence");
});

test("page numbers, repeated footers and duplicate lines are dropped", () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({
    n: i + 1,
    text: `Topic ${i + 1} explains a distinct idea number ${i * 7} in detail\nCopyright Example University\n${i + 1}\nhttps://bcourses.example.edu/pages/week-1 ${i + 1}/10`,
  }));
  pages[2].text += "\nA repeated sentence that appears twice.\nA repeated sentence that appears twice.";
  const out = cleanPages(pages);
  assert.equal(out.length, 10);
  for (const p of out) {
    assert.ok(!p.text.includes("Copyright"), p.text);
    assert.ok(!p.text.includes("bcourses"), p.text);
    assert.ok(!/^\d+$/m.test(p.text), p.text);
  }
  assert.equal(out[2].text.split("A repeated sentence").length - 1, 1);
});

test("bullets on their own line join the next line", () => {
  const [p] = cleanPages([{ n: 1, text: "Announcements\n•\nZoom OH today\n•\nMidterm review" }]);
  assert.equal(p.text, "Announcements\n• Zoom OH today\n• Midterm review");
});

test("build-up slides keep only the fullest copy, numbering unchanged", () => {
  const base = "Glycolysis splits glucose into two pyruvate molecules";
  const out = cleanPages([
    { n: 1, text: base },
    { n: 2, text: `${base}\nIt yields a net of 2 ATP per glucose` },
    { n: 3, text: "Pyruvate oxidation happens in the mitochondrial matrix" },
  ]);
  assert.deepEqual(out.map((p) => p.n), [1, 2, 3]);
  assert.equal(out[0].text, "");
  assert.ok(out[1].text.includes("net of 2 ATP"));
});

test("plain text is paginated at paragraph boundaries", () => {
  const para = (i: number) => `Paragraph ${i} ` + "word ".repeat(199);
  const pages = paginateText([1, 2, 3, 4, 5].map(para).join("\n\n"), 500);
  assert.equal(pages.length, 3);
  assert.deepEqual(pages.map((p) => p.n), [1, 2, 3]);
  assert.ok(pages[0].text.startsWith("Paragraph 1"));
});

test("page weights: empty 0, thin 0.5, prose 1, table 2", () => {
  assert.equal(pageWeight("Questions?"), 0);
  assert.equal(pageWeight("A short slide heading with a few words on it only"), 0.5);
  assert.equal(pageWeight("x ".repeat(100)), 1);
  const table = [
    "Item 2015 2014",
    "Cash 1,200 1,050",
    "Receivables 3,400 3,100",
    "Inventory 900 870",
    "Total assets 15,270 15,150",
  ].join("\n");
  assert.equal(looksLikeTable(table), true);
  assert.equal(pageWeight(`${table}\n${"words ".repeat(20)}`), 2);
});

test("compact outline has one short line per page with markers", () => {
  const sources = [
    { index: 0, label: "a.pdf", kind: "pdf", pages: [{ n: 1, text: "" }, { n: 2, text: "Heading\nSee Figure 3 for details" }] },
  ];
  const outline = compactOutline(numberPages(sources), sources);
  assert.equal(outline, "p1 [·] \np2 [F] Heading | See Figure 3 for details");
});

test("numeric ranges get an en dash outside math and code; dates and codes are left alone", () => {
  assert.equal(enDashRanges("slides 12-17 and ages 1-4"), "slides 12–17 and ages 1–4");
  assert.equal(enDashRanges("filed 2024-09-26 as a 10-K"), "filed 2024-09-26 as a 10-K");
  assert.equal(enDashRanges("$5-3=2$ stays, `a 1-2` stays, 3-4 changes"), "$5-3=2$ stays, `a 1-2` stays, 3–4 changes");
});

test("filler openers, closing recaps and strikethrough are removed", () => {
  assert.equal(stripFiller("In this lesson, we will learn X. Glucose is split.\n\nIn summary, glucose is split."), "Glucose is split.");
  assert.equal(fixLessonText("ATP is made ~~twice~~ once."), "ATP is made once.");
});
