import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureInlineYourNotesLink,
  replyCitesStudentNotes,
} from "./review-chat-notes-link";

const LINK = "/notes/doc/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

test("replyCitesStudentNotes detects common citation phrasing", () => {
  assert.equal(replyCitesStudentNotes("Your notes say: mitochondria make ATP."), true);
  assert.equal(replyCitesStudentNotes("In your notes you wrote that osmosis is…"), true);
  assert.equal(
    replyCitesStudentNotes("See [your notes](/notes/doc/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee)"),
    true
  );
  assert.equal(
    replyCitesStudentNotes("Not covered in this lecture, but here’s the idea…"),
    false
  );
  assert.equal(replyCitesStudentNotes("The correct choice is B because…"), false);
});

test("ensureInlineYourNotesLink wraps bare your notes when citing", () => {
  const out = ensureInlineYourNotesLink(
    "As explained in your notes, water moves toward higher solute.",
    LINK,
    true
  );
  assert.equal(
    out,
    `As explained in [your notes](${LINK}), water moves toward higher solute.`
  );
});

test("ensureInlineYourNotesLink skips when notes were not in context", () => {
  assert.equal(
    ensureInlineYourNotesLink(
      "As explained in your notes, water moves.",
      LINK,
      false
    ),
    "As explained in your notes, water moves."
  );
});

test("ensureInlineYourNotesLink skips when reply does not cite notes", () => {
  assert.equal(
    ensureInlineYourNotesLink(
      "Choice B is right because the gradient drives flux.",
      LINK,
      true
    ),
    "Choice B is right because the gradient drives flux."
  );
});

test("ensureInlineYourNotesLink normalizes Open your notes labels", () => {
  const out = ensureInlineYourNotesLink(
    `Quote from notes.\n\n[Open your notes](${LINK})`,
    LINK,
    true
  );
  assert.equal(out, `Quote from notes.\n\n[your notes](${LINK})`);
});

test("ensureInlineYourNotesLink skips lecture disclaimers", () => {
  const reply =
    "Not covered in detail in this lecture, but osmosis still matters.";
  assert.equal(ensureInlineYourNotesLink(reply, LINK, true), reply);
  assert.equal(replyCitesStudentNotes(reply), false);
});

test("ensureInlineYourNotesLink skips not-in-your-notes disclaimers", () => {
  const reply = "Not in your notes, but the short version is…";
  assert.equal(replyCitesStudentNotes(reply), false);
  assert.equal(ensureInlineYourNotesLink(reply, LINK, true), reply);
});

test("ensureInlineYourNotesLink rejects non-notes URLs", () => {
  assert.equal(
    ensureInlineYourNotesLink(
      "As explained in your notes, hi.",
      "https://evil.example/notes",
      true
    ),
    "As explained in your notes, hi."
  );
});
