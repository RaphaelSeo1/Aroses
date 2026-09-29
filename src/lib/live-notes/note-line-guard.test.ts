import assert from "node:assert/strict";
import test from "node:test";
import { createMarkerParser } from "./marker-protocol.ts";
import {
  createNoteLineGuard,
  isNearDuplicateNoteLine,
  noteLineFingerprint,
} from "./note-line-guard.ts";

const EXISTING = [
  [
    "## Sickle cell trait and malaria",
    "- **Sickle cell trait** carriers (HbAS) are protected against severe malaria caused by *Plasmodium falciparum*.",
    "- The dose is 30 mg per kg.",
  ].join("\n"),
];

function stream(raw: string, existing = EXISTING, ids = ["s1"]): string {
  const parser = createMarkerParser(new Set(ids), "new");
  const guard = createNoteLineGuard(existing);
  let text = "";
  const take = (events: ReturnType<typeof parser.push>) => {
    for (const e of guard.push(events)) if (e.type === "text") text += e.delta;
  };
  for (let i = 0; i < raw.length; i += 5) take(parser.push(raw.slice(i, i + 5)));
  take(parser.flush());
  guard.flush();
  return text;
}

test("a reworded restatement of an existing fact is dropped", () => {
  const prior = EXISTING.flatMap((md) => md.split("\n").map(noteLineFingerprint));
  assert.equal(
    isNearDuplicateNoteLine(
      "- People with **sickle cell trait** (HbAS) are protected against severe *Plasmodium falciparum* malaria.",
      prior
    ),
    true
  );
});

test("a line with a new number or new detail survives", () => {
  const prior = EXISTING.flatMap((md) => md.split("\n").map(noteLineFingerprint));
  assert.equal(isNearDuplicateNoteLine("- The dose is 3 mg per kg.", prior), false);
  assert.equal(
    isNearDuplicateNoteLine(
      "- Sickle cell trait carriers still get infected, but parasitized red cells sickle and are cleared by the spleen.",
      prior
    ),
    false
  );
  assert.equal(
    isNearDuplicateNoteLine("- **Open question:** Notes had sickle cell trait protects against severe malaria; just said it protects against all malaria. Which is right?", prior),
    false
  );
});

test("an appended section that only restates existing notes lands empty (no orphan heading)", () => {
  const out = stream(
    [
      "@@append",
      "## Malaria resistance",
      "- Carriers of the **sickle cell trait** (HbAS) are protected from severe malaria caused by *Plasmodium falciparum*.",
      "@@summary",
      "Covered malaria.",
    ].join("\n")
  );
  assert.equal(out, "");
});

test("new material in the same append keeps its heading and drops only the repeat", () => {
  const out = stream(
    [
      "@@append",
      "## Plasmodium life cycle",
      "- Sickle cell trait (HbAS) carriers are protected against severe malaria caused by Plasmodium falciparum.",
      "- **Sporozoites** enter the blood through an *Anopheles* mosquito bite.",
      "- Sporozoites first infect liver cells before red blood cells.",
      "",
    ].join("\n")
  );
  assert.equal(
    out,
    [
      "## Plasmodium life cycle",
      "- **Sporozoites** enter the blood through an *Anopheles* mosquito bite.",
      "- Sporozoites first infect liver cells before red blood cells.",
      "",
    ].join("\n")
  );
});

test("repeats within the same call are dropped too", () => {
  const out = stream(
    [
      "@@append",
      "## Diatoms",
      "- Diatoms build silica cell walls called frustules.",
      "- Diatoms construct cell walls of silica, called frustules.",
      "",
    ].join("\n")
  );
  assert.equal(out, "## Diatoms\n- Diatoms build silica cell walls called frustules.\n");
});

test("a dropped parent is restored when a nested child adds new detail", () => {
  const out = stream(
    [
      "@@append",
      "## Hemoglobin variants",
      "- Sickle cell trait carriers (HbAS) are protected against severe Plasmodium falciparum malaria.",
      "  - Homozygous HbSS individuals develop sickle cell disease instead.",
      "",
    ].join("\n")
  );
  assert.match(out, /^## Hemoglobin variants\n- Sickle cell trait carriers/);
  assert.match(out, /  - Homozygous HbSS/);
});

test("revise corrections survive; delete bodies are never filtered", () => {
  const out = stream(
    [
      "@@revise s1",
      "- Sickle cell trait carriers (HbAS) are protected against severe malaria caused by Plasmodium vivax.",
      "- Carriers of sickle cell trait (HbAS) are protected against severe malaria caused by Plasmodium falciparum.",
      "@@delete s1",
      "- The dose is 30 mg per kg.",
      "",
    ].join("\n")
  );
  assert.equal(
    out,
    [
      "- Sickle cell trait carriers (HbAS) are protected against severe malaria caused by Plasmodium vivax.",
      "- The dose is 30 mg per kg.",
      "",
    ].join("\n")
  );
});

test("tables and short lines are never dropped", () => {
  const out = stream(
    [
      "@@append",
      "## Comparison",
      "| Trait | Genotype |",
      "| --- | --- |",
      "| Sickle cell trait | HbAS |",
      "- **Key point:**",
      "",
    ].join("\n")
  );
  assert.match(out, /\| Sickle cell trait \| HbAS \|/);
  assert.match(out, /- \*\*Key point:\*\*/);
});
