import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { CoursePayload } from "@/types/course";
import type { SourcePage } from "./clean.ts";
import { readCourseBuildConfig } from "./config.ts";
import {
  createStepHandlers,
  previewFromSnapshot,
  type BuildData,
  type ModulePreview,
  type ModuleStepOutput,
  type PublishInput,
  type SourceRecord,
} from "./handlers.ts";
import { StepFatalError } from "./errors.ts";
import { resetStructuredOutputOutage, type MessagesClient } from "./metered-call.ts";
import { lessonWordBudget, quizSplit, toCourseModule } from "./module.ts";
import { numberPages } from "./outline.ts";
import {
  maxModulesFor,
  moduleMaxTokens,
  moduleTargetTokens,
  quizCountForWeight,
  repairPlan,
  type BuildPlan,
} from "./plan.ts";
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
const prose = (i: number) => `Concept ${i} is explained here with enough words to count as a real content page. `.repeat(3);

function pagesOf(count: number): SourcePage[] {
  return Array.from({ length: count }, (_, i) => ({ n: i + 1, text: prose(i + 1) }));
}

function buildPages(count: number) {
  const sources = [{ index: 0, label: "lec.pdf", kind: "pdf", pages: pagesOf(count) }];
  return { sources, pages: numberPages(sources) };
}

