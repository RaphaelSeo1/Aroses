import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoursePayload } from "@/types/course";
import type { SourcePage } from "./clean.ts";
import { readCourseBuildConfig } from "./config.ts";
import { StepFatalError } from "./errors.ts";
import { extractFigureMarkers, stripFigureMarkers } from "./figure-markers.ts";
import { parseReview } from "./figure-review.ts";
import {
  acceptFigures,
  autoPlaceFigures,
  captionLines,
  confirmedBy,
  dropRepeatedImages,
  figureCaption,
  placeChosenFigures,
  figureManifest,
  placeFigures,
  rankCandidates,
  rejectReason,
  repeatedBoxes,
  splitForReview,
  type Box,
  type FigureAsset,
  type FigureCandidate,
  type PlacedLesson,
} from "./figures.ts";
import {
  createStepHandlers,
  previewFromSnapshot,
  type BuildData,
  type FindFiguresFn,
  type ModuleStepOutput,
  type PublishInput,
  type SourceRecord,
} from "./handlers.ts";
import type { MessagesClient } from "./metered-call.ts";
import type { BuildPlan } from "./plan.ts";
import { driveBuild } from "./runner.ts";
import { removeBuildFigures } from "./supabase-build-data.ts";
import { createTestDb, type TestDb } from "./testing/pglite-db.ts";

let t: TestDb;
before(async () => {
  t = await createTestDb();
});
after(async () => {
  await t.close();
});

const config = readCourseBuildConfig({ COURSE_BUILD_ENABLED: "1" });

function cand(page: number, box: Box, over: Partial<FigureCandidate> = {}): FigureCandidate {
  return {
    page,
    origin: "raster",
    box,
    width: Math.round(box.w * 1100),
    height: Math.round(box.h * 1400),
    image: Buffer.from(`img-${page}-${box.y}`),
    mime: "image/jpeg",
    thumb: Buffer.from(`thumb-${page}-${box.y}`),
    quality: 0.8,
    tableGrid: false,
    ...over,
  };
}

const mid: Box = { x: 0.1, y: 0.3, w: 0.6, h: 0.4 };

test("markers: pulled out of the text with the paragraph count before them", () => {
  const { text, markers } = extractFigureMarkers(
    "Glycolysis has two phases.\n\n[[F2: The ten steps of glycolysis]]\n\nThe payoff phase makes ATP.\n[[F5]]\n\nLast."
  );
  assert.equal(text, "Glycolysis has two phases.\n\nThe payoff phase makes ATP.\n\nLast.");
  assert.deepEqual(markers, [
    { id: "F2", caption: "The ten steps of glycolysis", afterParagraph: 1 },
    { id: "F5", caption: "", afterParagraph: 2 },
  ]);
  assert.equal(stripFigureMarkers("Text.\n\n[[F1: a]]\n\nMore [[F2"), "Text.\n\nMore");
});

test("captions: printed figure and table labels, not in-text references", () => {
  const lines = captionLines("Intro text\nFigure 3. The Krebs cycle\nFigure 4 shows the rest\n표 2: 환율\nTable 1 – Costs");
  assert.deepEqual(lines, [
    { text: "Figure 3. The Krebs cycle", table: false },
    { text: "표 2: 환율", table: true },
    { text: "Table 1 – Costs", table: true },
  ]);
});

