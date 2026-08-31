import assert from "node:assert/strict";
import test from "node:test";
import { parseChatAttachments } from "./chat-attachment-parse";

test("parseChatAttachments keeps legacy attachedPdfText", () => {
  const parsed = parseChatAttachments({
    attachedPdfText: "Syllabus week 1 exam on Monday.",
    attachedPdfName: "chem.pdf",
  });
  assert.equal(parsed.name, "chem.pdf");
  assert.match(parsed.text, /chem\.pdf/);
  assert.match(parsed.text, /Syllabus week 1/);
});

test("parseChatAttachments prefers attachedFiles array", () => {
  const parsed = parseChatAttachments({
    attachedPdfText: "old pdf only",
    attachedPdfName: "old.pdf",
    attachedFiles: [
      { name: "notes.docx", text: "Word notes about the midterm on Friday." },
      { name: "shot.png", text: "Whiteboard: SN2 backside attack diagram." },
    ],
  });
  assert.match(parsed.name, /notes\.docx/);
  assert.match(parsed.name, /shot\.png/);
  assert.doesNotMatch(parsed.text, /old pdf only/);
  assert.match(parsed.text, /midterm/);
});
