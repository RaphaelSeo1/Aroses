import assert from "node:assert/strict";
import test from "node:test";
import {
  createLectureChatParser,
  resolveLectureChatSectionId,
  splitStudentFacingReply,
  visibleReplyForStream,
} from "./lecture-chat-protocol";

const sections = [
  { sectionId: "s-aaa", markdown: "## Scarcity\n- Resources are limited." },
  { sectionId: "s-bbb", markdown: "## Demand\n- Buyers want goods." },
];
const allowed = new Set(sections.map((s) => s.sectionId));

function collect(text: string) {
  const parser = createLectureChatParser(allowed, "s-new", sections);
  return [...parser.push(text), ...parser.flush()];
}

test("resolveLectureChatSectionId matches exact ids and headings", () => {
  assert.equal(
    resolveLectureChatSectionId("s-aaa", allowed, sections),
    "s-aaa"
  );
  assert.equal(
    resolveLectureChatSectionId("s-aaa leftover", allowed, sections),
    "s-aaa"
  );
  assert.equal(
    resolveLectureChatSectionId("scarcity", allowed, sections),
    "s-aaa"
  );
  assert.equal(
    resolveLectureChatSectionId("", allowed, sections),
    "s-bbb"
  );
  assert.equal(
    resolveLectureChatSectionId("", allowed, sections, "s-aaa"),
    "s-aaa"
  );
});

test("revise after reply streams notes body", () => {
  const events = collect(
    [
      "@@reply",
      "Simplified the scarcity section.",
      "@@revise s-aaa",
      "## Scarcity",
      "- Every choice has a trade-off.",
      "",
    ].join("\n")
  );
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-aaa" }]
  );
  const notes = events
    .filter((e) => e.type === "text" && e.channel === "notes")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
  assert.match(notes, /Every choice has a trade-off/);
});

test("revise by heading still lands on a real section", () => {
  const events = collect("@@revise Scarcity\n## Scarcity\n- Trade-offs.\n");
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-aaa" }]
  );
});

test("unknown revise id falls back to the last section", () => {
  const events = collect("@@revise s-zzzz\n## Ghost\n- nope\n");
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-bbb" }]
  );
});

test("unknown revise id prefers the selected section over last", () => {
  const parser = createLectureChatParser(allowed, "s-new", sections, "s-aaa");
  const events = [
    ...parser.push("@@revise s-zzzz\n## Ghost\n- nope\n"),
    ...parser.flush(),
  ];
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-aaa" }]
  );
});

test("revise before reply still streams notes and the student answer", () => {
  const events = collect(
    [
      "@@thought Revising scarcity.",
      "@@revise s-aaa",
      "## Scarcity",
      "- Every choice has a trade-off.",
      "@@reply",
      "Simplified the scarcity wording.",
      "",
    ].join("\n")
  );
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-aaa" }]
  );
  const notes = events
    .filter((e) => e.type === "text" && e.channel === "notes")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
  assert.match(notes, /Every choice has a trade-off/);
  assert.match(replyText(events), /Simplified the scarcity wording/);
});

function replyText(events: ReturnType<typeof collect>): string {
  return events
    .filter((e) => e.type === "text" && e.channel === "reply")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
}

function thoughts(events: ReturnType<typeof collect>): string[] {
  return events
    .filter((e) => e.type === "thought")
    .map((e) => (e.type === "thought" ? e.message : ""));
}

test("preamble prose is thought, not the student reply", () => {
  const events = collect(
    [
      "The student is right—I said I fixed it but I never actually used @@revise.",
      "@@reply",
      "Simplified the scarcity section.",
      "",
    ].join("\n")
  );
  assert.match(thoughts(events).join("\n"), /never actually used/);
  assert.equal(replyText(events).includes("never actually used"), false);
  assert.match(replyText(events), /Simplified the scarcity section/);
});

test("unmarked-only output is thought, not reply", () => {
  const events = collect("I should fix the notes with @@revise s-aaa.\n");
  assert.equal(replyText(events).trim(), "");
  assert.match(thoughts(events).join("\n"), /@@revise/);
});

test("@@thought vs @@reply stay on separate channels", () => {
  const events = collect(
    [
      "@@thought Revising the scarcity section.",
      "@@reply",
      "Simplified the scarcity wording.",
      "@@revise s-aaa",
      "## Scarcity",
      "- Trade-offs.",
      "",
    ].join("\n")
  );
  assert.deepEqual(thoughts(events), ["Revising the scarcity section."]);
  assert.match(replyText(events), /Simplified the scarcity wording/);
  assert.equal(replyText(events).includes("@@"), false);
  assert.deepEqual(
    events.filter((e) => e.type === "op"),
    [{ type: "op", op: "revise", sectionId: "s-aaa" }]
  );
});

test("same-line @@reply body is still the student answer", () => {
  const events = collect("@@reply Simplified the scarcity section.\n");
  assert.match(replyText(events), /Simplified the scarcity section/);
});

test("splitStudentFacingReply strips protocol leaks from the bubble", () => {
  const { visible, leaked } = splitStudentFacingReply(
    [
      "Here is the definition.",
      "I should @@revise s-aaa now.",
      "Resources are limited.",
    ].join("\n")
  );
  assert.match(visible, /Here is the definition/);
  assert.match(visible, /Resources are limited/);
  assert.equal(visible.includes("@@revise"), false);
  assert.equal(leaked.length, 1);
  assert.match(leaked[0]!, /@@revise/);
});

test("visibleReplyForStream holds an incomplete leak line", () => {
  assert.equal(
    visibleReplyForStream("Answer so far.\nI never used @@rev", false),
    "Answer so far."
  );
  assert.equal(
    visibleReplyForStream("Just a normal partial", false),
    "Just a normal partial"
  );
});

test("streaming preamble never hits the reply channel", () => {
  const parser = createLectureChatParser(allowed, "s-new", sections);
  const events = [
    ...parser.push("The student is right—I never used @@revise\n"),
    ...parser.push("@@reply\n"),
    ...parser.push("Simplified scarcity.\n"),
    ...parser.flush(),
  ];
  assert.equal(replyText(events).includes("student is right"), false);
  assert.match(replyText(events), /Simplified scarcity/);
  assert.match(thoughts(events).join("\n"), /never used/);
});
