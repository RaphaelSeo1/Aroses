import assert from "node:assert/strict";
import test from "node:test";
import {
  REPLY_CPS,
  REPLY_CPS_CATCHUP,
  REPLY_CPS_MID,
  REPLY_TICK_MS,
  pumpTypewriterReply,
  typewriteKnownText,
  typewriterStepChars,
} from "./typewriter-pump";

test("typewriterStepChars stays near one letter at the lecture pace", () => {
  const step = typewriterStepChars(40);
  assert.equal(step, Math.max(1, Math.round((REPLY_CPS * REPLY_TICK_MS) / 1000)));
  assert.ok(step <= 2);
});

test("typewriterStepChars speeds up when the backlog is large", () => {
  const mid = typewriterStepChars(120);
  const catchup = typewriterStepChars(400);
  assert.equal(mid, Math.max(1, Math.round((REPLY_CPS_MID * REPLY_TICK_MS) / 1000)));
  assert.equal(
    catchup,
    Math.max(1, Math.round((REPLY_CPS_CATCHUP * REPLY_TICK_MS) / 1000))
  );
  assert.ok(catchup > mid);
  assert.ok(mid > typewriterStepChars(10));
});

test("pumpTypewriterReply reveals a growing source without dumping it", async () => {
  let source = "Hi";
  let done = false;
  const frames: string[] = [];
  const pump = pumpTypewriterReply({
    getSource: () => source,
    reveal: (v) => frames.push(v),
    isDone: () => done,
  });
  await new Promise((r) => setTimeout(r, 40));
  source = "Hi there";
  done = true;
  await pump;
  assert.ok(frames.length >= 2);
  assert.ok(frames.some((f) => f.length > 0 && f.length < source.length));
  assert.equal(frames.at(-1), source);
});

test("pumpTypewriterReply skipAnimation dumps the current source", async () => {
  const frames: string[] = [];
  await pumpTypewriterReply({
    getSource: () => "Whole reply",
    reveal: (v) => frames.push(v),
    isDone: () => true,
    skipAnimation: () => true,
  });
  assert.deepEqual(frames, ["Whole reply"]);
});

test("typewriteKnownText types then finishes; abort throws", async () => {
  const frames: string[] = [];
  await typewriteKnownText("abcd", (p) => frames.push(p));
  assert.ok(frames[0] !== "abcd" || frames.length === 1);
  assert.equal(frames.at(-1), "abcd");

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => typewriteKnownText("nope", () => {}, { signal: ac.signal }),
    (err: unknown) => err instanceof DOMException && err.name === "AbortError"
  );
});