test("deterministic rejects: headers, logos repeated across pages, backgrounds, strips, text tables", () => {
  const logo: Box = { x: 0.85, y: 0.02, w: 0.1, h: 0.06 };
  const repeated = repeatedBoxes(
    new Map([1, 2, 3, 4, 5].map((p) => [p, [{ ...logo, x: logo.x + p * 0.002 }]])),
    10
  );
  assert.equal(repeated.length, 1);
  assert.equal(rejectReason(cand(2, { x: 0.3, y: 0.005, w: 0.4, h: 0.09 }), []), "header");
  assert.equal(rejectReason(cand(2, { x: 0.3, y: 0.4, w: 0.2, h: 0.2 }), [{ x: 0.3, y: 0.4, w: 0.2, h: 0.2 }]), "repeated");
  assert.equal(rejectReason(cand(2, { x: 0, y: 0, w: 1, h: 0.95 }), []), "background");
  assert.equal(rejectReason(cand(2, { x: 0.1, y: 0.4, w: 0.8, h: 0.06 }), []), "strip");
  assert.equal(rejectReason(cand(2, mid, { origin: "vector", tableGrid: true }), []), "table_text");
  assert.equal(rejectReason(cand(2, mid, { quality: 0 }), []), "unusable");
  assert.equal(rejectReason(cand(2, mid), []), null);
});

test("ranking: captioned or large embedded crops are confident; drawn regions and small images are not", () => {
  const text = (p: number) => (p === 2 ? "Figure 1. Cell membrane" : p === 3 ? "Table 2. Rates" : "");
  const ranked = rankCandidates(
    [
      cand(2, mid),
      cand(2, { x: 0.12, y: 0.32, w: 0.55, h: 0.35 }, { quality: 0.5 }),
      cand(3, mid, { origin: "vector" }),
      cand(4, mid, { origin: "vector", quality: 0.9 }),
      cand(5, { x: 0.1, y: 0.2, w: 0.2, h: 0.2 }),
      cand(6, mid),
    ],
    text,
    []
  );
  assert.deepEqual(ranked.map((r) => [r.candidate.page, r.confident, r.label]), [
    [2, true, "Figure 1. Cell membrane"],
    [4, false, ""],
    [5, false, ""],
    [6, true, ""],
  ]);
  const split = splitForReview(ranked, 3);
  assert.deepEqual(split.review.map((r) => r.candidate.page), [2, 4, 6], "confident and large crops first, in page order");
  assert.deepEqual(split.unreviewed.map((r) => r.candidate.page), [5]);
});

test("acceptance: vision verdicts decide reviewed crops; without them only confident crops stay", () => {
  const ranked = rankCandidates([cand(2, mid), cand(3, mid, { origin: "vector" }), cand(4, mid)], () => "", []);
  const split = splitForReview(ranked, 3);
  const kept = acceptFigures(split, [
    { keep: false, kind: "image", description: "" },
    { keep: true, kind: "chart", description: "Growth curve" },
    null,
  ]);
  assert.deepEqual(kept.map((k) => [k.r.candidate.page, k.kind, k.description]), [[3, "chart", "Growth curve"]]);
  assert.deepEqual(acceptFigures(split, null).map((k) => k.r.candidate.page), [2, 4], "review failed: confident only");
  const over = acceptFigures(splitForReview(ranked, 1), [{ keep: true, kind: "image", description: "" }]);
  assert.equal(over.length, 1, "crops over the review budget are dropped once the review ran");
});

test("placement: only listed IDs, each once per module, captions fall back to the printed label", () => {
  const fig = (id: string, label = ""): FigureAsset => ({
    id,
    g: 3,
    sourceIndex: 0,
    page: 3,
    kind: "diagram",
    url: `https://x/course-build/b/${id}.png`,
    label,
    description: "",
    width: 600,
    height: 400,
  });
  const figures = new Map([
    ["F1", fig("F1", "Figure 1. Membrane")],
    ["F2", fig("F2")],
  ]);
  const used = new Set<string>();
  const page = () => "The second stage of the membrane";
  const a = placeFigures("One.\n\n[[F1]]\n\nTwo.\n\n[[F9: invented]]", figures, used, page, "abc-");
  assert.equal(a.content, "One.\n\nTwo.");
  assert.deepEqual(a.dropped, ["F9"]);
  assert.equal(a.assets.length, 1);
  assert.equal(a.assets[0].assetId, "abc-F1");
  assert.equal(a.assets[0].caption, "Figure 1. Membrane");
  assert.equal(a.assets[0].placementAfterParagraph, 1);
  const b = placeFigures("Three.\n\n[[F1: again]]\n\n[[F2: Second figure]]", figures, used, page, "abc-");
  assert.deepEqual(b.dropped, ["F1"]);
  assert.equal(b.assets[0].caption, "Second figure");
  assert.match(figureManifest([fig("F1", "Figure 1. Membrane")]), /^\[figure F1\] diagram: "Figure 1\. Membrane"$/);
});