test("plan repair: contiguous ranges from 1, full coverage, skip and info pages excluded", () => {
  const { pages } = buildPages(20);
  const plan = repairPlan(
    {
      title: "Cell Respiration",
      description: "How cells make ATP.",
      modules: [
        { title: "Electron Transport", first_page: 12, last_page: 20, lessons: ["Complexes", "Proton motive force"] },
        { title: "Glycolysis", first_page: 3, last_page: 11, lessons: ["Energy investment", "Payoff"] },
      ],
      skip_pages: [1, 99],
      info_pages: [2],
    },
    pages,
    config
  );
  assert.deepEqual(plan.modules.map((m) => m.title), ["Glycolysis", "Electron Transport"]);
  assert.deepEqual(plan.modules.map((m) => m.id), [1, 2]);
  assert.deepEqual(plan.modules[0].pages, [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(plan.modules[1].pages, [12, 13, 14, 15, 16, 17, 18, 19, 20]);
  assert.deepEqual(plan.skipPages, [1]);
  assert.deepEqual(plan.infoPages, [2]);
});

test("plan repair: thin modules merge, oversized ones split, garbage becomes one module", () => {
  const small = buildPages(10).pages;
  const merged = repairPlan(
    { modules: [{ title: "A", first_page: 1, lessons: [] }, { title: "B", first_page: 2, lessons: [] }] },
    small,
    config
  );
  assert.equal(merged.modules.length, 1);
  assert.equal(merged.modules[0].pages.length, 10);

  const { pages } = buildPages(40);
  const split = repairPlan({ modules: [{ title: "Everything", first_page: 1, lessons: ["x", "y", "z", "w"] }] }, pages, config);
  assert.ok(split.modules.length >= 3, `got ${split.modules.length}`);
  assert.deepEqual(split.modules.flatMap((m) => m.pages), pages.map((p) => p.g));

  const junk = repairPlan("not a plan", pages, config);
  assert.equal(junk.modules.length >= 3, true);

  const allSkipped = repairPlan({ modules: [{ title: "A", first_page: 1 }], skip_pages: pages.map((p) => p.g) }, pages, config);
  assert.deepEqual(allSkipped.skipPages, [], "a plan that skips most content is ignored");
});

test("output budget: 200 tokens per page with a floor, 40% ceiling headroom; quiz scales 6–10", () => {
  assert.equal(moduleTargetTokens(10, config), 2000);
  assert.equal(moduleMaxTokens(10, config), 3000);
  assert.equal(moduleTargetTokens(3, config), 1400);
  assert.equal(moduleMaxTokens(3, config), 2300);
  assert.equal(quizCountForWeight(2), 6);
  assert.equal(quizCountForWeight(12), 7);
  assert.equal(quizCountForWeight(40), 10);
  assert.deepEqual(quizSplit(9), { mcq: 6, free: 3 });
  assert.equal(lessonWordBudget(2400, 7, 3), 930);
  assert.equal(maxModulesFor(12), 1);
  assert.equal(maxModulesFor(28), 3);
});

test("plan repair: never more modules than the budget can fill", () => {
  const { pages } = buildPages(24);
  const plan = repairPlan(
    { modules: Array.from({ length: 4 }, (_, i) => ({ title: `M${i + 1}`, first_page: i * 6 + 1, lessons: [] })) },
    pages,
    config
  );
  assert.equal(plan.modules.length, 3);
  assert.deepEqual(plan.modules.flatMap((m) => m.pages), pages.map((p) => p.g));
});

test("plan repair: dense pages never earn more output than the page count allows", () => {
  const dense = "A long paragraph of dense reading that keeps going. ".repeat(60);
  const sources = [
    { index: 0, label: "article", kind: "url", pages: Array.from({ length: 27 }, (_, i) => ({ n: i + 1, text: `${i} ${dense}` })) },
  ];
  const pages = numberPages(sources);
  const plan = repairPlan(
    { modules: Array.from({ length: 6 }, (_, i) => ({ title: `M${i + 1}`, first_page: i * 4 + 1, lessons: [] })) },
    pages,
    config
  );
  assert.equal(plan.modules.length, maxModulesFor(27));
  const weight = plan.modules.reduce((sum, m) => sum + m.weight, 0);
  assert.ok(Math.abs(weight - 27) < 1e-6, `total weight ${weight}`);
  assert.deepEqual(plan.modules.flatMap((m) => m.pages), pages.map((p) => p.g));
});

function moduleInput(pages: number[], quiz = 6) {
  return {
    lessons: [
      {
        title: "Energy Investment Phase",
        content: "In this lesson we will look at glycolysis. Glycolysis spends 2 ATP in steps 1-3 before any payoff.",
        key_terms: [{ term: "Hexokinase", definition: "Enzyme that phosphorylates glucose." }],
        examples: ["Glucose becomes glucose-6-phosphate."],
        first_page: pages[0],
        last_page: pages[pages.length - 1],
      },
    ],
    quiz: Array.from({ length: quiz }, (_, i) =>
      i % 3 === 2
        ? {
            kind: "free_response",
            difficulty: "hard",
            question: `Explain step ${i}?`,
            choices: [],
            correct_choice: 0,
            reference_answer: "ATP is invested first.",
            explanation: "The early steps cost ATP.",
          }
        : {
            kind: "multiple_choice",
            difficulty: "easy",
            question: `Which step ${i}?`,
            choices: ["One", "Two", "Three", "Four"],
            correct_choice: 1,
            reference_answer: "",
            explanation: "Step two.",
          }
    ),
  };
}

test("writer output maps onto CourseModule with sources, difficulty and text fixes", () => {
  const { sources, pages } = buildPages(10);
  const plan = repairPlan({ modules: [{ title: "Glycolysis", first_page: 1, lessons: [] }] }, pages, config);
  const { module } = toCourseModule(moduleInput([2, 5]), { module: plan.modules[0], pages, sources }, "Glycolysis");
  assert.equal(module.id, 1);
  assert.equal(module.lessons[0].content, "Glycolysis spends 2 ATP in steps 1–3 before any payoff.");
  // The module's only lesson must span every content page, not just the ones the writer named.
  assert.deepEqual(module.lessons[0].sources, [{ fileName: "lec.pdf", locator: "pages 1–10" }]);
  const mcq = module.quiz[0];
  assert.equal(mcq.type, "mcq");
  assert.equal((mcq as { correct: string }).correct, "B");
  assert.equal(mcq.difficulty, "easy");
  assert.equal(module.quiz[2].type, "free_response");
});

function toolMessage(name: string, input: unknown, stop: Anthropic.StopReason = "tool_use"): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "claude-haiku-4-5",
    stop_reason: stop,
    stop_sequence: null,
    content: [{ type: "tool_use", id: "tu", name, input } as Anthropic.ToolUseBlock],
    usage: { input_tokens: 1000, output_tokens: 500 } as Anthropic.Usage,
  } as Anthropic.Message;
}

function memoryData(sourcePages: SourcePage[], kind = "pdf") {
  const sources: SourceRecord[] = [
    { id: "s1", position: 0, kind, label: "lec.pdf", storagePath: "x", sourceUrl: null, pages: null },
  ];
  const published: PublishInput[] = [];
  const sizes: Array<[number, number]> = [];
  const doneOutputs = async (buildId: string, kindName: string) =>
    (await t.steps(buildId)).filter((s) => s.kind === kindName && s.status === "done").map((s) => s.output);
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
    saveSourcePages: async (_id, pages) => {
      sources[0].pages = pages;
    },
    setBuildSize: async (_id, pages, cap) => {
      sizes.push([pages, cap]);
    },
    savePlan: async () => {},
    getPlan: async () => ((await doneOutputs(buildId, "plan"))[0] as BuildPlan) ?? null,
    listModuleOutputs: async () => (await doneOutputs(buildId, "module")) as ModuleStepOutput[],
    publish: async (input) => {
      published.push(structuredClone(input));
      return "material-1";
    },
  });
  return { data, published, sizes, extract: async () => sourcePages };
}

