import test from "node:test";
import assert from "node:assert/strict";

import { concatTransform, transformPoint } from "../pdf-ingest/bbox-math.ts";
import { pageCoverage } from "./coverage.ts";
import { mergeGapLessons, spanModulePages, toCourseModule, uncoveredPages } from "./module.ts";
import { numberBacking, stripUnbackedNumbers, unbackedNumbers } from "./numbers.ts";
import { docxHtmlToText, slideXmlToText } from "./office-text.ts";
import { pageWeight, type BuildPage } from "./outline.ts";
import { layoutPageText, type TextItem } from "./pdf-layout.ts";
import { repairPlan } from "./plan.ts";
import { ensureTables, markdownTables } from "./tables.ts";

const item = (str: string, x: number, y: number, fontSize = 10): TextItem => ({ str, x, y, fontSize, width: str.length * fontSize * 0.5 });

test("pdf text: a laid-out grid becomes a markdown table, prose stays prose", () => {
  const rows = [
    ["Country", "Price", "Quantity"],
    ["Spain", "4.20", "120"],
    ["France", "5.10", "95"],
    ["Italy", "3.80", "140"],
  ];
  const items = [item("Demand varies with price across the three markets.", 50, 700)];
  rows.forEach((r, i) => r.forEach((cell, j) => items.push(item(cell, 50 + j * 120, 660 - i * 14))));
  items.push(item("Lower prices sell more units.", 50, 580));
  const text = layoutPageText(items);
  assert.match(text, /^Demand varies with price across the three markets\./);
  assert.ok(
    text.includes("| Country | Price | Quantity |\n| --- | --- | --- |\n| Spain | 4.20 | 120 |\n| France | 5.10 | 95 |\n| Italy | 3.80 | 140 |"),
    text
  );
  assert.match(text, /Lower prices sell more units\.$/);
});

test("pdf text: two cells inside one text item are split at the wide gap", () => {
  const items = [
    item("Good    Units", 50, 700),
    item("Apples    12", 50, 686),
    item("Pears    30", 50, 672),
    item("Plums    7", 50, 658),
  ];
  assert.equal(markdownTables(layoutPageText(items))[0]?.split("\n")[2], "| Apples | 12 |");
});

test("pdf text: scattered handwriting fragments are not mistaken for a table", () => {
  const items = [
    item("H", 60, 700), item("O", 140, 702), item("x", 300, 698),
    item("C", 62, 680), item("=", 180, 681), item("→", 320, 679),
    item("N", 58, 660), item("H2", 150, 661), item("+", 290, 659),
  ];
  assert.equal(markdownTables(layoutPageText(items)).length, 0);
});

test("pdf text: letters split into separate items are joined back into words", () => {
  const items = [item("A", 50, 700), item("TP", 55.5, 700), item(" is made in the mitochondria.", 66, 700)];
  assert.equal(layoutPageText(items), "ATP is made in the mitochondria.");
});

test("pdf images: a browser-printed page's scale-and-flip is applied after the image's own placement", () => {
  // The accounting handout's balance sheet: page cm, then the image cm.
  let ctm = concatTransform([1, 0, 0, 1, 0, 0], [0.24, 0, 0, -0.24, 0, 792]);
  ctm = concatTransform(ctm, [2000, 0, 0, -1675, 275, 1981.25]);
  const corners = [transformPoint(ctm, 0, 0), transformPoint(ctm, 1, 1)];
  const [x0, x1] = [corners[0]!.x, corners[1]!.x].sort((a, b) => a - b);
  const [y0, y1] = [corners[0]!.y, corners[1]!.y].sort((a, b) => a - b);
  assert.deepEqual([x0, y0, x1, y1].map((v) => Math.round(v!)), [66, 317, 546, 719], "on the 612×792 page");
});

test("office files: slide and Word tables come out as markdown tables", () => {
  const slide =
    '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree>' +
    "<p:sp><p:txBody><a:p><a:r><a:t>Ratios</a:t></a:r></a:p></p:txBody></p:sp>" +
    "<p:graphicFrame><a:graphic><a:graphicData><a:tbl>" +
    "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Ratio</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Formula</a:t></a:r></a:p></a:txBody></a:tc></a:tr>" +
    "<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Current</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>CA / CL</a:t></a:r></a:p></a:txBody></a:tc></a:tr>" +
    "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>" +
    "</p:spTree></p:cSld></p:sld>";
  assert.equal(slideXmlToText(slide), "Ratios\n| Ratio | Formula |\n| --- | --- |\n| Current | CA / CL |");
  const html = "<p>Intro</p><table><tr><td><p>Account</p></td><td><p>Debit</p></td></tr><tr><td><p>Cash</p></td><td><p>500</p></td></tr></table>";
  assert.equal(docxHtmlToText(html), "Intro\n\n| Account | Debit |\n| --- | --- |\n| Cash | 500 |");
});