test("figures the writer skipped go into the lesson covering their page, after the best-matching paragraph", () => {
  const fig = (id: string, g: number, description: string): FigureAsset => ({
    id,
    g,
    sourceIndex: 0,
    page: g,
    kind: "diagram",
    url: `https://x/course-build/b/${id}.png`,
    label: "",
    description,
    width: 600,
    height: 400,
  });
  const lessons: PlacedLesson[] = [
    { content: "Glucose enters the cell.\n\nHexokinase phosphorylates glucose.\n\nThe cell traps it.", firstPage: 1, lastPage: 3, assets: [] },
    { content: "Pyruvate forms at the end.", firstPage: 4, lastPage: 5, assets: [] },
  ];
  const used = new Set(["F1"]);
  const placed = autoPlaceFigures(
    lessons,
    [fig("F1", 2, "already placed"), fig("F2", 2, "hexokinase reaction"), fig("F3", 5, "pyruvate"), fig("F4", 9, "outside")],
    used,
    (g) => (g === 2 ? "Hexokinase phosphorylates glucose using ATP" : ""),
    "p-"
  );
  assert.deepEqual(placed, ["F2", "F3"]);
  assert.deepEqual(lessons[0].assets.map((a) => [a.assetId, a.placementAfterParagraph, a.caption]), [["p-F2", 2, "hexokinase reaction"]]);
  assert.deepEqual(lessons[1].assets.map((a) => [a.assetId, a.placementAfterParagraph]), [["p-F3", 1]]);
  assert.ok(!used.has("F4"), "a figure outside every lesson's pages stays out");

  const lesson: PlacedLesson = { content: "Alpha text.\n\nBeta text about kinase.", firstPage: 1, lastPage: 2, assets: [] };
  const map = new Map([["F5", fig("F5", 1, "kinase")]]);
  const dropped = placeChosenFigures(
    lesson,
    [{ id: "f5", caption: "Kinase step" }, { id: "F9", caption: "x" }],
    map,
    new Set(),
    () => "The kinase step adds a phosphate",
    "p-"
  );
  assert.deepEqual(dropped, ["F9"]);
  assert.deepEqual(lesson.assets.map((a) => [a.assetId, a.caption, a.placementAfterParagraph]), [["p-F5", "Kinase step", 2]]);
});

test("a picture repeated on later slides is kept once", () => {
  const item = (page: number, hash: string, w = 552, h = 376) => ({ candidate: cand(page, mid, { hash, width: w, height: h }) });
  const kept = dropRepeatedImages([
    item(2, "ffff0000ffff0000"),
    item(3, "ffff0000ffff0001"),
    item(4, "ffff0000ffff0000", 300, 600),
    item(5, "0f0f0f0f0f0f0f0f"),
  ]);
  assert.deepEqual(kept.map((k) => k.candidate.page), [2, 4, 5]);
});

