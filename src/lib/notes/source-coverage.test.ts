import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { classifyAppendChunks } from "@/lib/live-notes/fold-note-markdown";
import { consolidateNoteDocument } from "./consolidate-notes";
import {
  findUnrepresentedContiguousRanges,
  findUnrepresentedDeckPages,
  findUnrepresentedSourceUnits,
  restoreUnrepresentedSourceUnits,
  type SourceUnit,
} from "./source-coverage";
import { UNIFIED_NOTES_RULES } from "@/lib/ai/tutor-notes-quality";

function units(rows: Array<[string, string, string]>): SourceUnit[] {
  return rows.map(([id, label, text], i) => ({
    id,
    label,
    text,
    order: i,
    sourceId: id.includes(":") ? id.split(":")[0] : "a",
  }));
}

test("generic source units: PDF pages and transcript segments use the same coverage API", () => {
  const source = units([
    ["p1", "Intro", "Welcome and today's agenda only."],
    [
      "p2",
      "Kappa relay",
      "Kappa relay coordinates the hand-off between the input stage and the processing stage and binds the granite signal.",
    ],
    [
      "seg-3",
      "Omega ledger",
      "The omega ledger records every committed hand-off with a monotonic sequence number, a checksum, and the originating window identifier for later audit.",
    ],
  ]);
  const notes =
    "## Kappa relay\n- **Kappa relay:** Coordinates the hand-off between the input stage and the processing stage.\n- Binds the granite signal.";
  const missing = findUnrepresentedSourceUnits(source, notes);
  assert.deepEqual(
    missing.map((m) => m.id),
    ["seg-3"]
  );
  assert.deepEqual(findUnrepresentedDeckPages(
    [
      { pageNum: 1, title: "Intro", extractedText: "Welcome and today's agenda only." },
      {
        pageNum: 2,
        title: "Kappa relay",
        extractedText:
          "Kappa relay coordinates the hand-off between the input stage and the processing stage and binds the granite signal.",
      },
    ],
    notes
  ).map((p) => p.pageNum), []);
});

test("contiguous skipped ranges are grouped", () => {
  const missing = findUnrepresentedSourceUnits(
    units([
      [
        "1",
        "Alpha process",
        "Alpha process starts the workflow and validates every inbound request with a checksum before the next stage runs.",
      ],
      [
        "2",
        "Quartz sampler",
        "Quartz sampler captures the inbound waveform at 48 kilohertz and stores a 12-bit envelope for the falcon comparator sitting beside the cedar rack.",
      ],
      [
        "3",
        "Orchid latch",
        "Orchid latch holds the sampled envelope until the cedar decoder acknowledges the packet with a nonce painted on the marble overlay.",
      ],
      [
        "4",
        "Timber overlay",
        "Timber overlay paints the nonce onto the marble display so the operator can confirm the handshake visually before the willow interlock opens.",
      ],
    ]),
    "## Alpha process\n- **Alpha process:** Starts the workflow and validates every inbound request with a checksum before the next stage runs."
  );
  assert.deepEqual(
    missing.map((m) => m.id),
    ["2", "3", "4"]
  );
  const ranges = findUnrepresentedContiguousRanges(missing);
  assert.equal(ranges.length, 1);
  assert.deepEqual(ranges[0]!.ids, ["2", "3", "4"]);
});

test("restore copies unique source lines, never invents, and fills a skipped range", () => {
  const source = units([
    [
      "1",
      "Kappa relay",
      "Kappa relay coordinates the hand-off.\nBinds the granite signal before the hand-off completes.",
    ],
    [
      "2",
      "Omega ledger",
      "The omega ledger records every committed hand-off with a monotonic sequence number.\nIt stores a checksum and the originating window identifier for later audit.",
    ],
  ]);
  const notes =
    "## Kappa relay\n- Kappa relay coordinates the hand-off.\n- Binds the granite signal before the hand-off completes.";
  const { missing, sections } = restoreUnrepresentedSourceUnits(source, notes);
  assert.ok(missing.some((m) => m.id === "2"));
  assert.equal(sections.length, 1);
  assert.match(sections[0]!.markdown, /omega ledger/i);
  assert.match(sections[0]!.markdown, /checksum/);
  assert.doesNotMatch(sections[0]!.markdown, /textbook|generally speaking|in other words the/i);
  const after = `${notes}\n${sections[0]!.markdown}`;
  assert.deepEqual(findUnrepresentedSourceUnits(source, after).map((m) => m.id), []);
});