test("numbers: stated, rescaled, rounded and shown calculations pass; invented ones don't", () => {
  const backing = numberBacking("Revenue was $197 million and costs were $120 million. Normal blood pH is 7.4; the ratio is 0.456.");
  assert.deepEqual(unbackedNumbers("Revenue was $197 million, i.e. 197,000,000 dollars.", backing), []);
  assert.deepEqual(unbackedNumbers("The ratio is about 0.46, or 45.6%.", backing), []);
  assert.deepEqual(unbackedNumbers("Profit is 197 − 120 = 77 million. So the 77 million is what remains.", backing), []);
  assert.deepEqual(unbackedNumbers("Arterial blood ranges from 7.35 to 7.45.", backing), ["7.35", "7.45"]);
  assert.deepEqual(unbackedNumbers("A typical firm earns 12% margins.", backing), ["12"]);
  assert.deepEqual(unbackedNumbers("Step 3 of 5; CH3CH2OH; 2,3-dimethylbutane; the 21st century.", backing), []);
});

test("numbers: a step the source sets up in a sentence passes; arithmetic on a bare list of page numbers doesn't", () => {
  const backing = numberBacking("The net number of shares circulating is the 420 number minus the 70.\nSee pages 16, 17, 22, 32.");
  assert.deepEqual(unbackedNumbers("Kellogg had about 350 million shares outstanding.", backing), []);
  assert.deepEqual(unbackedNumbers("A weak acid is 50% dissociated at its pKa.", backing), ["50"]);
});

test("numbers: stripping drops the sentence or list item that invents a number, nothing else", () => {
  const backing = numberBacking("Normal blood pH is 7.4.");
  const { text, removed } = stripUnbackedNumbers(
    "Blood pH is 7.4. Its normal range is 7.35–7.45. Buffers keep it steady.\n\n- pH 7.4 is neutral-ish\n- Acidosis starts below 7.35\n\n| pH | State |\n| --- | --- |\n| 7.2 | Low |",
    backing
  );
  assert.equal(text, "Blood pH is 7.4. Buffers keep it steady.\n\n- pH 7.4 is neutral-ish\n\n| pH | State |\n| --- | --- |\n| 7.2 | Low |");
  assert.deepEqual(removed, ["7.35", "7.45", "7.35"]);
});

const PAGES = [
  { g: 1, text: "Osmosis moves water across a semipermeable membrane toward higher solute concentration. Tonicity describes the solution." },
  { g: 2, text: "Hypertonic solutions shrink erythrocytes by crenation; hypotonic solutions swell them until hemolysis at 0.45% saline." },
  { g: 3, text: "Diffusion needs no energy. Facilitated diffusion uses carrier proteins such as GLUT1 transporters." },
];

test("coverage: a page whose own words and numbers never appear in the lessons is uncovered", () => {
  const written = "Osmosis moves water across a semipermeable membrane; tonicity describes the solution. Diffusion needs no energy, and facilitated diffusion uses carrier proteins like GLUT1 transporters.";
  const cov = pageCoverage(PAGES, PAGES, written);
  assert.deepEqual(cov.filter((c) => !c.covered).map((c) => c.g), [2]);
  const all = pageCoverage(PAGES, PAGES, `${written} Hypertonic solutions shrink erythrocytes (crenation); hypotonic ones swell them to hemolysis at 0.45% saline.`);
  assert.ok(all.every((c) => c.covered));
});

test("coverage: handwriting and label fragments on a page don't hide that its prose was taught", () => {
  const page = {
    g: 4,
    text:
      "Class I aldolase enzymes use a lysine side chain to form an enamine with one reactant.\nThe enamine acts as a nucleophile in the carbon-carbon bond-forming step, and the iminium\nion is hydrolyzed to release fructose bisphosphate. Fill in the intermediates in the scheme.\n-H\nOPO2-\noH\"- Las\n\"500T\nopen\nKqz\nRNx",
  };
  const written = "Class I aldolase uses a lysine side chain to form an enamine; the enamine is the nucleophile in the carbon-carbon bond-forming step, and hydrolysis of the iminium ion releases fructose bisphosphate.";
  const [cov] = pageCoverage([page], [...PAGES, page], written);
  assert.equal(cov!.covered, true, `words ${cov!.words}`);
});

test("coverage: a slide's video link doesn't make its one taught sentence look untaught", () => {
  // Lewis MCB 104 lecture 2, p37: a title and a movie link sent the page to the gap writer twice.
  const page = { g: 5, text: "NPC are oriented in the nuclear envelope\nMovie: https://www.youtube.com/watch?v=UyhqLpjicZg" };
  const written = "Nuclear pore complexes (NPC) are oriented in the nuclear envelope, with a cytoplasmic and a nucleoplasmic face.";
  const nuclear = [6, 7, 8].map((g) => ({ g, text: `Nuclear lamins line the nuclear membrane (slide ${g}).` }));
  const [cov] = pageCoverage([page], [...PAGES, ...nuclear, page], written);
  assert.equal(cov!.covered, true, `words ${cov!.words}`);
});

