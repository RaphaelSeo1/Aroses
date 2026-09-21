import assert from "node:assert/strict";
import test from "node:test";
import {
  contentOverlapScore,
  pickLiveSessionForFocusCard,
  pickNoteForFocusLabel,
  pickSectionNoteForStoredLabel,
  resolveFocusCardNoteId,
} from "./match-focus-note.ts";
import { repairOrphanNotesFocusCards } from "./repair-orphan-focus-cards.ts";

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

test("live-session course wins over a wrongly stamped note.course_id", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 2",
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        // Stale stamp from title-match onto MCB while the live session is PBHLTH.
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.ambiguous, false);
  assert.equal(match?.noteId, NOTE_A);
  assert.equal(match?.courseId, OTHER);
});

const MCB_NOTES =
  "Nuclear pores and nucleoporins transport macromolecules through nuclei. Chromosome telomeres and centromeres organize mitotic spindle attachment.";
const PBHLTH_NOTES =
  "Bacteria are everywhere. Lateral gene transfer and 16S rRNA gene sequences identify bacterial samples. Frameshift mutation and ribosomal subunit 30S.";

test("content overlap prefers the live-notes corpus that shares card tokens", () => {
  const bacteriaCard =
    "What does similarity in 16S rRNA gene sequences indicate about bacterial samples and lateral gene transfer?";
  assert.ok(
    contentOverlapScore(bacteriaCard, PBHLTH_NOTES) >
      contentOverlapScore(bacteriaCard, MCB_NOTES)
  );
});

test("rehomes Lecture 2 bacteria cards onto PBHLTH even when already linked to MCB note", () => {
  const match = pickLiveSessionForFocusCard(
    "Lecture 2",
    "What does >97% similarity in 16S rRNA gene sequences indicate about two bacterial samples and lateral gene transfer?",
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-15T00:00:00Z",
        notesText: MCB_NOTES,
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-14T00:00:00Z",
        notesText: PBHLTH_NOTES,
      },
    ],
    { currentNoteId: NOTE_A }
  );
  assert.equal(match?.sessionId, SESSION_B);
  assert.equal(match?.noteId, NOTE_B);
  assert.equal(match?.courseId, OTHER);
});

test("keeps correctly linked MCB Lecture 2 cards on the MCB live session", () => {
  const match = pickLiveSessionForFocusCard(
    "Lecture 2",
    "How do nuclear pores and nucleoporins transport macromolecules through chromosome telomeres?",
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-15T00:00:00Z",
        notesText: MCB_NOTES,
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-14T00:00:00Z",
        notesText: PBHLTH_NOTES,
      },
    ],
    { currentNoteId: NOTE_A }
  );
  assert.equal(match?.sessionId, SESSION);
  assert.equal(match?.noteId, NOTE_A);
  assert.equal(match?.courseId, COURSE);
});

test("unique Lecture 4 label maps to that live session even with empty card text", () => {
  const match = pickLiveSessionForFocusCard(
    "Lecture 4",
    "",
    [
      {
        id: SESSION,
        title: "Lecture 4",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-15T00:00:00Z",
        notesText: "Meiosis recombination and crossing over.",
      },
      {
        id: SESSION_B,
        title: "Lecture 5",
        courseId: COURSE,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-16T00:00:00Z",
        notesText: "Mendelian inheritance ratios.",
      },
    ]
  );
  assert.equal(match?.sessionId, SESSION);
  assert.equal(match?.noteId, NOTE_A);
  assert.equal(match?.courseId, COURSE);
});

test("preferredCourseId picks the matching course when Lecture titles collide", () => {
  const match = pickLiveSessionForFocusCard(
    "Lecture 2",
    "generic question without distinctive tokens",
    [
      {
        id: SESSION,
        title: "Lecture 2",
        courseId: COURSE,
        userNoteId: NOTE_A,
        updatedAt: "2026-09-15T00:00:00Z",
        notesText: MCB_NOTES,
      },
      {
        id: SESSION_B,
        title: "Lecture 2",
        courseId: OTHER,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-14T00:00:00Z",
        notesText: PBHLTH_NOTES,
      },
    ],
    { preferredCourseId: OTHER }
  );
  assert.equal(match?.sessionId, SESSION_B);
  assert.equal(match?.courseId, OTHER);
});

const SECTION = "55555555-5555-4555-8555-555555555555";

