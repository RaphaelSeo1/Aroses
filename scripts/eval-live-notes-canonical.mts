import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildCanonicalNotesUserPrompt,
  CANONICAL_NOTES_SYSTEM,
  type CanonicalDraftSection,
  type CanonicalNoteSourceBundle,
} from "../src/lib/live-notes/canonical-synthesis.ts";

const MODEL = "gpt-5.6-sol";
const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) throw new Error("OPENAI_API_KEY is required for the live-notes eval.");

const deck = `[slide 1] Feedback control systems
A feedback system has a sensor, controller, and actuator.
The sensor measures the current temperature.
The controller compares the measurement with the 22 °C setpoint.
The actuator changes heater output.

[slide 2] Disturbances and response
Opening a window is a disturbance that lowers room temperature.
The controller increases heater output in response.
Large delays can cause overshoot around the setpoint.

Copyright 2023 Example Learning Press
DOI: 10.0000/not-instructional
https://publisher.invalid/catalog/88421
Ref. [41], ISBN 000-0-00-000000-0`;

const transcript = `Today we're building a mental model of feedback control. Think about a home thermostat: it is a useful analogy for the whole loop. The temperature sensor only measures; it does not decide what to do. The controller compares that measurement to the target and decides whether heater output should change. The heater is the actuator.

A student asks why the room sometimes gets too warm after the heat turns on. The lecturer explains that a delayed response can keep the heater running after enough energy is already on the way, producing overshoot. Opening a window is our disturbance example because it pushes the room away from the target. The loop responds by increasing heater output.

The lecturer says explicitly: remember the distinction between measurement, decision, and action.`;

const noisyDraft: CanonicalDraftSection[] = [
  {
    sectionId: "old-1",
    markdown:
      "## Feedback Control\n- A sensor measures temperature.\n- The sensor predicts the weather and decides heater output.",
  },
  {
    sectionId: "old-2",
    markdown:
      "## Thermostat Feedback Loop\n- A thermostat uses feedback.\n- Sensors measure temperature.",
  },
  {
    sectionId: "old-3",
    markdown:
      "## Publication Details\n- Copyright 2023 Example Learning Press.\n- DOI: 10.0000/not-instructional.",
  },
];

async function generate(input: {
  sources: CanonicalNoteSourceBundle;
  existingSections?: CanonicalDraftSection[];
}): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning_effort: "none",
      max_completion_tokens: 8_000,
      messages: [
        { role: "system", content: CANONICAL_NOTES_SYSTEM },
        {
          role: "user",
          content: buildCanonicalNotesUserPrompt({
            title: "Feedback control",
            ...input,
          }),
        },
      ],
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${raw.slice(0, 300)}`);
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const output = parsed.choices?.[0]?.message?.content?.trim();
  if (!output) throw new Error("Model returned empty notes.");
  return output;
}

function sectionBodies(markdown: string): string[] {
  return markdown
    .split(/^##\s+/m)
    .slice(1)
    .map((section) => section.toLowerCase());
}

function tokens(raw: string): Set<string> {
  return new Set(
    raw
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
  );
}

function jaccard(a: string, b: string): number {
  const left = tokens(a);
  const right = tokens(b);
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

function assertNoSectionDuplicates(markdown: string): void {
  const sections = sectionBodies(markdown);
  for (let i = 0; i < sections.length; i++) {
    for (let j = i + 1; j < sections.length; j++) {
      assert.ok(
        jaccard(sections[i]!, sections[j]!) < 0.58,
        `sections ${i + 1} and ${j + 1} substantially duplicate each other`
      );
    }
  }
}

function assertContains(output: string, terms: string[]): void {
  const lower = output.toLowerCase();
  for (const term of terms) {
    assert.match(lower, new RegExp(term));
  }
}

function assertClean(output: string): void {
  assert.doesNotMatch(
    output.toLowerCase(),
    /copyright|doi:|isbn|publisher\.invalid|predicts the weather/
  );
  assertNoSectionDuplicates(output);
}

const filesOnly = await generate({ sources: { deck } });
const transcriptOnly = await generate({ sources: { transcript } });
const together = await generate({ sources: { deck, transcript } });
const transcriptAddedLater = await generate({
  sources: { deck, transcript },
  existingSections: noisyDraft,
});
const deckAddedLater = await generate({
  sources: { transcript, deck },
  existingSections: [
    {
      sectionId: "spoken-1",
      markdown:
        "## Thermostat analogy\n- A thermostat shows how a feedback loop responds.",
    },
  ],
});

assertContains(filesOnly, ["sensor", "controller", "actuator", "22", "overshoot"]);
assertContains(transcriptOnly, [
  "sensor",
  "controller",
  "actuator",
  "thermostat",
  "overshoot",
]);
for (const output of [together, transcriptAddedLater, deckAddedLater]) {
  assertContains(output, [
    "sensor",
    "controller",
    "actuator",
    "22",
    "thermostat",
    "overshoot",
    "window",
  ]);
}
for (const output of [
  filesOnly,
  transcriptOnly,
  together,
  transcriptAddedLater,
  deckAddedLater,
]) {
  assertClean(output);
}

const combinedTerms = [
  "sensor",
  "controller",
  "actuator",
  "22",
  "thermostat",
  "overshoot",
  "window",
];
const coverage = (output: string) =>
  combinedTerms.filter((term) => output.toLowerCase().includes(term)).sort();
assert.deepEqual(coverage(transcriptAddedLater), coverage(deckAddedLater));
assert.deepEqual(coverage(together), coverage(transcriptAddedLater));

const outputDir = path.join("/tmp", "aroses-live-notes-eval");
await mkdir(outputDir, { recursive: true });
const scenarios = {
  "01-files-only.md": filesOnly,
  "02-transcript-only.md": transcriptOnly,
  "03-sources-together.md": together,
  "04-transcript-added-later.md": transcriptAddedLater,
  "05-deck-added-later.md": deckAddedLater,
};
for (const [name, output] of Object.entries(scenarios)) {
  await writeFile(path.join(outputDir, name), `${output}\n`, "utf8");
}
console.log(
  JSON.stringify(
    {
      model: MODEL,
      scenarios: Object.keys(scenarios),
      outputDir,
      checks: {
        requiredCoverage: "passed",
        incidentalNoise: "passed",
        unsupportedDraftClaim: "passed",
        duplicateSections: "passed",
        sourceOrderCoverage: "passed",
      },
    },
    null,
    2
  )
);