async function newBuild() {
  const userId = await t.createUser();
  const buildId = await t.createBuild({ userId, spendCapUsd: 0.5 });
  await t.addStep(buildId, { kind: "extract", wave: 0, input: { sourceId: "s1" } });
  await t.addStep(buildId, { kind: "plan", wave: 1 });
  return { userId, buildId };
}

const validate = (p: unknown) => {
  const payload = p as CoursePayload;
  if (!payload.modules.length || payload.modules.some((m) => !m.lessons.length || !m.quiz.length)) {
    throw new Error("invalid");
  }
  return payload;
};

test("full pipeline: extract → plan → parallel modules → finalize, every call metered", async () => {
  const { userId, buildId } = await newBuild();
  const mem = memoryData(pagesOf(24));
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let cutOffOnce = true;
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        requests.push(body);
        const tool = (body.tool_choice as { name: string }).name;
        if (tool === "submit_plan") {
          return toolMessage("submit_plan", {
            title: "Glycolysis",
            description: "How glucose is split.",
            modules: [
              { title: "Investment Phase", first_page: 1, last_page: 12, lessons: ["Hexokinase"] },
              { title: "Payoff Phase", first_page: 13, last_page: 24, lessons: ["Substrate-level phosphorylation"] },
            ],
            skip_pages: [],
            info_pages: [],
          });
        }
        const text = (body.messages[0].content as string) ?? "";
        const pages = [...text.matchAll(/\[p(\d+)\]/g)].map((m) => Number(m[1]));
        if (text.includes("module 2") && cutOffOnce) {
          cutOffOnce = false;
          return toolMessage("submit_module", {}, "max_tokens");
        }
        return toolMessage("submit_module", moduleInput(pages));
      },
    },
  };

  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50, backoffSeconds: () => 0 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });

  assert.deepEqual(mem.sizes, [[24, 0.06]]);
  const planReq = requests.find((r) => (r.tool_choice as { name: string }).name === "submit_plan")!;
  assert.ok(!(planReq.messages[0].content as string).includes("real content page. Concept"), "planner sees the outline, not full text");

  const moduleReqs = requests.filter((r) => (r.tool_choice as { name: string }).name === "submit_module");
  assert.equal(moduleReqs.length, 3, "module 2 was retried once after being cut off");
  const firstM2 = moduleReqs.find((r) => (r.messages[0].content as string).includes("module 2"))!;
  const retryM2 = moduleReqs.filter((r) => (r.messages[0].content as string).includes("module 2"))[1];
  assert.ok(retryM2.max_tokens > firstM2.max_tokens, "retry gets more room");
  for (const r of moduleReqs) {
    const body = r.messages[0].content as string;
    const own = body.includes("module 1") ? [1, 12] : [13, 24];
    const seen = [...body.matchAll(/\[p(\d+)\]/g)].map((m) => Number(m[1]));
    assert.ok(seen.every((g) => g >= own[0] && g <= own[1]), "each module call gets only its own pages");
  }

  const final = mem.published.find((p) => p.final)!;
  assert.deepEqual(final.payload.modules.map((m) => m.id), [1, 2]);
  assert.equal(final.payload.title, "Glycolysis");
  assert.ok(mem.published.filter((p) => !p.final).length >= 2, "each module is published as it finishes");

  const ledger = await t.ledger(buildId);
  assert.equal(ledger.length, 4);
  assert.ok(ledger.every((l) => l.status === "settled"));
});

test("short sources skip the planning call and become one module", async () => {
  const { userId, buildId } = await newBuild();
  const mem = memoryData(pagesOf(4));
  const tools: string[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        tools.push(tool);
        return toolMessage(tool, { title: "Redox", description: "Electron transfer.", module_title: "Oxidation and Reduction", ...moduleInput([1, 4]) });
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });
  assert.deepEqual(tools, ["submit_course"]);
  const final = mem.published.find((p) => p.final)!;
  assert.equal(final.payload.title, "Redox");
  assert.equal(final.payload.modules[0].title, "Oxidation and Reduction");
});