test("does not pick a course live session over a notes-hub folder with the same title", () => {
  const match = pickNoteForFocusLabel(
    "Lecture 4",
    [
      {
        id: NOTE_A,
        title: "Lecture 4",
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
    ],
    [
      {
        id: SESSION,
        title: "Lecture 4",
        courseId: COURSE,
        userNoteId: NOTE_B,
        updatedAt: "2026-09-11T00:00:00Z",
      },
    ]
  );
  assert.equal(match?.ambiguous, true);
  assert.equal(match?.noteId, "");
});

test("restores a unique notes-hub title that was parked on a course lecture note", () => {
  const hubTitle =
    "Lecture 4 - ER Targeting, Endomembrane Trafficking, and mRNA-to-Protein Flow";
  const target = pickSectionNoteForStoredLabel(
    hubTitle,
    {
      id: NOTE_B,
      title: "Lecture 4",
      courseId: COURSE,
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: hubTitle,
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
      {
        id: NOTE_B,
        title: "Lecture 4",
        courseId: COURSE,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, NOTE_A);
});

test("does not restore when Lecture 4 exists in both a hub folder and a course", () => {
  const target = pickSectionNoteForStoredLabel(
    "Lecture 4",
    {
      id: NOTE_B,
      title: "Lecture 4",
      courseId: COURSE,
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: "Lecture 4",
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
      {
        id: NOTE_B,
        title: "Lecture 4",
        courseId: COURSE,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, null);
});

test("restores Lecture 2 parked on course Lecture 3 when the label still names the hub note", () => {
  const hubTitle = "Lecture 2 - Nuclear Architecture and Chromatin";
  const target = pickSectionNoteForStoredLabel(
    hubTitle,
    {
      id: NOTE_B,
      title: "Lecture 3",
      courseId: COURSE,
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: "Lecture 2",
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
      {
        id: NOTE_B,
        title: "Lecture 3",
        courseId: COURSE,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, NOTE_A);
});

test("does not steal a course Lecture 3 card whose label is only Lecture 3", () => {
  const target = pickSectionNoteForStoredLabel(
    "Lecture 3",
    {
      id: NOTE_B,
      title: "Lecture 3",
      courseId: COURSE,
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: "Lecture 3 - Nuclear Envelope and Transport",
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
      {
        id: NOTE_B,
        title: "Lecture 3",
        courseId: COURSE,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, null);
});

test("resolveFocusCardNoteId keeps a hub-section origin even if a course_id was stamped", () => {
  const resolved = resolveFocusCardNoteId(
    NOTE_A,
    "Lecture 4",
    [
      {
        id: NOTE_A,
        title: "Lecture 4",
        courseId: COURSE,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
      },
      {
        id: NOTE_B,
        title: "Lecture 4",
        courseId: COURSE,
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(resolved, NOTE_A);
});

const HUB_L2_TITLE =
  "Lecture 2 - Nuclear Organization: From Chromatin Structure to Gene Regulation";
const HUB_L3_TITLE =
  "Lecture 3 - Nuclear Organization, Targeting Signals, and the Ran GTPase Cycle";

test("short Lecture 3 label parked on MCB course note restores to hub Lecture 3", () => {
  const target = pickSectionNoteForStoredLabel(
    "Lecture 3",
    {
      id: NOTE_B,
      title: "Lecture 3",
      courseId: COURSE,
      courseTitle: "MCB 104 (Fall 2026)",
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: HUB_L3_TITLE,
        courseId: null,
        courseTitle: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
        sectionTitle: "MCB 104 !",
      },
      {
        id: NOTE_B,
        title: "Lecture 3",
        courseId: COURSE,
        courseTitle: "MCB 104 (Fall 2026)",
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, NOTE_A);
});

test("short Lecture 2 on PBHLTH does not restore onto MCB 104 hub Lecture 2", () => {
  const target = pickSectionNoteForStoredLabel(
    "Lecture 2",
    {
      id: NOTE_B,
      title: "Lecture 2",
      courseId: OTHER,
      courseTitle: "PBHLTH 162A (Fall 2026)",
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: HUB_L2_TITLE,
        courseId: null,
        courseTitle: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
        sectionTitle: "MCB 104 !",
        notesText:
          "Chromatin structure, nucleosomes, and gene regulation in the nucleus.",
      },
      {
        id: NOTE_B,
        title: "Lecture 2",
        courseId: OTHER,
        courseTitle: "PBHLTH 162A (Fall 2026)",
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ]
  );
  assert.equal(target, null);
});

test("Ran GTPase card text restores onto hub Lecture 3 when the label was overwritten", () => {
  const target = pickSectionNoteForStoredLabel(
    "Lecture 3",
    {
      id: NOTE_B,
      title: "Lecture 3",
      courseId: COURSE,
      courseTitle: "MCB 104 (Fall 2026)",
      updatedAt: "2026-09-11T00:00:00Z",
      deleted: false,
      sectionId: null,
    },
    [
      {
        id: NOTE_A,
        title: HUB_L2_TITLE,
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
        sectionTitle: "MCB 104 !",
        notesText:
          "Chromatin structure to gene regulation. Nucleosomes, TADs, cohesin loops, euchromatin.",
      },
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        title: HUB_L3_TITLE,
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
        sectionTitle: "MCB 104 !",
        notesText:
          "Nuclear import uses importin, NLS, Ran-GTP, Ran-GAP, Ran-GEF, nucleoporins, and the Ran GTPase cycle.",
      },
      {
        id: NOTE_B,
        title: "Lecture 3",
        courseId: COURSE,
        courseTitle: "MCB 104 (Fall 2026)",
        updatedAt: "2026-09-11T00:00:00Z",
        deleted: false,
        sectionId: null,
      },
    ],
    "What does Ran-GTP bind to initiate nuclear export of cargo through the NPC?"
  );
  assert.equal(target, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
});

test("course-native PDF card with no note id is not restored onto a hub lecture", () => {
  const resolved = resolveFocusCardNoteId(
    null,
    "Lecture 4",
    [
      {
        id: NOTE_A,
        title:
          "Lecture 4 - ER Targeting, Endomembrane Trafficking, and mRNA-to-Protein Flow",
        courseId: null,
        updatedAt: "2026-09-10T00:00:00Z",
        deleted: false,
        sectionId: SECTION,
        sectionTitle: "MCB 104 !",
      },
    ],
    { materialId: "22222222-2222-4222-8222-222222222222" }
  );
  assert.equal(resolved, null);
});

test("repairOrphanNotesFocusCards never writes quiz identity", async () => {
  const calls: string[] = [];
  const supabase = {
    from(table: string) {
      calls.push(`from:${table}`);
      throw new Error(`unexpected ${table} access`);
    },
  };
  await repairOrphanNotesFocusCards(supabase as never, "user-id");
  assert.deepEqual(calls, []);
});
