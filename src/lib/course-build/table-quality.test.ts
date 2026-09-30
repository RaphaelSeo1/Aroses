import test from "node:test";
import assert from "node:assert/strict";

import { cleanPages } from "./clean.ts";
import { docxHtmlToText } from "./office-text.ts";
import { layoutPageText, type TextItem } from "./pdf-layout.ts";
import { firstRealTable, guardMarkdownTables, judgeTable, parseMarkdownTable } from "./table-quality.ts";
import { ensureTables, markdownTables } from "./tables.ts";

const item = (str: string, x: number, y: number, fontSize = 10): TextItem => ({
  str,
  x,
  y,
  fontSize,
  width: str.length * fontSize * 0.5,
});

/** Lays out rows of cells at fixed column positions, one text item per cell. */
function grid(rows: string[][], colX: number[], top: number, pitch = 14): TextItem[] {
  return rows.flatMap((r, i) => r.map((cell, j) => item(cell, colX[j]!, top - i * pitch)).filter((it) => it.str));
}

const PAGE = { x0: 0, y0: 0, x1: 612, y1: 792 };

test("real data table: kept with every row, including an indented total", () => {
  const items = [
    item("Purchases during the month were recorded as follows.", 72, 700),
    ...grid(
      [
        ["Date", "Explanation", "Units", "Unit Cost"],
        ["Sept. 1", "Inventory", "25", "100"],
        ["Sept. 12", "Purchases", "45", "106"],
        ["Sept. 19", "Purchases", "24", "110"],
      ],
      [72, 150, 260, 330],
      670
    ),
    item("Total", 100, 614),
    item("94", 260, 614),
  ];
  const [table] = markdownTables(layoutPageText(items, { page: PAGE }));
  assert.equal(
    table?.replace(/ {2,}/g, " "),
    "| Date | Explanation | Units | Unit Cost |\n| --- | --- | --- | --- |\n| Sept. 1 | Inventory | 25 | 100 |\n| Sept. 12 | Purchases | 45 | 106 |\n| Sept. 19 | Purchases | 24 | 110 |\n| Total | | 94 | |"
  );
});

test("real data table in a spaceless script is kept", () => {
  const items = grid(
    [
      ["약물", "작용", "용량"],
      ["디아제팜", "진정", "5 mg"],
      ["로라제팜", "항불안", "1 mg"],
      ["미다졸람", "마취 전 투약", "2 mg"],
    ],
    [72, 180, 320],
    600
  );
  assert.equal(markdownTables(layoutPageText(items, { page: PAGE })).length, 1);
});

test("figure labels: text drawn over a picture never becomes a table and stays together on one line", () => {
  const figure = { x0: 100, y0: 400, x1: 400, y1: 600 };
  const items = [
    item("Glycolysis happens in the cytosol.", 72, 700),
    ...grid(
      [
        ["Glucose", "ATP", "NADH"],
        ["Pyruvate", "2 ADP", "NAD+"],
        ["Lactate", "4 ATP", "2 H+"],
      ],
      [120, 220, 320],
      560
    ),
  ];
  const withoutFigure = markdownTables(layoutPageText(items, { page: PAGE }));
  assert.equal(withoutFigure.length, 1, "the same text off a picture is a grid");
  const text = layoutPageText(items, { page: PAGE, figures: [figure] });
  assert.equal(markdownTables(text).length, 0);
  assert.equal(text, "Glycolysis happens in the cytosol.\nGlucose · ATP · NADH · Pyruvate · 2 ADP · NAD+ · Lactate · 4 ATP · 2 H+");
});

test("figure labels repeated across columns are rejected even without a picture", () => {
  const labels = parseMarkdownTable("| ATP | ATP |\n| --- | --- |\n| Substrate-level | Substrate-level |\n| phosphorylation | phosphorylation |")!;
  assert.deepEqual(judgeTable(labels), { ok: false, reason: "repeated" });
});

test("multi-column prose: justified lines split at wide word gaps are not a table", () => {
  // Three justified lines: the wide gaps fall at different places on each line.
  const lines = [
    ["Each mRNA molecule is eventually", "degraded by", "ribonucleases present in the"],
    ["cytosol, but the lifespans of", "mRNA molecules", "differ considerably and depend"],
    ["on the nucleotide sequence of", "the mRNA and", "the type of cell that makes it."],
  ];
  const items = lines.flatMap((chunks, i) => {
    let x = 72 + i * 9;
    return chunks.map((c) => {
      const it = item(c, x, 600 - i * 13);
      x += it.width + 12 + i * 7;
      return it;
    });
  });
  const text = layoutPageText(items, { page: PAGE });
  assert.equal(markdownTables(text).length, 0);
  assert.match(text, /Each mRNA molecule is eventually\sdegraded by\sribonucleases/);
});

