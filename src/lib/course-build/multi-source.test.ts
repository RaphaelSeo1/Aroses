import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { CoursePayload } from "@/types/course";
import type { SourcePage } from "./clean.ts";
import { readCourseBuildConfig } from "./config.ts";
import type { Box, FigureAsset, FigureCandidate } from "./figures.ts";
import {
  createStepHandlers,
  multiFileLine,
  type BuildData,
  type FindFiguresFn,
  type ModuleStepOutput,
  type PublishInput,
  type SourceRecord,
} from "./handlers.ts";
import type { MessagesClient } from "./metered-call.ts";
import type { BuildPlan } from "./plan.ts";
import { buildSpendCapUsd } from "./pricing.ts";
import { driveBuild } from "./runner.ts";
import { createTestDb, type TestDb } from "./testing/pglite-db.ts";

let t: TestDb;
before(async () => {
  t = await createTestDb();
});
after(async () => {
  await t.close();
});

const config = readCourseBuildConfig({ COURSE_BUILD_ENABLED: "1" });
const mid: Box = { x: 0.1, y: 0.3, w: 0.6, h: 0.4 };

function cand(page: number, tag: string): FigureCandidate {
  return {
    page,
    origin: "raster",
    box: mid,
    width: 660,
    height: 560,
    image: Buffer.from(`img-${tag}`),
    mime: "image/jpeg",
    thumb: Buffer.from(`thumb-${tag}`),
    quality: 0.8,
    tableGrid: false,
  };
}

function toolMessage(name: string, input: unknown): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu", name, input } as Anthropic.ToolUseBlock],
    usage: { input_tokens: 900, output_tokens: 300 } as Anthropic.Usage,
  } as Anthropic.Message;
}

const TOPICS: Record<string, string[]> = {
  capsid: ["icosahedral", "helical", "capsomere", "protomer", "symmetry", "nucleocapsid", "assembly", "portal"],
  envelope: ["glycoprotein", "spike", "budding", "membrane", "fusion", "matrix", "lipid", "receptor", "tegument", "hemagglutinin", "neuraminidase", "peplomer"],
  replication: ["attachment", "penetration", "uncoating", "transcription", "translation", "maturation", "release", "latency"],
};

function filePages(topic: string, figurePage: number | null): SourcePage[] {
  return TOPICS[topic]!.map((word, i) => ({
    n: i + 1,
    text: `${i + 1 === figurePage ? `Figure ${i + 1}. The ${word} of the ${topic}\n` : ""}The ${word} stage of the ${topic} is described with its own vocabulary: ${word}ase, ${word}ome and ${word}ic transfer happen here.`,
  }));
}

