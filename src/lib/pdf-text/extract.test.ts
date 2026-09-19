import assert from "node:assert/strict";
import test from "node:test";
import { pdfItemsToText } from "./extract";

test("pdfItemsToText spaces words and keeps slide bullets on their own lines", () => {
  const text = pdfItemsToText([
    { str: "Viral", transform: [1, 0, 0, 1, 40, 700], width: 40 },
    { str: "structure", transform: [1, 0, 0, 1, 88, 700], width: 70 },
    { str: "Capsid", transform: [1, 0, 0, 1, 40, 680], width: 50 },
    { str: "protects", transform: [1, 0, 0, 1, 98, 680], width: 60 },
    { str: "the", transform: [1, 0, 0, 1, 166, 680], width: 20 },
    { str: "genome", transform: [1, 0, 0, 1, 194, 680], width: 55 },
  ]);
  assert.equal(text, "Viral structure\nCapsid protects the genome");
});

test("pdfItemsToText does not smash items together when hasEOL is missing", () => {
  const smashed = ["Viral", "structure", "Capsid"].join("");
  const text = pdfItemsToText([
    { str: "Viral", transform: [1, 0, 0, 1, 10, 100], width: 30 },
    { str: "structure", transform: [1, 0, 0, 1, 48, 100], width: 60 },
    { str: "Capsid", transform: [1, 0, 0, 1, 10, 80], width: 40 },
  ]);
  assert.doesNotMatch(text, new RegExp(smashed));
  assert.match(text, /Viral structure/);
  assert.match(text, /Capsid/);
});
