import assert from "node:assert/strict";
import test from "node:test";
import { pickNoteForFocusLabel } from "./match-focus-note.ts";

const NOTE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COURSE = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SESSION = "33333333-3333-4333-8333-333333333333";

test("matches a unique Lecture 2 note to the live-session course", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: COURSE,
        updatedAt: "2026-09-01T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-01T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.noteId, NOTE_A);
  assert.equal(match?.courseId, COURSE);
  assert.equal(match?.ambiguous, false);
});

test("prefers the note whose course matches the live session when titles collide", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: OTHER,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
      {
        id: NOTE_B,
        title: "Lecture 2",
        courseId: COURSE,
        updatedAt: "2026-09-01T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: null,
        updatedAt: "2026-09-02T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.noteId, NOTE_B);
  assert.equal(match?.ambiguous, false);
});

test("does not merge two distinct notes that share a title and course", () => {
  const match = pickNoteForFocusLabel("Lecture 2", [
    {
      id: NOTE_A,
      title: "Lecture 2",
      courseId: COURSE,
      updatedAt: "2026-09-10T00:00:00Z",
      deleted: false,
    },
    {
      id: NOTE_B,
      title: "Lecture 2",
      courseId: COURSE,
      updatedAt: "2026-09-01T00:00:00Z",
      deleted: false,
    },
  ], []);
  assert.equal(match?.ambiguous, true);
  assert.equal(match?.noteId, "");
});

test("falls back to a live session when no user_note exists yet", () => {
  const match = pickNoteForFocusLabel("Lecture 2", [], [
    {
      id: SESSION,
      title: "Lecture 2",
      courseId: COURSE,
      userNoteId: null,
      updatedAt: "2026-09-02T00:00:00Z",
    },
  ]);
  assert.equal(match?.noteId, "");
  assert.equal(match?.sessionId, SESSION);
  assert.equal(match?.courseId, COURSE);
  assert.equal(match?.ambiguous, false);
});

test("ignores generic Focus questions labels", () => {
  assert.equal(
    pickNoteForFocusLabel("Focus questions", [
      {
        id: NOTE_A,
        title: "Focus questions",
        courseId: COURSE,
        updatedAt: null,
        deleted: false,
      },
    ], []),
    null
  );
});

const SESSION_B = "55555555-5555-4555-8555-555555555555";

test("Lecture 2 in two courses is ambiguous without a preferred course", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
      {
        id: NOTE_B,
        title: "Lecture 2",
        courseId: OTHER,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-10T00:00:00Z",
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.ambiguous, true);
  assert.equal(match?.noteId, "");
});

test("preferred course keeps PBHLTH Lecture 2 off MCB 104", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
      {
        id: NOTE_B,
        title: "Lecture 2",
        courseId: OTHER,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-10T00:00:00Z",
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ],
    OTHER
  );
  assert.equal(match?.ambiguous, false);
  assert.equal(match?.noteId, NOTE_B);
  assert.equal(match?.courseId, OTHER);
});

test("does not stamp a null-course Lecture 2 note onto another course's session", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: null,
        updatedAt: "2026-09-10T00:00:00Z",
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: null,
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.ambiguous, true);
  assert.equal(match?.noteId, "");
});
