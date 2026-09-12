import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelInFlightNotesRoseSpeech,
  createAsyncSentenceQueue,
  splitReplyIntoVoiceChunks,
  StreamingSpeechBuffer,
  takeNaturalVoiceChunk,
} from "./notes-rose-speech.ts";

test("takeNaturalVoiceChunk waits for a sentence boundary", () => {
  const mid = takeNaturalVoiceChunk("Scarcity means resources", false);
  assert.equal(mid.chunk, null);
  assert.equal(mid.rest, "Scarcity means resources");

  const done = takeNaturalVoiceChunk(
    "Scarcity means resources are limited. Every choice has a cost. Next we talk trade-offs. ",
    false
  );
  assert.match(done.chunk ?? "", /Scarcity means resources are limited/);
  assert.match(done.rest, /Next we talk/);
});

test("splitReplyIntoVoiceChunks strips markdown and yields spoken sentences", () => {
  const chunks = splitReplyIntoVoiceChunks(
    "## Scarcity\n\n**Scarcity** means resources are limited. Every choice has a cost."
  );
  assert.ok(chunks.length >= 1);
  assert.ok(chunks.join(" ").includes("Scarcity means resources are limited"));
  assert.ok(!chunks.join(" ").includes("**"));
});

test("StreamingSpeechBuffer tracks spoken vs leftover for barge-in", () => {
  const buffer = new StreamingSpeechBuffer();
  const first = buffer.pushDelta("Scarcity means resources are limited. ");
  assert.deepEqual(first, ["Scarcity means resources are limited."]);
  buffer.markSpoken(first[0]!);

  buffer.pushDelta("Every choice has a trade-off that");
  const hint = buffer.interruptHint(true);
  assert.equal(hint.spokenBeforeInterrupt, "Scarcity means resources are limited.");
  assert.match(hint.notYetSpoken, /Every choice has a trade-off/);
  assert.equal(hint.streamIncomplete, true);
});

test("cancelInFlightNotesRoseSpeech drops queued speech and aborts the turn", async () => {
  const queue = createAsyncSentenceQueue();
  const order: string[] = [];
  const turn = new AbortController();

  assert.equal(queue.push("Scarcity means resources are limited."), true);
  assert.equal(queue.push("Every choice has a cost."), true);

  cancelInFlightNotesRoseSpeech({
    queue,
    abortTurn: () => {
      order.push("turn");
      turn.abort();
    },
    cancelSpeak: () => order.push("speak"),
  });

  assert.equal(turn.signal.aborted, true);
  assert.equal(queue.closed, true);
  assert.equal(queue.push("This should not be spoken."), false);
  assert.deepEqual(order, ["turn", "speak"]);

  const leftover: string[] = [];
  for await (const sentence of queue) leftover.push(sentence);
  assert.deepEqual(leftover, []);
});
