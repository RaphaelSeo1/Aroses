import assert from "node:assert/strict";
import test from "node:test";
import {
  createMarkerParser,
  findProtocolDirective,
  stripProtocolLines,
  type LiveNotesStreamEvent,
} from "./marker-protocol.ts";

/** Feed `raw` in small chunks (like a real token stream) and collect events. */
function run(
  raw: string,
  opts: { ids?: string[]; chunk?: number } = {}
): { events: LiveNotesStreamEvent[]; text: string; summary: string } {
  const parser = createMarkerParser(new Set(opts.ids ?? ["s1", "s2"]), "new");
  const events: LiveNotesStreamEvent[] = [];
  const size = opts.chunk ?? 3;
  for (let i = 0; i < raw.length; i += size) {
    events.push(...parser.push(raw.slice(i, i + size)));
  }
  events.push(...parser.flush());
  const text = events
    .filter((e): e is { type: "text"; delta: string } => e.type === "text")
    .map((e) => e.delta)
    .join("");
  return { events, text, summary: parser.summaryText() };
}

const LEAKED_SUMMARY =
  "@@summary Microbial Eukaryotes I covers eukaryote classification, protist diversity, Plasmodium life cycle, and sickle cell trait as malaria resistance.";

test("unsupported destructive markers and their bodies are swallowed", () => {
  const { events, text } = run(
    "@@revise s1\n- Safe addition.\n@@rewrite s1\n## Unsafe replacement\n- Must not leak.\n@@remove s2\n@@append\n"
  );
  assert.deepEqual(
    events.filter((event) => event.type === "op"),
    [
      { type: "op", op: "revise", sectionId: "s1" },
      { type: "op", op: "append", sectionId: "new" },
    ]
  );
  assert.match(text, /Safe addition/);
  assert.doesNotMatch(text, /Unsafe replacement|Must not leak/);
});

test("a long inline @@summary line (the Luna leak) never reaches the notes", () => {
  const raw = [
    "@@thought Moving on to malaria and sickle cell.",
    "@@append",
    "## Sickle cell trait and malaria",
    "- **Sickle cell trait** (HbAS) carriers are protected against severe malaria.",
    LEAKED_SUMMARY,
    "",
  ].join("\n");
  for (const chunk of [1, 3, 7, 40, raw.length]) {
    const { text, summary, events } = run(raw, { chunk });
    assert.doesNotMatch(text, /@@|Microbial Eukaryotes I covers/, `chunk ${chunk}`);
    assert.match(text, /Sickle cell trait\*\* \(HbAS\)/);
    assert.match(summary, /^Microbial Eukaryotes I covers eukaryote classification/);
    assert.ok(events.some((e) => e.type === "thought"));
  }
});

test("markers are consumed when indented, bulleted, bolded, or in any casing", () => {
  const variants = [
    "  @@summary Lecture covers protists.",
    "\t@@SUMMARY Lecture covers protists.",
    "- @@summary Lecture covers protists.",
    "  - @@Summary: Lecture covers protists.",
    "* **@@summary** Lecture covers protists.",
    "1. @@summary Lecture covers protists.",
    "> @@summary Lecture covers protists.",
    "`@@summary` Lecture covers protists.",
    "@@ summary Lecture covers protists.",
    "@@summary    Lecture covers protists.   ",
  ];
  for (const leaked of variants) {
    const { text, summary } = run(
      `@@append\n## Protists\n- Protists are mostly unicellular eukaryotes.\n${leaked}\n`
    );
    assert.doesNotMatch(text, /@@|Lecture covers/i, leaked);
    assert.match(text, /Protists are mostly unicellular eukaryotes/, leaked);
    assert.equal(summary, "Lecture covers protists.", leaked);
  }
});

test("a directive after note text keeps the note text and consumes the rest", () => {
  const { text, summary } = run(
    "@@append\n## Plasmodium\n- Transmitted by *Anopheles* mosquitoes. @@summary Covered Plasmodium transmission.\n"
  );
  assert.match(text, /- Transmitted by \*Anopheles\* mosquitoes\.\n/);
  assert.doesNotMatch(text, /@@|Covered Plasmodium/);
  assert.equal(summary, "Covered Plasmodium transmission.");
});

test("mid-section markers switch ops instead of leaking", () => {
  const { events, text } = run(
    [
      "@@revise s1",
      "- Added detail for s1.",
      "   @@Append",
      "## New topic",
      "- New topic detail.",
      "  @@revise [s2]",
      "- Added detail for s2.",
      "@@delete `s1`",
      "- Wrong line.",
      "@@summary",
      "Rolling summary text.",
      "- @@append",
      "- Late appended detail.",
      "",
    ].join("\n")
  );
  assert.deepEqual(
    events.filter((e) => e.type === "op").map((e) => (e as { op: string; sectionId: string })),
    [
      { type: "op", op: "revise", sectionId: "s1" },
      { type: "op", op: "append", sectionId: "new" },
      { type: "op", op: "revise", sectionId: "s2" },
      { type: "op", op: "delete", sectionId: "s1" },
      { type: "op", op: "append", sectionId: "new" },
    ]
  );
  assert.doesNotMatch(text, /@@|Rolling summary text/);
  assert.match(text, /Late appended detail/);
});

test("an unknown revise target swallows its body", () => {
  const { text } = run("@@revise s-unknown\n- Must not leak.\n@@append\n- Kept.\n");
  assert.doesNotMatch(text, /Must not leak/);
  assert.match(text, /Kept/);
});

test("@@append with a same-line heading keeps the heading", () => {
  const { text } = run("@@append ## Apicomplexans\n- Parasitic protists.\n");
  assert.equal(text, "## Apicomplexans\n- Parasitic protists.\n");
});

test("text is forwarded as whole lines only", () => {
  const parser = createMarkerParser(new Set(), "new");
  assert.deepEqual(parser.push("@@append\n- Partial line with no"), [
    { type: "op", op: "append", sectionId: "new" },
  ]);
  assert.deepEqual(parser.push(" newline yet\n"), [
    { type: "text", delta: "- Partial line with no newline yet\n" },
  ]);
});

test("code fences in a body are dropped", () => {
  const { text } = run("@@append\n```markdown\n## Topic\n- Point.\n```\n");
  assert.equal(text, "## Topic\n- Point.\n");
});

test("findProtocolDirective ignores normal note text", () => {
  assert.equal(findProtocolDirective("- Email me at prof@school.edu"), null);
  assert.equal(findProtocolDirective("## Summary of the lecture"), null);
  assert.equal(findProtocolDirective("- **Answer:** True."), null);
});

test("stripProtocolLines removes leaked directives from finished markdown", () => {
  const leaked = [
    "## Eukaryote classification",
    "- Eukaryotes have a nucleus.",
    LEAKED_SUMMARY,
    "  @@summary Microbial Eukaryotes I covers protists.",
    "- Protists are diverse. @@summary Covered protists.",
    "- @@APPEND",
    "- Supergroups organize eukaryotes.",
  ].join("\n");
  assert.equal(
    stripProtocolLines(leaked),
    [
      "## Eukaryote classification",
      "- Eukaryotes have a nucleus.",
      "- Protists are diverse.",
      "- Supergroups organize eukaryotes.",
    ].join("\n")
  );
  assert.equal(stripProtocolLines("- No markers here."), "- No markers here.");
});
