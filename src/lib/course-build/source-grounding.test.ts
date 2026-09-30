import test from "node:test";
import assert from "node:assert/strict";

import { pageCoverage } from "./coverage.ts";
import { autoPlaceFigures, figureCaption, placeFigures, truncatedCaption, type FigureAsset, type PlacedLesson } from "./figures.ts";
import { coverageGaps, gapRequest, sourceBacking, type WriterContext } from "./module.ts";
import { unbackedNumbers } from "./numbers.ts";
import { pageWeight, type BuildPage } from "./outline.ts";
import { isQuestionPage, isReferencePage, missingItems, namedLists } from "./page-signals.ts";
import { groundTitles, repairPlan } from "./plan.ts";
import { judgeTable, parseMarkdownTable } from "./table-quality.ts";
import { ensureTables } from "./tables.ts";
import type { CourseModule } from "@/types/course";

const page = (g: number, text: string): BuildPage => ({ g, sourceIndex: 0, n: g, text });

const RAN_QUESTION = "Q: Which cell compartment is Ran GTPase inside\nwhen it hydrolyzes GTP?\nA. Nucleoplasm\nB. Cytoplasm\nC. Periplasm";
const GTP_QUESTION =
  "Q: GTPγS is a form of GTP that cannot be hydrolyzed.\nSuppose you could instantly replace all the GTP in a\ncell with GTPγS.\nBefore the cell dies, what will be the immediate effect\non nuclear import?";
const RAN_FACTS =
  "GEF\nGAP\nRan-GDP is stimulated to\nrelease GDP and bind\nGTP by GEF protein\nRan-GTP is stimulated\nto hydrolyze GTP by\nGAP protein";
const RAN_PLACES =
  "Ran-GEF is bound to chromatin, so it is only found in the nucleus. Ran-GAP is anchored to the cytoplasmic filaments of the nuclear pore complex, so it is only found in the cytoplasm. This keeps Ran-GTP high in the nucleus and Ran-GDP high in the cytoplasm.";

test("question pages: clicker and practice slides are recognised in any language; teaching pages aren't", () => {
  assert.equal(isQuestionPage(RAN_QUESTION), true);
  assert.equal(isQuestionPage(GTP_QUESTION), true);
  assert.equal(isQuestionPage("다음 중 핵공을 통과하는 단백질은?\n가. 히스톤\n나. 라민\n다. 코헤신"), true);
  assert.equal(isQuestionPage("次のうち核膜孔を通過するものはどれか？\nA. ヒストン\nB. ラミン"), true);
  assert.equal(isQuestionPage(RAN_FACTS), false);
  assert.equal(isQuestionPage(RAN_PLACES), false);
  assert.equal(isQuestionPage("How is transport specificity achieved?\n" + RAN_PLACES), false, "a rhetorical heading over stated content is teaching");
});

test("question pages: a title and a labelled practice task is a question page; a labelled fact isn't", () => {
  // Lewis MCB 104 lecture 3, p46: the writer and the gap writer both answered it.
  assert.equal(isQuestionPage("Import Export\nPractice Exam Question: compare/contrast"), true);
  assert.equal(isQuestionPage("Nuclear transport\nDiscuss: why directionality?"), true);
  assert.equal(isQuestionPage("Ran cycle\nKey idea: Ran-GTP releases cargo"), false);
  assert.equal(isQuestionPage("Import Export\nPractice: compare/contrast\n" + RAN_PLACES), false, "a task beside real content leaves the page teachable");
  assert.equal(isQuestionPage(RAN_FACTS), false);
});

test("reference pages: a bibliography is recognised; a page that cites a study isn't", () => {
  const refs = [
    "Plaxton WC (1996) The organization and regulation of plant glycolysis. Annu Rev Plant Physiol 47:185–214.",
    "Smith, J. A., Lee, K. (2004). Nuclear pore complexes. J Cell Biol 12 (3), 251–260.",
    "Görlich D, Kutay U (1999) Transport between the cell nucleus and the cytoplasm. Annu Rev Cell Dev Biol 15:607–660.",
    "Moore MS, Blobel G (1993) The GTP-binding protein Ran/TC4 is required for protein import. Nature 365:661–663.",
    "Dingwall C, Laskey RA (1991) Nuclear targeting sequences, a consensus? Trends Biochem Sci 16:478–481.",
    "Kalderon D, Roberts BL (1984) A short amino acid sequence able to specify nuclear location. Cell 39:499–509.",
  ].join("\n");
  assert.equal(isReferencePage(refs), true);
  assert.equal(isReferencePage(`${RAN_PLACES}\nThis was shown by Moore MS, Blobel G (1993).`), false);
});

