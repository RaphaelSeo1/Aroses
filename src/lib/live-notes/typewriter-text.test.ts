import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseTypewriterSchedule,
  chunkTypewriterText,
} from "./typewriter-text";

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

test("chooseTypewriterSchedule animates while the tab is visible", () => {
  const schedule = chooseTypewriterSchedule({
    visibleTickMs: 30,
    visibleCharsPerTick: 3,
    pendingChars: 120,
    hidden: false,
  });
  assert.equal(schedule.tickMs, 30);
  assert.equal(schedule.charsPerTick, 3);
});

test("chooseTypewriterSchedule flushes immediately when the tab is hidden", () => {
  const schedule = chooseTypewriterSchedule({
    visibleTickMs: 30,
    visibleCharsPerTick: 3,
    pendingChars: 120,
    hidden: true,
  });
  assert.equal(schedule.tickMs, 0);
  assert.equal(schedule.charsPerTick, 120);
});