test("captions: the file's caption, then a writer or vision caption the page backs up, else none", () => {
  const fig = (label: string, description: string): FigureAsset => ({
    id: "F1",
    g: 7,
    sourceIndex: 0,
    page: 7,
    kind: "diagram",
    url: "https://x/course-build/b/F1.png",
    label,
    description,
    width: 600,
    height: 400,
  });
  // Real miscaptions from lecture slides: the vision model named the wrong picture.
  const polarSlide = "examples of polar, non-polar and amphipathic biomolecules at pH 7";
  assert.equal(figureCaption(fig("", "DNA base pairing with hydrogen bonding interactions"), "DNA base pairing with hydrogen bonding interactions.", polarSlide), "");
  assert.equal(figureCaption(fig("", "Diagram of protein structure hierarchy"), "", "pH of some common liquids"), "");
  assert.equal(
    figureCaption(fig("", "Multiple pKa curves"), "Titration curves for common weak acids showing pKa and buffering regions.", "titration curves of weak acids, buffering regions, pKa"),
    "Titration curves for common weak acids showing pKa and buffering regions."
  );
  assert.equal(figureCaption(fig("", "pKa of acetic acid in dioxane-water mixture"), "", "pKa of acetic acid in dioxane/water"), "pKa of acetic acid in dioxane-water mixture");
  assert.equal(figureCaption(fig("Figure 3. Lipid bilayer structure", "Cell wall"), "Membrane", "anything"), "Figure 3. Lipid bilayer structure");
  assert.equal(figureCaption(fig("Figure 14-2 part 1", ""), "", "glycolysis"), "Figure 14-2 part 1", "a bare figure number is kept only as a last resort");
  assert.equal(confirmedBy("Bar chart", "a bar chart"), false, "picture-kind words alone confirm nothing");
});

test("placement: at most one figure per paragraph, spread by page when nothing matches", () => {
  const fig = (id: string, g: number): FigureAsset => ({
    id,
    g,
    sourceIndex: 0,
    page: g,
    kind: "diagram",
    url: `https://x/course-build/b/${id}.png`,
    label: "",
    description: "",
    width: 600,
    height: 400,
  });
  const lesson: PlacedLesson = {
    content: "Glycolysis splits glucose.\n\nIt makes pyruvate.\n\nThe cell keeps the ATP.",
    firstPage: 1,
    lastPage: 3,
    assets: [],
  };
  const text = (g: number) => (g <= 2 ? "Glycolysis splits glucose" : "");
  const placed = autoPlaceFigures([lesson], [fig("F1", 1), fig("F2", 2), fig("F3", 3)], new Set(), text, "p-");
  assert.deepEqual(placed, ["F1", "F2", "F3"]);
  assert.deepEqual(
    lesson.assets.map((a) => [a.assetId, a.placementAfterParagraph]),
    [["p-F1", 1], ["p-F2", 2], ["p-F3", 3]],
    "two figures citing the same paragraph never stack"
  );

  const full: PlacedLesson = { content: "One paragraph only about glycolysis.", firstPage: 1, lastPage: 1, assets: [] };
  const map = new Map([["F4", fig("F4", 1)], ["F5", fig("F5", 1)]]);
  const dropped = placeChosenFigures(full, [{ id: "F4", caption: "" }, { id: "F5", caption: "" }], map, new Set(), text, "p-");
  assert.deepEqual(dropped, ["F5"], "no free paragraph left");
  assert.deepEqual(full.assets.map((a) => a.assetId), ["p-F4"]);
});

test("vision review parser: missing or malformed verdicts mean drop", () => {
  const v = parseReview(
    { figures: [{ n: 2, keep: true, kind: "chart", description: " Sales  by year " }, { n: 9, keep: true }] },
    3
  );
  assert.equal(v[0], null);
  assert.deepEqual(v[1], { keep: true, kind: "chart", description: "Sales by year" });
  assert.equal(v[2], null);
  assert.deepEqual(parseReview("junk", 2), [null, null]);
});

test("preview never shows raw markers", () => {
  const p = previewFromSnapshot({ lessons: [{ title: "A", content: "Text.\n\n[[F1: cap]]\n\nMore [[F" }] });
  assert.equal(p?.lessons[0].content, "Text.\n\nMore");
});

function toolMessage(name: string, input: unknown): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu", name, input } as Anthropic.ToolUseBlock],
    usage: { input_tokens: 800, output_tokens: 200 } as Anthropic.Usage,
  } as Anthropic.Message;
}

const prose = (i: number) => `Concept ${i} is explained here with enough words to count as a real content page. `.repeat(3);