test("plan: reference pages are skipped even if the planner makes them a module", () => {
  const refs = Array.from({ length: 6 }, (_, i) => `Author${"abcdef"[i]} JK (199${i}) A study of pores number ${i}. J Cell Biol ${10 + i}:${100 + i}–${120 + i}.`).join("\n");
  const pages = [...[1, 2, 3, 4].map((g) => page(g, `${RAN_FACTS}\n${RAN_PLACES}`)), page(5, refs)];
  const plan = repairPlan(
    { modules: [{ title: "Ran GTPase cycle", first_page: 1 }, { title: "References", first_page: 5 }] },
    pages,
    { outputTokensPerPage: 200 }
  );
  assert.deepEqual(plan.modules.flatMap((m) => m.pages), [1, 2, 3, 4]);
  assert.deepEqual(plan.skipPages, [5]);
  assert.ok(!plan.modules.some((m) => /reference/i.test(m.title)));
});

test("plan: a title its pages don't back is replaced by the pages' own heading; an unbacked lesson hint is dropped", () => {
  const pages = [
    page(1, "Irreversible inhibitors\nIrreversible inhibitors bind covalently to the enzyme and permanently inactivate it, as aspirin does to cyclooxygenase."),
    page(2, "Suicide inhibitors are converted by the enzyme itself into a reactive form that attacks the active site."),
  ];
  const out = groundTitles("Mixed and Noncompetitive Inhibition", ["Mixed inhibition", "Irreversible inhibitors", "Suicide inhibitors"], pages);
  assert.equal(out.title, "Irreversible inhibitors");
  assert.deepEqual(out.lessons, ["Irreversible inhibitors", "Suicide inhibitors"]);
  assert.deepEqual(groundTitles("Irreversible Inhibition", [], pages).title, "Irreversible Inhibition", "a backed title stays");
});

test("numbers: a module is checked against its own pages and figures, not another section's", () => {
  const pages = [page(1, "Each nucleosome wraps 147 nucleotide pairs of DNA."), page(2, "A typical loop domain holds 10,000 nucleotide pairs.")];
  const fig: FigureAsset = { id: "F1", g: 2, sourceIndex: 0, page: 2, kind: "diagram", url: "", label: "Figure 2. 30 nm fibre", description: "", width: 1, height: 1 };
  const mod = { id: 1, title: "Nucleosomes", lessons: [], pages: [1], weight: 1, targetTokens: 200, maxTokens: 400, quizCount: 1 };
  const backing = sourceBacking({ module: mod, pages, figures: [fig] });
  assert.deepEqual(unbackedNumbers("A nucleosome holds 10,000 nucleotide pairs.", backing), ["10,000"]);
  assert.deepEqual(unbackedNumbers("The fibre is 30 nm wide.", backing), ["30"]);
  assert.deepEqual(unbackedNumbers("Each nucleosome wraps 147 nucleotide pairs.", backing), []);
});

test("tables: a running page header like '| 276 | CHAPTER 8 |' is never a table, nor restored into a lesson", () => {
  const header =
    "| 276 | CHAPTER 8 | Control of Gene Expression |\n| --- | --- | --- |\n| 276 | CHAPTER 8 | Control of Gene Expressioncell, similar transcription regulatory devices are combined to generate |";
  assert.equal(judgeTable(parseMarkdownTable(header)!).ok, false);
  const lessons = [{ content: "Transcription regulators combine into circuits.", firstPage: 1, lastPage: 1 }];
  const fixes = ensureTables(lessons, [{ g: 1, text: `${header}\ncell, similar transcription regulatory devices are combined to generate` }]);
  assert.deepEqual(fixes, []);
  assert.doesNotMatch(lessons[0]!.content, /CHAPTER 8/);
});

test("tables: a page whose table vision rejected (now plain lines) restores nothing", () => {
  const lessons = [{ content: "Import needs an NLS.", firstPage: 1, lastPage: 1 }];
  const demoted = "Cargo Receptor Direction\nNLS protein Importin In\nNES protein Exportin Out";
  assert.deepEqual(ensureTables(lessons, [{ g: 1, text: demoted }]), []);
});

const fig = (over: Partial<FigureAsset> = {}): FigureAsset => ({
  id: "F1",
  g: 5,
  sourceIndex: 0,
  page: 5,
  kind: "diagram",
  url: "https://x/F1.png",
  label: "",
  description: "",
  width: 600,
  height: 400,
  ...over,
});

