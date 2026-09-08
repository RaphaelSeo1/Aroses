import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNotesChatHistory,
  NotesChatInterruptionCoordinator,
} from "./chat-interruption.ts";

test("replacement send aborts and waits before starting", async () => {
  const coordinator = new NotesChatInterruptionCoordinator();
  const first = await coordinator.beginSend();
  assert.ok(first);

  const order: string[] = [];
  first.signal.addEventListener("abort", () => order.push("abort"));
  const replacement = coordinator.beginSend(() => order.push("interrupt"));
  await Promise.resolve();
  order.push("before-finalizer");
  assert.deepEqual(order, ["interrupt", "abort", "before-finalizer"]);

  first.finish();
  const second = await replacement;
  assert.ok(second);
  order.push("replacement-started");
  assert.deepEqual(order, [
    "interrupt",
    "abort",
    "before-finalizer",
    "replacement-started",
  ]);
  second.finish();
});

test("an interrupted lease suppresses stale chunks and finalizers", async () => {
  const coordinator = new NotesChatInterruptionCoordinator();
  const first = await coordinator.beginSend();
  assert.ok(first);
  assert.equal(first.isCurrent(), true);

  const replacement = coordinator.beginSend();
  await Promise.resolve();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);

  first.finish();
  const second = await replacement;
  assert.ok(second);
  assert.equal(second.isCurrent(), true);
  second.finish();
});

test("interrupted partial reply remains in clarification context", () => {
  const history = buildNotesChatHistory([
    { role: "user", content: "Explain scarcity" },
    {
      role: "assistant",
      content: "Scarcity means resources are",
      interrupted: true,
    },
  ]);
  assert.deepEqual(history, [
    { role: "user", content: "Explain scarcity" },
    {
      role: "assistant",
      content:
        "[Response interrupted by the student]\nScarcity means resources are",
    },
  ]);
});

test("rapid duplicate sends are rejected during the handoff", async () => {
  const coordinator = new NotesChatInterruptionCoordinator();
  const first = await coordinator.beginSend();
  assert.ok(first);

  const replacement = coordinator.beginSend();
  const duplicate = await coordinator.beginSend();
  assert.equal(duplicate, null);

  first.finish();
  const second = await replacement;
  assert.ok(second);
  second.finish();
});
