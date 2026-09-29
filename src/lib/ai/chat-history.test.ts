import { test } from "node:test";
import assert from "node:assert/strict";
import {
  condenseMessage,
  HISTORY_BLOCK,
  HISTORY_KEEP_RECENT,
  HISTORY_MAX_MESSAGES,
  trimChatHistory,
} from "./chat-history.ts";

type Turn = { role: "user" | "assistant"; content: string };

function conversation(n: number, chars = 900): Turn[] {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `message ${i} ${"word ".repeat(Math.ceil(chars / 5))}`.slice(0, chars),
  }));
}

test("conversations up to the cap are passed through untouched", () => {
  for (const n of [0, 1, 2, 12, 20, 33, HISTORY_MAX_MESSAGES]) {
    const msgs = conversation(n);
    assert.equal(trimChatHistory(msgs), msgs, `n=${n}`);
  }
  const tutor = conversation(32);
  assert.equal(trimChatHistory(tutor, { maxMessages: 32 }), tutor);
});

test("past the cap: newest verbatim, older condensed, oldest dropped", () => {
  const msgs = conversation(50);
  const out = trimChatHistory(msgs);
  assert.ok(out.length <= HISTORY_MAX_MESSAGES);
  const firstIndex = 50 - out.length;
  const cut = Math.floor((50 - HISTORY_KEEP_RECENT) / HISTORY_BLOCK) * HISTORY_BLOCK;
  out.forEach((m, i) => {
    const src = msgs[firstIndex + i]!;
    if (firstIndex + i < cut) {
      assert.ok(m.content.endsWith("[…]"), `msg ${firstIndex + i} condensed`);
      assert.ok(m.content.startsWith(`message ${firstIndex + i} `));
      assert.ok(m.content.length < src.content.length);
    } else {
      assert.equal(m.content, src.content, `msg ${firstIndex + i} verbatim`);
    }
  });
  assert.ok(50 - cut >= HISTORY_KEEP_RECENT);
});

test("past the cap the prefix changes only once per block (prompt-cache friendly)", () => {
  const all = conversation(100);
  let changes = 0;
  let prev: Turn[] | null = null;
  for (let n = 41; n <= 99; n += 2) {
    const out = trimChatHistory(all.slice(0, n));
    if (prev && !prev.every((m, i) => out[i]?.content === m.content)) changes++;
    prev = out;
  }
  // 29 turns (2 messages each) after the first trimmed one.
  assert.ok(changes <= Math.ceil((99 - 41) / HISTORY_BLOCK), `changes=${changes}`);
  assert.ok(changes >= 1);
});

test("stays within maxMessages and starts on a user turn", () => {
  for (const max of [32, 40]) {
    for (let n = max + 1; n <= 120; n++) {
      const msgs = conversation(n);
      const out = trimChatHistory(msgs, { maxMessages: max });
      assert.ok(out.length <= max, `n=${n} max=${max} len=${out.length}`);
      assert.ok(out.length >= max - HISTORY_BLOCK, `n=${n} len=${out.length}`);
      assert.equal(out[0]!.role, "user", `n=${n}`);
      assert.deepEqual(out.slice(-HISTORY_KEEP_RECENT), msgs.slice(-HISTORY_KEEP_RECENT));
    }
  }
});

test("short older messages are kept as they are", () => {
  const msgs = conversation(48, 80);
  const out = trimChatHistory(msgs);
  assert.deepEqual(out, msgs.slice(48 - out.length));
});

test("condenseMessage cuts at a word boundary", () => {
  assert.equal(condenseMessage("short", 400), "short");
  const long = "alpha beta gamma delta epsilon zeta eta theta";
  assert.equal(condenseMessage(long, 20), "alpha beta gamma […]");
});