function setup(pages: SourcePage[]) {
  const sources: SourceRecord[] = [
    { id: "s1", position: 0, kind: "pdf", label: "lec.pdf", storagePath: "x", sourceUrl: null, pages: null },
  ];
  const published: PublishInput[] = [];
  const saved: string[] = [];
  const doneOutputs = async (buildId: string, kind: string) =>
    (await t.steps(buildId)).filter((s) => s.kind === kind && s.status === "done").map((s) => s.output);
  const data = (buildId: string, userId: string): BuildData => ({
    getBuild: async () => ({
      id: buildId,
      userId,
      courseId: "c",
      examGroupId: "g",
      materialId: null,
      outputLanguage: null,
      studyGoal: null,
    }),
    listSources: async () => sources,
    saveSourcePages: async (_id, p) => {
      sources[0].pages = p;
    },
    setBuildSize: async () => {},
    savePlan: async () => {},
    getPlan: async () => ((await doneOutputs(buildId, "plan"))[0] as BuildPlan) ?? null,
    listModuleOutputs: async () => (await doneOutputs(buildId, "module")) as ModuleStepOutput[],
    publish: async (input) => {
      published.push(structuredClone(input));
      return "material-1";
    },
    saveFigure: async (build, id) => {
      saved.push(id);
      return `https://cdn.test/${build.userId}/course-build/${build.id}/${id}.png`;
    },
    listFigures: async () =>
      (await doneOutputs(buildId, "figures")).flatMap((o) => (o as { figures: FigureAsset[] }).figures),
  });
  return { data, published, saved, extract: async () => pages };
}

async function newBuild() {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId, spendCapUsd: 0.5 });
  await t.addStep(buildId, { kind: "extract", wave: 0, input: { sourceId: "s1" } });
  await t.addStep(buildId, { kind: "plan", wave: 1 });
  await t.addStep(buildId, { kind: "figures", wave: 1, maxAttempts: 1, input: { sourceId: "s1" } });
  return { userId, buildId };
}

const validate = (p: unknown) => p as CoursePayload;

function quiz(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    kind: "multiple_choice",
    difficulty: "easy",
    question: `Which step ${i}?`,
    choices: ["One", "Two", "Three", "Four"],
    correct_choice: 1,
    reference_answer: "",
    explanation: "Step two.",
  }));
}