test("multi-column prose: two side-by-side text columns are not a table", () => {
  const left = ["The plasma membrane is made of", "a lipid bilayer in which many", "proteins are embedded, and these", "proteins carry out most of the"];
  const right = ["functions of the membrane, such", "as moving nutrients and ions", "across it or anchoring the cell", "to the matrix around it."];
  const items = left.flatMap((l, i) => [item(l, 72, 600 - i * 13), item(right[i]!, 330, 600 - i * 13)]);
  assert.equal(markdownTables(layoutPageText(items, { page: PAGE })).length, 0);
  const cut = parseMarkdownTable(
    `| ${left[0]} | ${right[0]} |\n| --- | --- |\n${left.slice(1).map((l, i) => `| ${l} | ${right[i + 1]} |`).join("\n")}`
  )!;
  assert.equal(judgeTable(cut).ok, false);
});

test("page chrome: rows in the top and bottom margins never join a table", () => {
  const items = [
    item("Chapter 4", 72, 770),
    item("Membranes", 300, 770),
    item("Cell Biology", 480, 770),
    ...grid(
      [
        ["Lipid", "Share", "Charge"],
        ["PC", "45%", "neutral"],
        ["PE", "20%", "neutral"],
      ],
      [72, 300, 480],
      744,
      12
    ),
  ];
  const text = layoutPageText(items, { page: PAGE });
  const [table] = markdownTables(text);
  assert.ok(table?.startsWith("| Lipid | Share | Charge |"), text);
  assert.ok(!table?.includes("Chapter"), table);
});

test("page chrome: repeated headers, footers and worded page counters are stripped in any language", () => {
  const topics = ["GABA receptors", "Opioid analgesia", "Dopamine pathways", "Serotonin reuptake", "Sedative hypnotics", "Antiepileptic drugs"];
  const pages = topics.map((t, i) => ({
    n: i + 1,
    text: `약리학 3장 중추신경계\n${t} are explained on this page\nSeite ${i + 1} von 6\n${i + 1}`,
  }));
  cleanPages(pages).forEach((p, i) => assert.equal(p.text, `${topics[i]} are explained on this page`));
});

test("overprinted text and tiny adjacent lines don't glue words together", () => {
  const items = [
    item("Democrats", 66, 489),
    item("Democrats", 66, 489),
    item("Triose phosphate", 143.8, 663.1, 2),
    item("dehydrogenase", 143.8, 661.2, 2),
  ];
  const text = layoutPageText(items);
  assert.ok(!/DemocratsDemocrats/.test(text), text);
  assert.ok(!/phosphatedehydrogenase/.test(text), text);
  assert.match(text, /Triose phosphate\ndehydrogenase/);
});

test("a rejected table falls back to its text; a real one is untouched", () => {
  const bad =
    "Intro.\n\n| whose levels must change rapidly in response | to | signals, | are typically |\n| --- | --- | --- | --- |\n| synthesized from short-lived mRNAs and the | rest | of the | cell keeps |\n| a steady supply of these proteins over | the | whole | cycle of |\n\nAfter.";
  const out = guardMarkdownTables(bad);
  assert.equal(out.rejected, 1);
  assert.ok(!out.text.includes("|"), out.text);
  assert.ok(out.text.includes("whose levels must change rapidly in response to signals, are typically"), out.text);
  const good = "| Drug | Dose |\n| --- | --- |\n| Diazepam | 5 mg |\n| Lorazepam | 1 mg |";
  assert.deepEqual(guardMarkdownTables(good), { text: good, rejected: 0 });
  assert.equal(guardMarkdownTables("| Drug | Dose |\n| --- | --- |", { streaming: true }).rejected, 0);
});

