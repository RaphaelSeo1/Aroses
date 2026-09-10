import assert from "node:assert/strict";
import test from "node:test";
import type { CourseModule, CourseQuizItem } from "../../types/course.ts";
import {
  extractNoteFocusSections,
  isSameQuizQuestion,
  mapFocusQuestionsToModules,
  mergeFocusQuestionsIntoModuleQuizzes,
  modulesToQuizTargets,
  planFocusQuestionImport,
  type NoteFocusQuestion,
} from "./map-focus-questions-to-modules.ts";

function mcq(question: string, correct = "A"): CourseQuizItem {
  return {
    type: "mcq",
    question,
    choices: ["Alpha", "Beta", "Gamma", "Delta"],
    correct,
    correctIndex: 0,
    explanation: "Because the notes say so.",
  };
}

function frq(question: string): CourseQuizItem {
  return {
    type: "free_response",
    question,
    referenceAnswer: "A solid answer restates the note in the student's words.",
    explanation: "Check the notes.",
  };
}

function module(
  id: number,
  title: string,
  lesson: string,
  quiz: CourseQuizItem[] = []
): CourseModule {
  return {
    id,
    title,
    lessons: [
      {
        title,
        content: lesson,
        key_terms: [],
        examples: [],
      },
    ],
    quiz,
  };
}

function noteDoc(
  sections: Array<{
    heading?: string;
    body: string;
    clipId?: string;
  }>
) {
  const content: unknown[] = [];
  for (const section of sections) {
    if (section.heading) {
      content.push({
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: section.heading }],
      });
    }
    content.push({
      type: "paragraph",
      content: [
        {
          type: "text",
          text: section.body,
          ...(section.clipId
            ? { marks: [{ type: "focusClip", attrs: { id: section.clipId } }] }
            : {}),
        },
      ],
    });
  }
  return { type: "doc", content };
}

test("extractNoteFocusSections splits on headings and keeps clip ids", () => {
  const sections = extractNoteFocusSections(
    noteDoc([
      {
        heading: "Osmosis",
        body: "Water moves toward higher solute.",
        clipId: "clip-osmo",
      },
      {
        heading: "Diffusion",
        body: "Particles spread from high to low concentration.",
      },
    ])
  );
  assert.equal(sections.length, 2);
  assert.equal(sections[0]?.heading, "Osmosis");
  assert.deepEqual(sections[0]?.focusClipIds, ["clip-osmo"]);
  assert.match(sections[1]?.text ?? "", /Diffusion/);
  assert.doesNotMatch(sections[0]?.text ?? "", /Particles spread/);
});

test("single module receives every note focus question", () => {
  const mappings = mapFocusQuestionsToModules({
    questions: [
      { id: "a", item: mcq("What is osmosis?"), sourceExcerpt: "Water moves" },
      { id: "b", item: frq("Explain diffusion."), sourceExcerpt: "Particles" },
    ],
    modules: modulesToQuizTargets([
      module(3, "Cells", "Membranes and water movement."),
    ]),
    noteSections: extractNoteFocusSections(
      noteDoc([
        { heading: "Osmosis", body: "Water moves toward higher solute." },
        { heading: "Diffusion", body: "Particles spread out." },
      ])
    ),
  });
  assert.equal(mappings.length, 2);
  assert.equal(mappings[0]?.moduleId, 3);
  assert.equal(mappings[1]?.moduleId, 3);
  assert.equal(mappings.every((m) => !m.duplicateOfGenerated), true);
});

test("heading sections map onto matching modules instead of dumping on module 1", () => {
  const osmosisQ: NoteFocusQuestion = {
    id: "clip-osmo",
    item: mcq("Which way does water move in osmosis?"),
    sourceExcerpt: "Water moves toward higher solute.",
  };
  const diffusionQ: NoteFocusQuestion = {
    id: "d1",
    item: frq("Describe diffusion of particles."),
    sourceExcerpt: "Particles spread from high to low concentration.",
  };
  const planned = planFocusQuestionImport({
    questions: [osmosisQ, diffusionQ],
    modules: [
      module(1, "Osmosis", "Water crosses a membrane toward higher solute."),
      module(2, "Diffusion", "Particles spread from high to low concentration."),
    ],
    contentJson: noteDoc([
      {
        heading: "Osmosis",
        body: "Water moves toward higher solute.",
        clipId: "clip-osmo",
      },
      {
        heading: "Diffusion",
        body: "Particles spread from high to low concentration.",
      },
    ]),
  });
  assert.equal(planned.mappings[0]?.moduleId, 1);
  assert.equal(planned.mappings[1]?.moduleId, 2);
  assert.equal(planned.modules[0]?.quiz[0]?.question, osmosisQ.item.question);
  assert.equal(planned.modules[1]?.quiz[0]?.question, diffusionQ.item.question);
});