test("pipeline: figures found before writing, reviewed in one low-res call, placed into lessons", async () => {
  const { userId, buildId } = await newBuild();
  const pages = Array.from({ length: 4 }, (_, i) => ({
    n: i + 1,
    text: i === 1 ? `Figure 1. Membrane structure\n${prose(2)}` : i === 2 ? `ATP yield per stage\n${prose(3)}` : prose(i + 1),
  }));
  const mem = setup(pages);
  const findFigures: FindFiguresFn = async () => ({
    candidates: [
      cand(2, mid),
      cand(3, mid, { quality: 0.5 }),
      cand(4, mid, { quality: 0.5 }),
      cand(4, { x: 0.3, y: 0.01, w: 0.4, h: 0.07 }),
    ],
    repeated: [],
  });
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const sheets: Array<[number, number]> = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        calls.push(body);
        const tool = (body.tool_choice as { name: string }).name;
        if (tool === "review_figures") {
          return toolMessage("review_figures", {
            figures: [
              { n: 1, keep: true, kind: "diagram", description: "Lipid bilayer" },
              { n: 2, keep: true, kind: "chart", description: "Bar chart of ATP yield" },
              { n: 3, keep: false, kind: "image", description: "" },
            ],
          });
        }
        const text = body.messages[0].content as string;
        assert.match(text, /\[p2\][^[]*\n\[figure F1\] diagram: "Figure 1\. Membrane structure"\n/, "an unconfirmed description is left out");
        assert.match(text, /\[p3\][^[]*\n\[figure F2\] chart: Bar chart of ATP yield/);
        assert.match(text, /Figures: the pages list figures F1, F2 /, "the instruction comes after the pages");
        assert.doesNotMatch(text, /\[figure F3\]/, "rejected crops are never offered to the writer");
        return toolMessage("submit_course", {
          title: "Membranes",
          description: "How membranes work.",
          module_title: "Membranes",
          lessons: [
            {
              title: "Structure",
              content: "Membranes are lipid bilayers with proteins embedded in them.\n\n[[F1: Lipid bilayer with proteins]]\n\nThey control what enters the cell.\n\n[[F7: made up]]",
              key_terms: [],
              examples: [],
              first_page: 1,
              last_page: 2,
            },
            {
              title: "Energy",
              content: "Cells make most ATP in mitochondria; the yield differs per stage.\n\nGlycolysis adds a little more.",
              key_terms: [],
              examples: [],
              figures: [{ id: "F2", caption: "ATP yield per stage" }, { id: "F1", caption: "already used" }],
              first_page: 3,
              last_page: 4,
            },
          ],
          quiz: quiz(6),
        });
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    findFigures,
    makeContactSheet: async (images, first) => {
      sheets.push([first, images.length]);
      return Buffer.from("sheet");
    },
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50, backoffSeconds: () => 0 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" }, String((await t.build(buildId)).error_message));

  const review = calls.filter((c) => (c.tool_choice as { name: string }).name === "review_figures");
  assert.equal(review.length, 1, "one vision call for all uncertain crops");
  const images = (review[0].messages[0].content as Anthropic.ContentBlockParam[]).filter((b) => b.type === "image");
  assert.equal(images.length, 1, "all crops share one contact sheet");
  assert.deepEqual(sheets, [[1, 3]], "the header strip never reaches vision");
  assert.deepEqual(mem.saved, ["F1", "F2"]);

  const lessons = mem.published.find((p) => p.final)!.payload.modules[0].lessons;
  assert.equal(lessons[0].content, "Membranes are lipid bilayers with proteins embedded in them.\n\nThey control what enters the cell.");
  assert.deepEqual(
    lessons[0].visual_assets?.map((a) => [a.assetId, a.caption, a.placementAfterParagraph, a.sourcePage]),
    [[`${buildId.slice(0, 8)}-F1`, "Figure 1. Membrane structure", 1, 2]],
    "the file's own caption beats the writer's"
  );
  assert.deepEqual(
    lessons[1].visual_assets?.map((a) => [a.assetId, a.caption, a.type, a.placementAfterParagraph]),
    [[`${buildId.slice(0, 8)}-F2`, "ATP yield per stage", "chart", 1]],
    "figures chosen in the lesson's field land after the paragraph matching their page"
  );
  const ledger = await t.ledger(buildId);
  assert.ok(ledger.some((l) => l.purpose === "vision:figures" && l.status === "settled"), "vision is metered");
});

test("pipeline: a broken figure finder leaves the course without figures instead of failing", async () => {
  const { userId, buildId } = await newBuild();
  const mem = setup([{ n: 1, text: prose(1) }, { n: 2, text: prose(2) }]);
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        assert.doesNotMatch(body.messages[0].content as string, /\[figure |Figures: /);
        return toolMessage("submit_course", {
          title: "T",
          description: "D.",
          module_title: "M",
          lessons: [{ title: "L", content: "A full lesson paragraph about the idea at hand.", key_terms: [], examples: [], first_page: 1, last_page: 2 }],
          quiz: quiz(6),
        });
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    findFigures: async () => {
      throw new Error("canvas exploded");
    },
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });
  assert.equal(mem.published.find((p) => p.final)!.payload.modules[0].lessons[0].visual_assets, undefined);
});

function reviewAndWriteClient(events: string[]): MessagesClient {
  return {
    messages: {
      create: async (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        if (tool === "review_figures") {
          events.push("vision");
          return toolMessage("review_figures", { figures: [{ n: 1, keep: true, kind: "diagram", description: "Cell" }] });
        }
        return toolMessage("submit_course", {
          title: "T",
          description: "D.",
          module_title: "M",
          lessons: [{ title: "L", content: "A full lesson paragraph about the idea at hand.", key_terms: [], examples: [], first_page: 1, last_page: 2 }],
          quiz: quiz(6),
        });
      },
    },
  };
}

test("pipeline: the vision check waits until the plan step has reserved the pages", async () => {
  const { userId, buildId } = await newBuild();
  const mem = setup([{ n: 1, text: prose(1) }, { n: 2, text: prose(2) }]);
  const events: string[] = [];
  const handlers = createStepHandlers({
    store: t.store,
    client: reviewAndWriteClient(events),
    config,
    data: {
      ...mem.data(buildId, userId),
      reservePages: async () => {
        await new Promise((r) => setTimeout(r, 300));
        events.push("reserved");
      },
    },
    extract: mem.extract,
    findFigures: async () => {
      events.push("scanned");
      return { candidates: [cand(1, mid, { quality: 0.5 })], repeated: [] };
    },
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });
  assert.deepEqual(events, ["scanned", "reserved", "vision"], "the free scan may run early; the paid check never does");
});

test("pipeline: a refused page reservation means no vision call and no stored figures", async () => {
  const { userId, buildId } = await newBuild();
  const mem = setup([{ n: 1, text: prose(1) }, { n: 2, text: prose(2) }]);
  const events: string[] = [];
  const handlers = createStepHandlers({
    store: t.store,
    client: reviewAndWriteClient(events),
    config,
    data: {
      ...mem.data(buildId, userId),
      reservePages: async () => {
        await new Promise((r) => setTimeout(r, 200));
        throw new StepFatalError("page_limit", "Not enough pages left.");
      },
    },
    extract: mem.extract,
    findFigures: async () => ({ candidates: [cand(1, mid), cand(2, mid, { quality: 0.5 })], repeated: [] }),
    validatePayload: validate,
  });
  const started = Date.now();
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "failed" });
  assert.deepEqual(events, []);
  assert.deepEqual(mem.saved, [], "even confident crops are not uploaded");
  assert.ok(Date.now() - started < 10_000, "the figures step stops waiting once the build is failing");
  assert.equal((await t.ledger(buildId)).length, 0);
});