test("a page the writer skipped is written by one extra metered call and joins the course", async () => {
  const { userId, buildId } = await newBuild();
  const topics = [
    "Oxidation is the loss of electrons; the species that is oxidised acts as the reducing agent in every redox reaction.",
    "Reduction is the gain of electrons; oxidising agents such as permanganate accept electrons and are themselves reduced.",
    "Oxidation numbers track electrons: assign hydrogen plus one and oxygen minus two, then balance the remaining atoms.",
    "Galvanic cells separate the half reactions so electrons flow through a wire from the zinc anode to the copper cathode.",
  ];
  const mem = memoryData(topics.map((text, i) => ({ n: i + 1, text: `${text} ${text}` })));
  const tools: string[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        tools.push(tool);
        if (tool === "submit_missing_lessons") {
          assert.match(body.messages[0].content as string, /\[p4\]/);
          assert.doesNotMatch(body.messages[0].content as string, /\[p1\]/);
          return toolMessage(tool, {
            lessons: [{ title: "Galvanic Cells", content: topics[3], key_terms: [], examples: [], first_page: 4, last_page: 4 }],
          });
        }
        const lessons = [0, 1, 2].map((i) => ({ title: `Topic ${i + 1}`, content: topics[i], key_terms: [], examples: [], first_page: i + 1, last_page: i + 1 }));
        return toolMessage(tool, { title: "Redox", description: "Electron transfer.", module_title: "Redox", ...moduleInput([1, 3]), lessons });
      },
    },
  };
  const handlers = createStepHandlers({ store: t.store, client, config, data: mem.data(buildId, userId), extract: mem.extract, validatePayload: validate });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });
  assert.deepEqual(tools, ["submit_course", "submit_missing_lessons"]);
  const lessons = mem.published.find((p) => p.final)!.payload.modules[0].lessons;
  assert.deepEqual(lessons.map((l) => l.title), ["Topic 1", "Topic 2", "Topic 3", "Galvanic Cells"]);
  assert.equal(lessons[3]?.sources?.[0]?.locator, "page 4");
  const ledger = await t.ledger(buildId);
  assert.equal(ledger.length, 2);
  assert.ok(ledger.every((l) => l.status === "settled"));
  assert.match(String(ledger[1]!.purpose), /:gap$/);
});

test("a source with no text fails with a plain message and no AI call", async () => {
  const { userId, buildId } = await newBuild();
  const mem = memoryData([{ n: 1, text: "" }, { n: 2, text: " " }]);
  let calls = 0;
  const client: MessagesClient = {
    messages: {
      create: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: mem.data(buildId, userId),
    extract: mem.extract,
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "failed" });
  assert.equal(calls, 0);
  const b = await t.build(buildId);
  assert.equal(b.error_code, "no_text");
});

test("page reservation runs before any AI call and a refusal fails the build plainly", async () => {
  const { userId, buildId } = await newBuild();
  const mem = memoryData(pagesOf(24));
  let calls = 0;
  const reserved: number[] = [];
  const client: MessagesClient = {
    messages: {
      create: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: {
      ...mem.data(buildId, userId),
      reservePages: async (_build, pages) => {
        reserved.push(pages);
        throw new StepFatalError("source_page_cap_reached", "You have 10 source pages left this month; this upload has 24.");
      },
    },
    extract: mem.extract,
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "failed" });
  assert.deepEqual(reserved, [24]);
  assert.equal(calls, 0);
  const b = await t.build(buildId);
  assert.equal(b.error_code, "source_page_cap_reached");
  assert.match(String(b.error_message), /24/);
});

test("preview snapshots keep only titles and text, and skip empty ones", () => {
  assert.equal(previewFromSnapshot(null), null);
  assert.equal(previewFromSnapshot({ lessons: [] }), null);
  assert.deepEqual(
    previewFromSnapshot({ lessons: [{ title: "Hexokinase", content: "Traps glucose", key_terms: [{}] }, {}], quiz: [{}, {}] }),
    { lessons: [{ title: "Hexokinase", content: "Traps glucose" }], quiz: 2 }
  );
  assert.deepEqual(previewFromSnapshot({ title: "Redox", module_title: "Oxidation", lessons: [] }), {
    title: "Redox",
    moduleTitle: "Oxidation",
    lessons: [],
    quiz: 0,
  });
});

