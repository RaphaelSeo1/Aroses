import assert from "node:assert/strict";
import { test } from "node:test";
import { buildStatusView, type StepView } from "./status-view.ts";

const NOW = Date.parse("2026-09-27T12:00:00Z");

function build(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: "b1",
    status,
    course_id: "c1",
    exam_group_id: "g1",
    material_id: "m1",
    plan: null,
    source_pages: 12,
    error_code: null,
    error_message: null,
    cancel_requested_at: null,
    first_module_at: null,
    completed_at: null,
    created_at: "2026-09-27T11:59:00Z",
    ...extra,
  };
}

const step = (kind: string, status: string, extra: Partial<StepView> = {}): StepView => ({
  kind,
  ordinal: 0,
  status,
  attempts: 0,
  run_after: null,
  preview: null,
  ...extra,
});

const view = (b: ReturnType<typeof build>, steps: StepView[]) =>
  buildStatusView({ build: b, steps, sources: [], materialTitle: null, modules: [], now: NOW });

test("stages follow the steps: reading, planning, writing, finishing, done", () => {
  assert.equal(view(build("running"), [step("extract", "running"), step("plan", "pending")]).stage, "reading");
  assert.equal(view(build("running"), [step("extract", "done"), step("plan", "running")]).stage, "planning");
  assert.equal(
    view(build("running"), [step("extract", "done"), step("plan", "done"), step("module", "running"), step("finalize", "pending")]).stage,
    "writing"
  );
  assert.equal(
    view(build("running"), [step("extract", "done"), step("plan", "done"), step("module", "done"), step("finalize", "running")]).stage,
    "finishing"
  );
  assert.equal(view(build("complete"), []).stage, "done");
});

test("figures: a stage only for builds that look for them, with the count once found", () => {
  const steps = [step("extract", "done"), step("plan", "done"), step("figures", "running"), step("module", "pending")];
  const running = view(build("running"), steps);
  assert.equal(running.stage, "figures");
  assert.deepEqual(running.figures, { done: false, found: 0 });
  const done = buildStatusView({
    build: build("running"),
    steps: [step("plan", "done"), step("figures", "done"), step("module", "running")],
    sources: [],
    materialTitle: null,
    modules: [],
    figuresFound: 4,
    now: NOW,
  });
  assert.equal(done.stage, "writing");
  assert.deepEqual(done.figures, { done: true, found: 4 });
  assert.equal(view(build("running"), [step("plan", "done"), step("module", "running")]).figures, null);
});

test("module progress: writing shows its preview, a retry or backoff says retrying, done drops the preview", () => {
  const preview = { lessons: [{ title: "Hexokinase", content: "Traps glucose" }], quiz: 0 };
  const plan = { title: "Glycolysis", description: "", modules: [1, 2, 3, 4].map((id) => ({ id, title: `M${id}`, lessons: ["a"] })) };
  const v = view(build("running", { plan }), [
    step("plan", "done"),
    step("module", "running", { ordinal: 0, attempts: 1, preview }),
    step("module", "pending", { ordinal: 1, attempts: 1, run_after: "2026-09-27T12:00:30Z" }),
    step("module", "done", { ordinal: 2, attempts: 1, preview }),
    step("module", "pending", { ordinal: 3 }),
  ]);
  assert.deepEqual(
    v.progress.map((p) => [p.id, p.status]),
    [
      [1, "writing"],
      [2, "retrying"],
      [3, "done"],
      [4, "waiting"],
    ]
  );
  assert.deepEqual(v.progress[0].preview, preview);
  assert.equal(v.progress[2].preview, null);
  assert.equal(v.modulesDone, 1);
  assert.equal(v.modulesTotal, 4);
  assert.equal(v.title, "Glycolysis");
});

test("a failed build hides its partial material and shows the saved message", () => {
  const v = buildStatusView({
    build: build("failed", { error_code: "file_unreadable", error_message: "We couldn't read lec.pdf." }),
    steps: [],
    sources: [],
    materialTitle: "Partial",
    modules: [{ id: 1 } as never],
    now: NOW,
  });
  assert.equal(v.materialId, null);
  assert.deepEqual(v.modules, []);
  assert.deepEqual(v.error, { code: "file_unreadable", message: "We couldn't read lec.pdf." });
});