test("a failed or canceled build's figure images are deleted", async () => {
  const removed: string[][] = [];
  const listed: string[] = [];
  const files = Array.from({ length: 130 }, (_, i) => ({ name: `F${i + 1}.jpg` }));
  const admin = {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "u1" }, error: null }) }) }),
    }),
    storage: {
      from: (bucket: string) => {
        assert.equal(bucket, "study-material-images");
        return {
          list: async (folder: string, opts: { limit: number }) => {
            listed.push(folder);
            return { data: files.splice(0, opts.limit), error: null };
          },
          remove: async (paths: string[]) => {
            removed.push(paths);
            return { data: [], error: null };
          },
        };
      },
    },
  } as unknown as SupabaseClient;
  assert.equal(await removeBuildFigures(admin, "b1"), 130);
  assert.deepEqual(listed, ["u1/course-build/b1", "u1/course-build/b1"]);
  assert.equal(removed[0][0], "u1/course-build/b1/F1.jpg");
  assert.deepEqual(removed.map((r) => r.length), [100, 30]);
});

const ENZYMES = [
  "| Enzyme | Substrate | Product |",
  "| --- | --- | --- |",
  "| Hexokinase | Glucose | Glucose-6-phosphate |",
  "| Aldolase | Fructose-1,6-bisphosphate | G3P and DHAP |",
  "| Enolase | 2-Phosphoglycerate | Phosphoenolpyruvate |",
].join("\n");
const LABELS = [
  "| Nucleus | Ribosome | Membrane |",
  "| --- | --- | --- |",
  "| Cytoplasm | Vacuole | Lysosome |",
  "| Golgi | Mitochondrion | Chloroplast |",
].join("\n");
const tablePagesFixture = (): SourcePage[] => [
  { n: 1, text: `Glycolysis splits glucose in ten steps, each run by its own enzyme in the cytosol.\n${ENZYMES}` },
  { n: 2, text: `A drawing of the cell with every organelle named around the outside of the picture.\n${LABELS}` },
];