test("a streaming writer saves throttled previews while the module is written", async () => {
  const { userId, buildId } = await newBuild();
  const mem = memoryData(pagesOf(4));
  const previews: ModulePreview[] = [];
  const client: MessagesClient = {
    messages: {
      create: async () => {
        throw new Error("module calls should stream");
      },
      stream: (body) => {
        const tool = (body.tool_choice as { name: string }).name;
        const full = { title: "Redox", description: "Electron transfer.", module_title: "Oxidation and Reduction", ...moduleInput([1, 4]) };
        let listener: ((d: string, s: unknown) => void) | null = null;
        return {
          on(_e, fn) {
            listener = fn;
            return this;
          },
          async finalMessage() {
            const lessons = (full as { lessons: Array<{ title: string; content: string }> }).lessons;
            listener?.("", { title: "Redox", lessons: [{ title: lessons[0].title, content: "Oxid" }] });
            listener?.("", { title: "Redox", lessons: [{ title: lessons[0].title, content: "Oxidation is" }] });
            await new Promise((r) => setTimeout(r, 1100));
            listener?.("", { title: "Redox", lessons: [lessons[0], { title: "Second" }] });
            await new Promise((r) => setTimeout(r, 1100));
            return toolMessage(tool, full);
          },
        };
      },
    },
  };
  const handlers = createStepHandlers({
    store: t.store,
    client,
    config,
    data: {
      ...mem.data(buildId, userId),
      savePreview: async (_stepId, owner, p) => {
        assert.ok(owner);
        previews.push(p);
      },
    },
    extract: mem.extract,
    validatePayload: validate,
  });
  const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
  assert.deepEqual(out, { outcome: "finished", status: "complete" });
  assert.equal(previews.length, 2, "two bursts a second apart give two saves");
  assert.equal(previews[0].lessons[0].content, "Oxidation is", "a burst saves only its newest snapshot");
  assert.equal(previews[1].lessons.length, 2);
});

test("during a structured-output outage the plan and modules still complete without strict schemas", async () => {
  resetStructuredOutputOutage();
  try {
    const { userId, buildId } = await newBuild();
    const mem = memoryData(pagesOf(24));
    const sent: Array<{ tool: string; strict: boolean }> = [];
    const client: MessagesClient = {
      messages: {
        create: async (body) => {
          const tool = (body.tool_choice as { name: string }).name;
          const strict = (body.tools ?? []).some((x) => (x as Anthropic.Tool).strict === true);
          sent.push({ tool, strict });
          if (strict) {
            throw Object.assign(
              new Error('503 {"type":"error","error":{"type":"overloaded_error","message":"Grammar compilation is temporarily unavailable. Please try again."}}'),
              { status: 503 }
            );
          }
          if (tool === "submit_plan") {
            return toolMessage("submit_plan", {
              title: "Glycolysis",
              description: "How glucose is split.",
              // Schema-free output sometimes arrives stringified.
              modules: JSON.stringify([
                { title: "Investment Phase", first_page: 1, last_page: 12, lessons: ["Hexokinase"] },
                { title: "Payoff Phase", first_page: 13, last_page: 24, lessons: ["Substrate-level phosphorylation"] },
              ]),
              skip_pages: [],
              info_pages: [],
            });
          }
          const text = (body.messages[0].content as string) ?? "";
          const pages = [...text.matchAll(/\[p(\d+)\]/g)].map((m) => Number(m[1]));
          const input = moduleInput(pages);
          return toolMessage("submit_module", { ...input, lessons: JSON.stringify(input.lessons) });
        },
      },
    };
    const handlers = createStepHandlers({
      store: t.store,
      client,
      config,
      data: mem.data(buildId, userId),
      extract: mem.extract,
      validatePayload: validate,
    });
    const out = await driveBuild({ buildId, store: t.store, handlers, heartbeatMs: 50 });
    assert.deepEqual(out, { outcome: "finished", status: "complete" });
    assert.deepEqual(sent[0], { tool: "submit_plan", strict: true });
    assert.deepEqual(sent[1], { tool: "submit_plan", strict: false });
    assert.ok(sent.slice(2).every((s) => !s.strict), "later calls skip strict while it is down");
    const final = mem.published.find((p) => p.final)!;
    assert.deepEqual(final.payload.modules.map((m) => m.title), ["Investment Phase", "Payoff Phase"]);
    const plan = (await t.steps(buildId)).find((s) => s.kind === "plan")!;
    assert.equal(plan.attempts, 1, "the outage cost no step attempts");
  } finally {
    resetStructuredOutputOutage();
  }
});
