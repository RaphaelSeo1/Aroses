import assert from "node:assert/strict";
import test from "node:test";
import { chunkTypewriterText } from "./typewriter-text";

test("revision text is emitted over multiple bounded typing ticks", () => {
  const text = "A corrected paragraph appears progressively.";
  const chunks = chunkTypewriterText(text, 4);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.every((chunk) => Array.from(chunk).length <= 4));
});

test("typing chunks preserve complete Unicode characters", () => {
  const text = "ATP → energy 🧬";
  const chunks = chunkTypewriterText(text, 1);
  assert.equal(chunks.join(""), text);
  assert.ok(chunks.includes("🧬"));
});