test("lowercase descriptive tables and header-plus-one-row tables are real tables", () => {
  const lower = parseMarkdownTable(
    "| Example | Function |\n| --- | --- |\n| receptors | response to external stimuli, e.g. chemicals, photons, mechanical |\n| signal generation | electrical, chemical gradients, cell-cell communication |\n| transport | nutrients, ions |"
  )!;
  assert.deepEqual(judgeTable(lower), { ok: true });
  assert.deepEqual(judgeTable([["Ratio", "Formula"], ["Current", "CA / CL"]]), { ok: true });
});

test("a form's labels are not a table: a header cell that reads on into the next row", () => {
  const form = parseMarkdownTable(
    "| SEONGHO SEO | | information and is being |\n| --- | --- | --- |\n| 958 Camino Cantera | | furnished to the IRS. If |\n| Chula Vista 91913 | 3 Excess payments | you are required to file a |\n| United States | $ 0.00 | return, a penalty or other |"
  )!;
  assert.equal(judgeTable(form).ok, false);
});

test("a textbook panel's columns read as rows are not a table, even when the header's next line sits below a blank", () => {
  // Lewis MCB 104 lecture 2, p32: the TEM panel's side text, one column per text column.
  const panel = parseMarkdownTable(
    "| | embedded in plastic, and cut | detector |\n| --- | --- | --- |\n| viewing | | specimen |\n| screen or | into very thin sections that have | |\n| photographic | then been stained with salts of | In the scanning electron microscope (SEM), the specimen, which |\n| film | uranium and lead. | |"
  )!;
  assert.deepEqual(judgeTable(panel), { ok: false, reason: "header" });
  // A real table with a blank first record keeps its short column names.
  const gaps = parseMarkdownTable("| Stage | Length | Notes |\n| --- | --- | --- |\n| G1 | | variable |\n| S | 8 h | DNA copied |\n| G2 | 4 h | checks |")!;
  assert.deepEqual(judgeTable(gaps), { ok: true });
});

test("after the writer: a fragment table in a lesson is demoted to text, source tables still restored", () => {
  const lessons = [
    {
      content: "Diagram recap.\n\n| Electrons | Electrons carried |\n| --- | --- |\n| carried | via NADH and |\n| via NADH | FADH2 |",
      firstPage: 1,
      lastPage: 1,
    },
  ];
  const pages = [{ g: 1, text: "| Drug | Dose |\n| --- | --- |\n| Diazepam | 5 mg |\n| Lorazepam | 1 mg |" }];
  const fixes = ensureTables(lessons, pages);
  assert.deepEqual(fixes, [
    { page: 1, action: "demoted" },
    { page: 1, action: "inserted" },
  ]);
  assert.ok(lessons[0]!.content.includes("Electrons carried"));
  assert.equal(markdownTables(lessons[0]!.content).length, 1);
  assert.ok(lessons[0]!.content.includes("| Diazepam | 5 mg |"));
});

test("office files: a table used only for layout becomes paragraphs", () => {
  const html =
    "<table><tr><td><p>This handout explains how the cell membrane is organized and why</p></td><td><p>it matters for transport, signalling and the way cells</p></td></tr>" +
    "<tr><td><p>communicate with one another across the tissue, which is</p></td><td><p>covered in more detail in the next unit of the course.</p></td></tr></table>";
  const text = docxHtmlToText(html);
  assert.ok(!text.includes("|"), text);
  assert.ok(text.includes("how the cell membrane is organized"), text);
});

test("first real table skips label grids and fixes a missing separator; demoting all keeps every word", () => {
  const md = [
    "Intro line.",
    "| Oxygen | Oxygen | Oxygen |",
    "| --- | --- | --- |",
    "| Oxygen | Oxygen | Oxygen |",
    "",
    "| Stage | ATP | NADH |",
    "| Glycolysis | 2 | 2 |",
    "| Krebs cycle | 2 | 6 |",
    "",
    "```",
    "| a | b |",
    "| --- | --- |",
    "| 1 | 2 |",
    "```",
  ].join("\n");
  assert.equal(firstRealTable(md), "| Stage | ATP | NADH |\n| --- | --- | --- |\n| Glycolysis | 2 | 2 |\n| Krebs cycle | 2 | 6 |");
  assert.equal(firstRealTable("No tables here."), null);
  const all = guardMarkdownTables("Before.\n| Stage | ATP |\n| --- | --- |\n| Glycolysis | 2 |\nAfter.", { all: true });
  assert.deepEqual(all, { text: "Before.\nStage ATP\nGlycolysis 2\nAfter.", rejected: 1 });
});
