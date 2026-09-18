import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarkerParser } from "./marker-protocol";

function run(chunks: string[], allowed: string[] = []) {
  const parser = createMarkerParser(new Set(allowed), "s-new");
  const events = chunks.flatMap((c) => parser.push(c));
  events.push(...parser.flush());
  return events;
}

function bodyOf(events: ReturnType<typeof run>): string {
  return events
    .filter((e) => e.type === "text")
    .map((e) => (e.type === "text" ? e.delta : ""))
    .join("");
}

test("notes written without any @@ marker are recovered as an @@append instead of vanishing", () => {
  const events = run([
    "## Meiotic Cohesin\n\nMeiotic cells express ",
    "**Rec8** in place of Scc1.\n- Shugoshin recruits **PP2A** near centromeres.\n- Arm cohesion is cleaved in meiosis I.\n",
  ]);
  const ops = events.filter((e) => e.type === "op");
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0], { type: "op", op: "append", sectionId: "s-new" });
  const body = bodyOf(events);
  assert.match(body, /## Meiotic Cohesin/);
  assert.match(body, /Shugoshin recruits \*\*PP2A\*\*/);
  assert.match(body, /Arm cohesion is cleaved/);
});

test("preamble chatter before a real marker is still dropped (no double-append)", () => {
  const events = run([
    "Here are the notes for this slice.\n@@append\n## Enzymes\n- Lower activation energy.\n@@summary\nEnzymes covered.\n",
  ]);
  const ops = events.filter((e) => e.type === "op");
  assert.equal(ops.length, 1);
  const body = bodyOf(events);
  assert.doesNotMatch(body, /Here are the notes/);
  assert.match(body, /Lower activation energy/);
});

test("a bare sentence with no heading or bullets is not mistaken for notes", () => {
  const events = run(["Nothing new in this slice.\n"]);
  assert.equal(events.length, 0);
});

test("two @@append blocks in one response emit two append ops (client must flush the first)", () => {
  const events = run([
    "@@append\n## Topic A\n- fact a\n@@append\n## Topic B\n- fact b\n@@summary\nA and B.\n",
  ]);
  const ops = events.filter((e) => e.type === "op");
  assert.equal(ops.length, 2);
  assert.ok(ops.every((o) => o.type === "op" && o.op === "append"));
  assert.match(bodyOf(events), /fact a[\s\S]*fact b/);
});

test("@@revise to an unknown id is swallowed and does not trigger recovery", () => {
  const events = run(
    ["@@revise s-nope\n## Ghost\n- should be dropped\n@@summary\nx\n"],
    ["s-real"]
  );
  assert.equal(events.filter((e) => e.type === "op").length, 0);
  assert.equal(bodyOf(events), "");
});