test("captions: a caption cut off mid-sentence never shows; the neutral page caption does", () => {
  assert.equal(truncatedCaption("Ran-GTP binding occurs on"), true);
  assert.equal(truncatedCaption("Nuclear import requires (Ran"), true);
  assert.equal(truncatedCaption("The chromatin in human", "The chromatin in human chromosomes is packed."), true);
  assert.equal(truncatedCaption("Figure 4–12 Chromatin packing"), false);
  assert.equal(truncatedCaption("Scale bar, 50 nm"), false);
  const cut = fig({ label: "Figure 4–12 The chromatin in human" });
  assert.equal(figureCaption(cut, "", "Figure 4–12 The chromatin in human\nchromosomes is packed."), "");
  const lesson = { content: "Chromatin is packed.\n\nMore packing.", firstPage: 5, lastPage: 5, assets: [] };
  const used = new Set<string>();
  autoPlaceFigures([lesson], [cut], used, () => "Figure 4–12 The chromatin in human\nchromosomes is packed.", "", { fromPage: (n) => `From page ${n} of your file` });
  assert.equal((lesson.assets as Array<{ caption?: string }>)[0]?.caption, "From page 5 of your file");
});

test("captions: a caption the page prints for another figure isn't put on a picture the vision check saw differently", () => {
  // Lewis MCB 104 lecture 2, p23: the slide's thread-spool photos sit over a textbook scan.
  const page =
    "Figure 5−23 DNA packing occurs on several levels in chromosomes.\nFigure 5−22 The chromatin in human chromosomes is folded into looped domains.\nFiber\nSingle nucleosome";
  const spools = fig({ kind: "image", description: "Photograph of colored fiber spools" });
  assert.equal(figureCaption(spools, "The chromatin in human chromosomes is folded into looped domains.", page), "");
  const packing = fig({ description: "Diagram of DNA packing into chromatin loops" });
  assert.equal(figureCaption(packing, "DNA packing occurs on several levels in chromosomes.", page), "DNA packing occurs on several levels in chromosomes.");
  assert.equal(figureCaption(fig(), "DNA packing occurs on several levels in chromosomes.", page), "DNA packing occurs on several levels in chromosomes.");
});

test("figures: a figure only lands in a lesson that teaches its page", () => {
  const f = fig({ id: "F2", g: 7, page: 7, label: "Figure 7. The nuclear pore complex" });
  const used = new Set<string>();
  const placed = placeFigures("Text.\n\n[[F2: The pore]]\n\nMore.", new Map([["F2", f]]), used, () => "Figure 7. The nuclear pore complex", "", {}, { first: 2, last: 4 });
  assert.deepEqual(placed.assets, []);
  assert.deepEqual(placed.offPage, ["F2"]);
  assert.equal(used.has("F2"), false, "left for the lesson that teaches page 7");

  const early: PlacedLesson = { content: "Chromatin.\n\nHistones.", firstPage: 1, lastPage: 8, assets: [] };
  const late: PlacedLesson = { content: "The nuclear pore complex.\n\nNucleoporins.", firstPage: 9, lastPage: 12, assets: [] };
  autoPlaceFigures([early, late], [f], used, () => "Figure 7. The nuclear pore complex", "", {}, [
    { first: 1, last: 3 },
    { first: 7, last: 12 },
  ]);
  assert.equal(early.assets.length, 0, "the stretched range doesn't pull it into the wrong lesson");
  assert.equal(late.assets.length, 1);
});

test("figures: a gap lesson written for a page gets that page's figure, not the lesson stretched over it", () => {
  // Lewis MCB 104 lecture 2: nuclear-envelope figures (p32, p36) landed in a histone lesson stretched to p24–p37.
  const pore = fig({ id: "F10", g: 36, page: 36, description: "Diagram of outer nuclear membrane and nuclear pores" });
  const text = () => "The nuclear envelope has an outer nuclear membrane perforated by nuclear pores.";
  const histones: PlacedLesson = { content: "Histone tails are modified.\n\nThe nuclear envelope has an outer nuclear membrane.", firstPage: 24, lastPage: 37, assets: [] };
  const pores: PlacedLesson = { content: "Nuclear pores perforate the outer nuclear membrane.", firstPage: 36, lastPage: 36, assets: [] };
  autoPlaceFigures([histones, pores], [pore], new Set(), text, "");
  assert.equal(histones.assets.length, 0);
  assert.equal(pores.assets.length, 1);
});