test("coverage: lesson page ranges are stretched to span every content page", () => {
  const ranges = [
    { first: 2, last: 3 },
    { first: 6, last: 7 },
  ];
  spanModulePages(ranges, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(ranges, [
    { first: 1, last: 5 },
    { first: 6, last: 8 },
  ]);
});

test("gap lessons join the module as lessons, or as sections once the module has five", () => {
  const gap = [{ title: "Tonicity", content: "Hypertonic solutions shrink cells.", first_page: 2, last_page: 2 }];
  const few = mergeGapLessons({ lessons: [{ title: "A", content: "a", first_page: 1, last_page: 1 }] }, gap);
  assert.deepEqual((few.lessons as Array<{ title: string }>).map((l) => l.title), ["A", "Tonicity"]);
  const five = Array.from({ length: 5 }, (_, i) => ({ title: `L${i}`, content: `c${i}`, first_page: i * 2 + 1, last_page: i * 2 + 1 }));
  const merged = mergeGapLessons({ lessons: five }, gap).lessons as Array<{ title: string; content: string }>;
  assert.equal(merged.length, 5);
  assert.match(merged[0]!.content, /c0\n\n### Tonicity\n\nHypertonic solutions shrink cells\./);
});

test("tables: a table the writer paraphrased is restored exactly; a dropped one is inserted", () => {
  const table = "| Drug | Dose |\n| --- | --- |\n| Diazepam | 5 mg |\n| Lorazepam | 1 mg |";
  const pages = [
    { g: 1, text: `Benzodiazepines act on GABA-A receptors.\n${table}` },
    { g: 2, text: "Barbiturates\n| Drug | Onset |\n| --- | --- |\n| Thiopental | 30 s |\n| Phenobarbital | 1 h |" },
  ];
  const lessons = [
    { content: "Benzodiazepines act on GABA-A receptors.\n\n| Drug | Dose |\n| --- | --- |\n| Diazepam | 5mg |\n| Lorazepam | 1 mg (oral) |", firstPage: 1, lastPage: 1 },
    { content: "Barbiturates are older sedatives.", firstPage: 2, lastPage: 2 },
  ];
  const fixes = ensureTables(lessons, pages);
  assert.deepEqual(fixes, [
    { page: 1, action: "replaced" },
    { page: 2, action: "inserted" },
  ]);
  assert.ok(lessons[0]!.content.includes(table));
  assert.ok(lessons[1]!.content.includes("| Thiopental | 30 s |"));
});

test("a written module keeps only source numbers, spans its pages and carries the source tables", () => {
  const pages: BuildPage[] = [
    { g: 1, sourceIndex: 0, n: 1, text: `${PAGES[0]!.text}\n| Solution | Saline |\n| --- | --- |\n| Isotonic | 0.9% |\n| Hypotonic | 0.45% |\n| Hypertonic | 3% |` },
    { g: 2, sourceIndex: 0, n: 2, text: "Active transport: the sodium–potassium pump spends ATP to move sodium out and potassium in against their gradients, keeping resting potential near −70 mV." },
    { g: 3, sourceIndex: 0, n: 3, text: PAGES[2]!.text },
  ];
  const plan = repairPlan({ modules: [{ title: "Membranes", first_page: 1 }] }, pages, { outputTokensPerPage: 200 });
  const ctx = { module: { ...plan.modules[0]!, quizCount: 1 }, pages, sources: [{ index: 0, label: "lec.pdf", kind: "pdf", pages: [] }] };
  const { module, notes } = toCourseModule(
    {
      lessons: [
        {
          title: "Osmosis",
          content: "Osmosis moves water toward higher solute concentration. Plasma osmolality is 285–295 mOsm/kg. Isotonic saline is 0.9%.",
          first_page: 1,
          last_page: 1,
        },
        { title: "Diffusion", content: "Diffusion needs no energy; GLUT1 carriers help glucose across.", first_page: 3, last_page: 3 },
      ],
      quiz: [{ kind: "multiple_choice", question: "Isotonic saline?", choices: ["0.9%", "3%", "0.45%", "Water"], correct_choice: 0, explanation: "" }],
    },
    ctx,
    "Membranes"
  );
  const [first, second] = module.lessons;
  assert.doesNotMatch(first!.content, /285|295/);
  assert.match(first!.content, /Isotonic saline is 0\.9%\./);
  assert.ok(first!.content.includes("| Isotonic | 0.9% |"), "the page's table is in the lesson");
  assert.equal(first!.sources?.[0]?.locator, "pages 1–2", "page 2 joins the lesson before it");
  assert.equal(second!.sources?.[0]?.locator, "page 3");
  assert.ok(notes.some((n) => /numbers removed/.test(n)));
  assert.deepEqual(uncoveredPages(module, ctx), [2], "page 2's facts are still missing, so the gap call would run for it");
  assert.ok(pageWeight(pages[1]!.text) > 0);
});
