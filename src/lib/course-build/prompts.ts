import type Anthropic from "@anthropic-ai/sdk";

/** Sent with every writing call; kept short because it is paid for on each one. */
export const CONTENT_RULES = `You write part of a study course built from a student's own lecture materials. The course must teach the material well enough that the student never needs the original.

Content rules:
- Coverage: every concept, distinction, mechanism, worked example, named case and cause-and-effect explanation on your pages appears in your lessons. Before submitting, check your pages and add anything missing.
- Teach each idea once, in the most logical place. Other modules in the plan cover their own topics; refer to them briefly instead of re-explaining.
- Dense, not padded: full explanatory sentences, as few words as the idea needs. No intros ("In this lesson…"), no closing summaries, no filler transitions.
- Faithful: use only what the pages say. No outside facts, numbers or named cases. Reproduce source errors as written. Never build a table, total or calculation the source didn't show.
- Numbers: every number you write appears on your pages, or is a calculation you show from numbers on your pages. Never add a typical value, normal range, constant, percentage or date from general knowledge, even as an illustration; a figure you can't see is described only by what its page text says.
- Tables: reproduce every source table as a complete markdown table, every row, column, number and proper noun exactly as written. Never turn a table into prose.
- Worked examples: keep the reasoning and the actual figures, and the source's own named examples.
- Leave out logistics (dates, rooms, platforms, staff, announcements, clicker or poll instructions) and unsolved practice prompts or activities, but keep the concept an activity tested. Solved examples stay.
- Questions: never state the answer to a question the pages ask (clicker, poll, practice or exam question, pages marked "(question page)", or a question or task printed inside a textbook page such as "Explain how…", "Why do you suppose…", "Which of the following…") unless a page states that answer. Don't turn its choices, hints or premise into facts, in lessons or quiz; teach only what the surrounding text states.
- Voice: declarative, like a good textbook. No asides, hedging, first person, strikethrough or self-corrections. If unsure, leave it out.
- No placeholders such as "Example 1" or "[insert scenario]". Never mention pages, slides, "the source" or "the lecture" in lessons or quiz items.
- Format: markdown in short paragraphs; numbered steps or bullets where the source lists steps or items; math in LaTeX ($...$); numeric ranges use an en dash (1–4); keep mixed-language terms exactly as written, e.g. 디아제팜(diazepam).
- Length follows the source: thin pages get short lessons.

Lesson fields:
- title: names the concept, never the file or page numbers.
- content: the teaching prose. Never empty, never just a list of terms.
- key_terms: only terms the pages introduce that a student would study (0–4), each defined in at most 15 words.
- examples: one short example, preferably the source's own (two only if the source gives two). If it has none, a short generic one with no invented source facts or numbers.
- figures: [] unless the pages list figures; then see the figure instruction.
- first_page, last_page: the pN numbers the lesson draws on.

Quiz fields (keep them short; they share your length budget):
- Mix easy, medium and hard. Mostly test understanding and application, not word recall. Every question must be answerable from your lessons.
- question: at most 30 words.
- multiple_choice: exactly 4 choices of at most 10 words, one correct; correct_choice is its 0-based index; reference_answer is "".
- free_response: choices is []; correct_choice is 0; reference_answer states what a full answer must contain (at most 30 words).
- explanation: at most 20 words.`;

export const PLAN_RULES = `You plan a study course from a compact outline of a student's lecture materials. Each outline line is one page: "pN [markers] heading | first words". Markers: [T] table, [F] figure reference, [·] nearly empty, [Q] only asks a question, [R] reference list or bibliography.

- Split the content pages into modules in source order. Each module is one coherent topic, sized by the content. Aim for 8–16 pages per module and never exceed the module limit you are given.
- Modules are contiguous page ranges in order; every content page belongs to exactly one module.
- Module titles name the concept (e.g. "Regulation of Phosphofructokinase"), never the file or page numbers.
- 2–5 lesson titles per module, each naming a concept.
- Titles come from the outline: every module and lesson title names what its own pages' headings and first words show. Never name a topic those pages don't show, even one the subject usually covers next.
- skip_pages: title slides, blank pages, pure activity or poll pages ([Q]), reference lists, bibliographies and citation pages ([R]), and pages that only repeat earlier ones. A reference list is never a module.
- info_pages: syllabus, logistics, grading, deadlines, announcements. These go to Course Info and are never taught.
- title: a short title for this material taken from its content, not the file name. description: one sentence on what it teaches.
- Write titles in the language of the material.`;

const str = { type: "string" } as const;
const int = { type: "integer" } as const;

const LESSON_SCHEMA = {
  type: "object",
  properties: {
    title: str,
    content: str,
    key_terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: str, definition: str },
        required: ["term", "definition"],
        additionalProperties: false,
      },
    },
    examples: { type: "array", items: str },
    figures: {
      type: "array",
      items: {
        type: "object",
        properties: { id: str, caption: str },
        required: ["id", "caption"],
        additionalProperties: false,
      },
    },
    first_page: int,
    last_page: int,
  },
  required: ["title", "content", "key_terms", "examples", "figures", "first_page", "last_page"],
  additionalProperties: false,
} as const;

const QUIZ_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["multiple_choice", "free_response"] },
    difficulty: { type: "string", enum: ["easy", "medium", "hard"] },
    question: str,
    choices: { type: "array", items: str },
    correct_choice: int,
    reference_answer: str,
    explanation: str,
  },
  required: [
    "kind",
    "difficulty",
    "question",
    "choices",
    "correct_choice",
    "reference_answer",
    "explanation",
  ],
  additionalProperties: false,
} as const;

export const PLAN_TOOL: Anthropic.Tool = {
  name: "submit_plan",
  description: "Submit the course plan.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: str,
      description: str,
      modules: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            title: str,
            first_page: int,
            last_page: int,
            lessons: { type: "array", items: str },
          },
          required: ["title", "first_page", "last_page", "lessons"],
          additionalProperties: false,
        },
      },
      skip_pages: { type: "array", items: int },
      info_pages: { type: "array", items: int },
    },
    required: ["title", "description", "modules", "skip_pages", "info_pages"],
    additionalProperties: false,
  },
};

export const MODULE_TOOL: Anthropic.Tool = {
  name: "submit_module",
  description: "Submit the finished module.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      lessons: { type: "array", minItems: 1, items: LESSON_SCHEMA },
      quiz: { type: "array", minItems: 1, items: QUIZ_SCHEMA },
    },
    required: ["lessons", "quiz"],
    additionalProperties: false,
  },
};

/** Sources under the planning threshold: one call writes the whole thing. */
export const SINGLE_MODULE_TOOL: Anthropic.Tool = {
  name: "submit_course",
  description: "Submit the finished one-module course.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      title: str,
      description: str,
      module_title: str,
      lessons: { type: "array", minItems: 1, items: LESSON_SCHEMA },
      quiz: { type: "array", minItems: 1, items: QUIZ_SCHEMA },
    },
    required: ["title", "description", "module_title", "lessons", "quiz"],
    additionalProperties: false,
  },
};

/** A module's lessons missed some pages: extra lessons for just those pages. */
export const GAP_TOOL: Anthropic.Tool = {
  name: "submit_missing_lessons",
  description: "Submit lessons that teach the pages the module missed.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      lessons: { type: "array", items: LESSON_SCHEMA },
    },
    required: ["lessons"],
    additionalProperties: false,
  },
};