test("multi-upload: unique facts from a second file are restored, shared concepts are not duplicated", () => {
  const source: SourceUnit[] = [
    {
      id: "fileA:1",
      sourceId: "fileA",
      order: 0,
      label: "Kappa",
      text: "Kappa relay coordinates the hand-off between input and processing and binds the granite signal.",
    },
    {
      id: "fileB:1",
      sourceId: "fileB",
      order: 1,
      label: "Kappa extra",
      text: "Kappa relay coordinates the hand-off between input and processing and binds the granite signal. Weekend runs skip the kappa relay entirely.",
    },
  ];
  const notes =
    "## Kappa relay\n- Kappa relay coordinates the hand-off between input and processing and binds the granite signal.";
  const { sections } = restoreUnrepresentedSourceUnits(source, notes, {
    minUnitTokens: 8,
    minOverlap: 0.55,
  });
  const restored = sections.map((s) => s.markdown).join("\n");
  // Shared definition is already in notes; the weekend exception must appear.
  const combined = `${notes}\n${restored}`;
  assert.match(combined, /Weekend runs skip the kappa relay/);
  assert.equal(
    combined.split("binds the granite signal").length - 1,
    1,
    "shared definition should not be copied again when restore sees it as covered"
  );
});

test("density A: short dense source keeps every unique fact through consolidation", () => {
  const dense = [
    {
      sectionId: "s1",
      markdown: [
        "## Kappa relay",
        "- **Kappa relay:** Coordinates the hand-off.",
        "- **Mechanism:** Binds the granite signal.",
        "- Times out after 40 ms.",
        "- **Exception:** Bypassed for velvet inputs.",
        "- **Evidence:** The harbor study measured a 12% drop.",
      ].join("\n"),
    },
  ];
  const res = consolidateNoteDocument(dense);
  const text = res.sections.map((s) => s.markdown).join("\n");
  for (const keep of ["granite signal", "40 ms", "velvet", "harbor study", "12%"]) {
    assert.ok(text.includes(keep), `lost dense fact: ${keep}`);
  }
});

test("density B: long repetitive source collapses restated definitions without losing the unique line", () => {
  const sections = Array.from({ length: 12 }, (_, i) => ({
    sectionId: `s${i}`,
    markdown: [
      `## Kappa relay ${i === 0 ? "" : "(continued)"}`.trim(),
      "- **Kappa relay:** Coordinates the hand-off between the input stage and the processing stage.",
      i === 7 ? "- **Exception:** The kappa relay is bypassed for willow inputs." : "",
    ]
      .filter(Boolean)
      .join("\n"),
  }));
  const res = consolidateNoteDocument(sections);
  const text = res.sections.map((s) => s.markdown).join("\n");
  const defs = text.split("Coordinates the hand-off between the input stage").length - 1;
  assert.ok(defs <= 2, `definitions not collapsed: ${defs}`);
  assert.match(text, /willow inputs/);
});

test("density D: sparse long source (agenda pages) does not invent content", () => {
  const source = units(
    Array.from({ length: 10 }, (_, i) => [
      String(i + 1),
      i === 4 ? "Kappa relay" : "Agenda",
      i === 4
        ? "Kappa relay coordinates the hand-off between the input stage and the processing stage."
        : "Today we will cover introductions, logistics, and questions from last time.",
    ])
  );
  const notes =
    "## Kappa relay\n- **Kappa relay:** Coordinates the hand-off between the input stage and the processing stage.";
  const missing = findUnrepresentedSourceUnits(source, notes);
  assert.equal(missing.length, 0, "agenda pages are non-substantive or represented");
  const { sections } = restoreUnrepresentedSourceUnits(source, notes);
  assert.equal(sections.length, 0);
});

test("recap-titled source with a unique number keeps that fact (fold or new), never drops it", () => {
  const existing = [
    {
      sectionId: "s-a",
      markdown:
        "## Topic A\n- **Alpha process:** Starts the workflow and validates the input.",
    },
  ];
  const actions = classifyAppendChunks(
    [
      "## Key concepts review",
      "- **Alpha process:** Starts the workflow and validates the input.",
      "- The alpha process times out after 40 ms unless the granite flag is set.",
    ].join("\n"),
    existing
  );
  const text = actions.map((a) => a.markdown).join("\n");
  assert.match(text, /40 ms/);
  assert.match(text, /granite flag/);
});

test("prompt: note length is not a slide/page ratio; no 2–6 bullet cap", () => {
  assert.match(UNIFIED_NOTES_RULES, /never by slide\/page\/word count/);
  assert.match(UNIFIED_NOTES_RULES, /source unit/i);
  const outline = readFileSync(
    path.join(process.cwd(), "src/lib/ai/tutor-notes-quality.ts"),
    "utf8"
  );
  assert.doesNotMatch(outline, /2–6 top-level bullets/);
});