function tableCheckClient(tables: (body: Anthropic.MessageCreateParamsNonStreaming) => Anthropic.Message, writerSaw: string[]): MessagesClient {
  return {
    messages: {
      create: async (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        if (tool === "review_table_pages") return tables(body);
        writerSaw.push(body.messages[0].content as string);
        return toolMessage("submit_course", {
          title: "Cells",
          description: "Glycolysis and the cell.",
          module_title: "Cells",
          lessons: [
            {
              title: "Glycolysis and organelles",
              content: "Glycolysis runs in the cytosol and splits glucose.\n\nThe cell holds many organelles, each with its own job.",
              key_terms: [],
              examples: [],
              first_page: 1,
              last_page: 2,
            },
          ],
          quiz: quiz(6),
        });
      },
    },
  };
}

test("pipeline: a page vision finds no table on loses its text-layer table to plain text; a confirmed one stays", async () => {
  const { userId, buildId } = await newBuild();
  const mem = setup(tablePagesFixture());
  const asked: Array<number[] | undefined> = [];
  const writerSaw: string[] = [];
  let images = 0;
  const handlers = createStepHandlers({
    store: t.store,
    client: tableCheckClient((body) => {
      images = (body.messages[0].content as Anthropic.ContentBlockParam[]).filter((b) => b.type === "image").length;
      assert.match(body.system as string, /diagram/);
      return toolMessage("review_table_pages", { pages: [{ n: 1, table: true }, { n: 2, table: false }] });
    }, writerSaw),
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    findFigures: async (_source, _signal, opts) => {
      asked.push(opts?.tablePages?.map((p) => p.page));
      return {
        candidates: [],
        repeated: [],
        pageImages: (opts?.tablePages ?? []).map(({ page }) => ({ page, image: Buffer.from(`page-${page}`) })),
      };
    },
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50, backoffSeconds: () => 0 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" }, String((await t.build(buildId)).error_message));
  assert.deepEqual(asked, [[1, 2]], "only pages whose text formed a table are rendered");
  assert.equal(images, 2, "one call for both pages");

  assert.doesNotMatch(writerSaw[0], /\| Nucleus \|/, "the writer never sees the rejected table");
  assert.match(writerSaw[0], /Nucleus Ribosome Membrane\nCytoplasm Vacuole Lysosome/, "its text is kept as lines");
  assert.match(writerSaw[0], /\| Hexokinase \| Glucose \|/);

  const content = mem.published.find((p) => p.final)!.payload.modules[0].lessons[0].content;
  assert.match(content, /\| Enzyme \| Substrate \| Product \|/, "the confirmed table still reaches the lesson");
  assert.doesNotMatch(content, /\| Nucleus/);
  const ledger = await t.ledger(buildId);
  assert.ok(ledger.some((l) => l.purpose === "vision:tables" && l.status === "settled"), "the table check is metered");
});

test("pipeline: when the table check is unavailable the build completes and keeps the text-layer tables", async () => {
  const { userId, buildId } = await newBuild();
  const mem = setup(tablePagesFixture());
  const writerSaw: string[] = [];
  const handlers = createStepHandlers({
    store: t.store,
    client: tableCheckClient(() => {
      throw new Error("vision overloaded");
    }, writerSaw),
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    findFigures: async (_source, _signal, opts) => ({
      candidates: [],
      repeated: [],
      pageImages: (opts?.tablePages ?? []).map(({ page }) => ({ page, image: Buffer.from(`page-${page}`) })),
    }),
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50, backoffSeconds: () => 0 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" }, String((await t.build(buildId)).error_message));
  const content = mem.published.find((p) => p.final)!.payload.modules[0].lessons[0].content;
  assert.match(content, /\| Enzyme \| Substrate \| Product \|/);
  assert.match(content, /\| Nucleus \| Ribosome \| Membrane \|/, "no verdict keeps the structural decision");
});