test("planner note appears only when a build has two or more files with pages", () => {
  const src = (index: number, pages: number) => ({ index, label: `f${index}`, kind: "pdf", pages: filePages("capsid", null).slice(0, pages) });
  assert.equal(multiFileLine([src(0, 3)]), "");
  assert.equal(multiFileLine([src(0, 3), src(1, 0)]), "");
  assert.match(multiFileLine([src(0, 3), src(1, 2)]), /These 2 files .* one lecture, in the student's reading order/);
});

test("a combined build of three files becomes one named material that plans, cites and illustrates across all of them", async () => {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId, spendCapUsd: 0.5 });
  const files = [
    { id: "s1", label: "Lec 3 slides.pdf", kind: "pdf", pages: filePages("capsid", 2) },
    { id: "s2", label: "Lec 3 reading.pdf", kind: "pdf", pages: filePages("envelope", 3) },
    { id: "s3", label: "Review notes.docx", kind: "docx", pages: filePages("replication", null) },
  ];
  const sources: SourceRecord[] = files.map((f, position) => ({
    id: f.id,
    position,
    kind: f.kind,
    label: f.label,
    storagePath: `u/${f.id}`,
    sourceUrl: null,
    pages: null,
  }));
  for (const [i, f] of files.entries()) await t.addStep(buildId, { kind: "extract", ordinal: i, wave: 0, input: { sourceId: f.id } });
  await t.addStep(buildId, { kind: "plan", wave: 1, input: { title: "Viruses, week 3" } });
  await t.addStep(buildId, { kind: "figures", ordinal: 0, wave: 1, maxAttempts: 1, input: { sourceId: "s1" } });
  await t.addStep(buildId, { kind: "figures", ordinal: 1, wave: 1, maxAttempts: 1, input: { sourceId: "s2" } });

  const published: PublishInput[] = [];
  const sizes: Array<[number, number]> = [];
  const reserved: number[] = [];
  const saved: string[] = [];
  const doneOutputs = async (kind: string) =>
    (await t.steps(buildId)).filter((s) => s.kind === kind && s.status === "done").map((s) => s.output);
  const data: BuildData = {
    getBuild: async () => ({ id: buildId, userId, courseId: "c", examGroupId: "g", materialId: null, outputLanguage: null, studyGoal: null }),
    listSources: async () => sources,
    saveSourcePages: async (id, pages) => {
      sources.find((s) => s.id === id)!.pages = pages;
    },
    setBuildSize: async (_id, pages, cap) => {
      sizes.push([pages, cap]);
    },
    reservePages: async (_b, pages) => {
      reserved.push(pages);
    },
    savePlan: async () => {},
    getPlan: async () => ((await doneOutputs("plan"))[0] as BuildPlan) ?? null,
    listModuleOutputs: async () => (await doneOutputs("module")) as ModuleStepOutput[],
    publish: async (input) => {
      published.push(structuredClone(input));
      return "material-1";
    },
    saveFigure: async (build, id) => {
      saved.push(id);
      return `https://cdn.test/${build.id}/${id}.jpg`;
    },
    listFigures: async () => (await doneOutputs("figures")).flatMap((o) => (o as { figures: FigureAsset[] }).figures),
  };
  const findFigures: FindFiguresFn = async (source) => ({
    candidates: source.id === "s1" ? [cand(2, "s1")] : source.id === "s2" ? [cand(3, "s2")] : [],
    repeated: [],
  });

  const requests: Array<{ tool: string; text: string }> = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        const first = body.messages[0].content;
        const text = typeof first === "string" ? first : "";
        requests.push({ tool, text });
        if (tool === "review_figures") {
          return toolMessage(tool, { figures: [{ n: 1, keep: true, kind: "diagram", description: "Labelled structure diagram" }] });
        }
        if (tool === "submit_plan") {
          // The first module runs across the boundary between the slides and the reading.
          return toolMessage(tool, {
            title: "Capsid Structure",
            description: "How viruses are built and replicate.",
            modules: [
              { title: "Capsids and Early Envelope", first_page: 1, lessons: ["Capsid symmetry"] },
              { title: "Envelope Proteins", first_page: 13, lessons: ["Spikes"] },
              { title: "Replication Cycle", first_page: 21, lessons: ["Attachment to release"] },
            ],
            skip_pages: [],
            info_pages: [],
          });
        }
        // The writer teaches exactly its pages, and places every figure it was offered.
        const pages = [...text.matchAll(/\[p(\d+)\]\n(?:Figure[^\n]*\n)?([^\n]+)/g)].map((m) => ({ g: Number(m[1]), text: m[2]! }));
        const figures = [...new Set([...text.matchAll(/\[figure (F\d+)\]/g)].map((m) => m[1]!))];
        const half = Math.ceil(pages.length / 2);
        const lesson = (part: typeof pages, i: number) => ({
          title: `Lesson ${i + 1} from p${part[0]!.g}`,
          content: part.map((p) => p.text).join("\n\n"),
          key_terms: [],
          examples: [],
          figures: i === 0 ? figures.map((id) => ({ id, caption: "Structure diagram" })) : [],
          first_page: part[0]!.g,
          last_page: part[part.length - 1]!.g,
        });
        return toolMessage(tool, {
          lessons: [lesson(pages.slice(0, half), 0), lesson(pages.slice(half), 1)],
          quiz: Array.from({ length: 6 }, (_, i) => ({
            kind: "multiple_choice",
            difficulty: "medium",
            question: `Which stage comes ${i}?`,
            choices: ["One", "Two", "Three", "Four"],
            correct_choice: 1,
            reference_answer: "",
            explanation: "Stage two.",
          })),
        });
      },
    },
  };

  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data,
    extract: async (source) => files.find((f) => f.id === source.id)!.pages,
    findFigures,
    makeContactSheet: async () => Buffer.from("sheet"),
    validatePayload: (p) => p as CoursePayload,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50, backoffSeconds: () => 0 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" }, String((await t.build(buildId)).error_message));

  // Size, cap and reservation cover every file.
  assert.deepEqual(reserved, [28]);
  assert.deepEqual(sizes, [[28, buildSpendCapUsd(28, config, 1, 2)]]);
  assert.equal(sizes[0]![1], 0.09);

  // The planner sees each file under its own header, in order, and is told they are one lecture.
  const plan = requests.find((r) => r.tool === "submit_plan")!.text;
  const headers = ["== Lec 3 slides.pdf (pdf) ==", "== Lec 3 reading.pdf (pdf) ==", "== Review notes.docx (docx) =="].map((h) => plan.indexOf(h));
  assert.ok(headers.every((i) => i >= 0) && headers[0]! < headers[1]! && headers[1]! < headers[2]!, "file headers in reading order");
  assert.match(plan, /These 3 files \(== headers\) are one lecture/);

  // Every page of every file is in exactly one module.
  const planned = (await doneOutputs("plan"))[0] as BuildPlan;
  assert.equal(planned.title, "Viruses, week 3");
  assert.deepEqual(planned.modules.flatMap((m) => m.pages), Array.from({ length: 28 }, (_, i) => i + 1));

  // The module across the boundary gets both files' pages and figures from both PDFs.
  const m1 = requests.find((r) => r.tool === "submit_module" && r.text.includes("Write module 1"))!.text;
  assert.ok(m1.indexOf("== Lec 3 slides.pdf ==") < m1.indexOf("== Lec 3 reading.pdf =="));
  assert.match(m1, /\[figure F1\]/);
  assert.match(m1, /\[figure F101\]/);
  assert.deepEqual(saved.sort(), ["F1", "F101"]);

  const final = published.find((p) => p.final)!;
  assert.equal(final.payload.title, "Viruses, week 3", "the student's name replaces the planner's title");
  assert.equal(final.payload.modules.length, 3);
  const [first, , third] = final.payload.modules;
  assert.deepEqual(
    first!.lessons.flatMap((l) => l.sources ?? []),
    [
      { fileName: "Lec 3 slides.pdf", locator: "pages 1–6" },
      { fileName: "Lec 3 slides.pdf", locator: "pages 7–8" },
      { fileName: "Lec 3 reading.pdf", locator: "pages 1–4" },
    ]
  );
  const assets = first!.lessons.flatMap((l) => l.visual_assets ?? []).map((a) => a.assetId);
  assert.deepEqual(assets.sort(), [`${buildId.slice(0, 8)}-F1`, `${buildId.slice(0, 8)}-F101`]);
  assert.ok(third!.lessons.every((l) => (l.sources ?? []).every((s) => s.fileName === "Review notes.docx")));

  // Nothing was left for a gap call: the coverage check passed on every file.
  const ledger = await t.ledger(buildId);
  assert.equal(ledger.filter((l) => String(l.purpose).endsWith(":gap")).length, 0);
  assert.equal(ledger.length, 6, "one plan, two figure reviews, three modules");
  assert.ok(ledger.every((l) => l.status === "settled"));
});