const INHIBITION =
  "Reversible inhibition\nThere are four types of reversible inhibitors.\n- Competitive: binds the active site\n- Uncompetitive: binds the ES complex\n- Non-competitive: binds either with equal affinity\n- Mixed: binds either with different affinity";

test("lists: a page naming a set of items weighs more and every item must be taught", () => {
  assert.deepEqual(namedLists(INHIBITION), [["Competitive", "Uncompetitive", "Non-competitive", "Mixed"]]);
  assert.ok(pageWeight(INHIBITION) > pageWeight("Reversible inhibitors bind the enzyme non-covalently and can dissociate from it again."));
  const partial = "Reversible inhibitors come in several types. Competitive inhibitors bind the active site; uncompetitive inhibitors bind the ES complex.";
  assert.deepEqual(missingItems(namedLists(INHIBITION)[0]!, partial), ["Non-competitive", "Mixed"]);
  const [cov] = pageCoverage([{ g: 1, text: INHIBITION }], [{ g: 1, text: INHIBITION }], partial);
  assert.equal(cov!.covered, false);
  assert.deepEqual(cov!.missingItems, ["Non-competitive", "Mixed"]);
  const [full] = pageCoverage([{ g: 1, text: INHIBITION }], [{ g: 1, text: INHIBITION }], `${partial} Noncompetitive inhibitors bind either with equal affinity; mixed inhibitors bind either with different affinity.`);
  assert.deepEqual(full!.missingItems, []);
});

function gapContext(pages: BuildPage[], modulePages: number[]): WriterContext {
  const mod = { id: 1, title: "Ran cycle", lessons: [], pages: modulePages, weight: modulePages.length, targetTokens: 1000, maxTokens: 2000, quizCount: 2 };
  return {
    plan: { title: "L3", description: "", planned: true, modules: [mod], skipPages: [], infoPages: [] } as unknown as WriterContext["plan"],
    module: mod,
    pages,
    sources: [{ index: 0, label: "L3.pdf", kind: "pdf", pages: [] }] as unknown as WriterContext["sources"],
    attempt: 1,
  };
}

const lessonModule = (content: string): CourseModule =>
  ({ title: "Ran cycle", lessons: [{ title: "The Ran GTPase", content, key_terms: [], examples: [], visual_assets: [] }], quiz: [] }) as unknown as CourseModule;

test("gap call: reads the neighbouring pages and the lessons so far, teaches only the missed page, never a question page", () => {
  const pages = [page(1, RAN_PLACES), page(2, RAN_FACTS), page(3, RAN_QUESTION), page(4, GTP_QUESTION)];
  const ctx = gapContext(pages, [1, 2, 3, 4]);
  const written = lessonModule("Ran is a small GTPase that switches between a GDP- and a GTP-bound form.");
  const gaps = coverageGaps(written, ctx).map((c) => c.g);
  assert.ok(!gaps.includes(3) && !gaps.includes(4), "question pages are never gaps");

  const req = gapRequest(ctx, [2, 3], written);
  const text = String(req.messages[0]!.content);
  assert.match(text, /Missed pages to teach:\n\[p2\]/);
  assert.doesNotMatch(text.split("Missed pages to teach:")[1]!, /\[p3\]/, "the question page isn't sent to be taught");
  assert.match(text, /Context pages \(don't teach\):\n\[p1\]\nRan-GEF is bound to chromatin/);
  assert.match(text, /switches between a GDP- and a GTP-bound form/, "the lessons so far are in context");
  assert.match(text, /never add a fact, mechanism, location or number the missed pages don't state/);
});

test("gap call: neighbour context stays bounded however many pages were missed", () => {
  const long = "Nucleoporins line the central channel of the pore. ".repeat(80);
  const pages = Array.from({ length: 40 }, (_, i) => page(i + 1, `${long}${i}`));
  const missed = pages.filter((p) => p.g % 3 === 0).map((p) => p.g);
  const text = String(gapRequest(gapContext(pages, pages.map((p) => p.g)), missed, lessonModule("x".repeat(20_000))).messages[0]!.content);
  const context = text.split("Context pages (don't teach):")[1]!.split("Missed pages to teach:")[0]!;
  assert.ok(context.length <= 6_500, `context ${context.length}`);
  const lessons = text.split("Its lessons so far:")[1]!.split("They missed")[0]!;
  assert.ok(lessons.length <= 6_100, `lessons ${lessons.length}`);
});