test("order fallback spreads unmatched sections across modules", () => {
  const mappings = mapFocusQuestionsToModules({
    questions: [
      {
        id: "a",
        item: mcq("First topic question?"),
        sourceExcerpt: "Alpha topic unique phrase one.",
      },
      {
        id: "b",
        item: mcq("Second topic question?"),
        sourceExcerpt: "Beta topic unique phrase two.",
      },
      {
        id: "c",
        item: mcq("Third topic question?"),
        sourceExcerpt: "Gamma topic unique phrase three.",
      },
    ],
    modules: modulesToQuizTargets([
      module(1, "Unit A", "Intro material with no overlap."),
      module(2, "Unit B", "Middle material with no overlap."),
      module(3, "Unit C", "Later material with no overlap."),
    ]),
    noteSections: extractNoteFocusSections(
      noteDoc([
        { heading: "Alpha", body: "Alpha topic unique phrase one." },
        { heading: "Beta", body: "Beta topic unique phrase two." },
        { heading: "Gamma", body: "Gamma topic unique phrase three." },
      ])
    ),
  });
  const ids = mappings.map((m) => m.moduleId);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("duplicate generated quiz items are not merged again", () => {
  const student = mcq("What binds oxygen in blood?");
  const generated = mcq("What binds oxygen in blood?");
  const planned = planFocusQuestionImport({
    questions: [
      {
        id: "q1",
        item: student,
        sourceExcerpt: "Hemoglobin in red cells binds oxygen.",
      },
    ],
    modules: [
      module(1, "Blood", "Hemoglobin in red cells binds oxygen.", [generated]),
    ],
    contentJson: noteDoc([
      {
        heading: "Blood",
        body: "Hemoglobin in red cells binds oxygen.",
      },
    ]),
  });
  assert.equal(planned.mappings[0]?.duplicateOfGenerated, true);
  assert.equal(planned.modules[0]?.quiz.length, 1);
  assert.equal(planned.modules[0]?.quiz[0]?.question, generated.question);
});

test("student wording is kept when merging a new question", () => {
  const student = frq("In your own words, why do mitochondria matter?");
  const planned = planFocusQuestionImport({
    questions: [
      {
        id: "q1",
        item: student,
        sourceExcerpt: "Mitochondria produce ATP for the rest of the cell.",
      },
    ],
    modules: [
      module(1, "Cells", "Mitochondria produce ATP for the rest of the cell.", [
        mcq("What is the nucleus?"),
      ]),
    ],
    contentJson: noteDoc([
      {
        heading: "Cells",
        body: "Mitochondria produce ATP for the rest of the cell.",
      },
    ]),
  });
  assert.equal(planned.mappings[0]?.duplicateOfGenerated, false);
  assert.equal(planned.modules[0]?.quiz.length, 2);
  assert.equal(planned.modules[0]?.quiz[1]?.question, student.question);
});

test("lost or empty notes skip mapping", () => {
  const mappings = mapFocusQuestionsToModules({
    questions: [],
    modules: modulesToQuizTargets([
      module(1, "Anything", "Still a real lesson about membranes."),
    ]),
    noteSections: [],
  });
  assert.deepEqual(mappings, []);

  const emptyPlan = planFocusQuestionImport({
    questions: [],
    modules: [module(1, "Anything", "Still a real lesson about membranes.")],
    contentJson: null,
  });
  assert.deepEqual(emptyPlan.mappings, []);
  assert.equal(emptyPlan.modules[0]?.quiz.length, 0);
});

test("without note JSON, excerpt still maps to the matching module", () => {
  const mappings = mapFocusQuestionsToModules({
    questions: [
      {
        id: "q1",
        item: mcq("How do particles spread?"),
        sourceExcerpt:
          "Particles spread from high to low concentration across the membrane.",
      },
    ],
    modules: modulesToQuizTargets([
      module(1, "Osmosis", "Water moves toward higher solute concentration."),
      module(
        2,
        "Diffusion",
        "Particles spread from high to low concentration across the membrane."
      ),
    ]),
    noteSections: [],
  });
  assert.equal(mappings[0]?.moduleId, 2);
});

test("mergeFocusQuestionsIntoModuleQuizzes is a no-op for empty mappings", () => {
  const modules = [module(1, "A", "aaa", [mcq("Keep me")])];
  const next = mergeFocusQuestionsIntoModuleQuizzes(modules, []);
  assert.equal(next, modules);
});

test("isSameQuizQuestion requires a strong stem match", () => {
  assert.equal(
    isSameQuizQuestion(mcq("What is osmosis in plant cells?"), mcq("What is osmosis in plant cells?")),
    true
  );
  assert.equal(
    isSameQuizQuestion(
      mcq("What is osmosis in plant cells?"),
      mcq("Name the organelles that produce ATP.")
    ),
    false
  );
});
