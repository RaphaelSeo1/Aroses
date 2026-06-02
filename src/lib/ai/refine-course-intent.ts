import type { CourseModule, CoursePayload } from "@/types/course";

export type RefineScope =
  | { kind: "full_course" }
  | { kind: "modules"; moduleIds: number[] };

export type RefineIntent = {
  scope: RefineScope;
  /** Structured hints injected into the model prompt. */
  goals: string[];
  /** One-line catalog of modules (id + title) for disambiguation. */
  moduleCatalog: string;
  /** True when non-target modules should be sent in compressed form. */
  compressUntouchedModules: boolean;
};

function normalizeInstruction(instruction: string): string {
  return instruction.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildModuleCatalog(modules: CourseModule[]): string {
  return modules.map((m) => `  - id ${m.id}: "${m.title}"`).join("\n");
}

/** Parse "module 2", "modules 1 and 3", "in module 4", etc. */
export function parseTargetModuleIds(
  instruction: string,
  modules: CourseModule[]
): number[] {
  const s = normalizeInstruction(instruction);
  const validIds = new Set(modules.map((m) => m.id));
  const found = new Set<number>();

  const patterns = [
    /\bmodules?\s+#?(\d+)\b/g,
    /\bmodule\s+#?(\d+)\b/g,
    /\bmod(?:ule)?\s+(\d+)\b/g,
    /\bsection\s+(\d+)\b/g,
    /\bchapter\s+(\d+)\b/g,
  ];

  for (const re of patterns) {
    for (const match of s.matchAll(re)) {
      const n = Number.parseInt(match[1], 10);
      if (Number.isFinite(n) && validIds.has(n)) found.add(n);
    }
  }

  // "modules 1, 2, and 3"
  for (const match of s.matchAll(/\b(\d+)\s*(?:,|and)\s*/g)) {
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && validIds.has(n)) found.add(n);
  }

  // Match by title fragment: "the Krebs cycle module"
  if (found.size === 0) {
    for (const mod of modules) {
      const title = mod.title.toLowerCase();
      if (title.length >= 4 && s.includes(title.slice(0, Math.min(24, title.length)))) {
        found.add(mod.id);
      }
    }
  }

  return [...found].sort((a, b) => a - b);
}

function inferGoals(instruction: string): string[] {
  const s = normalizeInstruction(instruction);
  const goals: string[] = [];

  if (/\b(shorten|shorter|concise|trim|cut down|less verbose|brief)\b/.test(s)) {
    goals.push("Make targeted text shorter and clearer; remove filler and repetition.");
  }
  if (/\b(tangent|off[- ]topic|irrelevant|generic|fluff|padding)\b/.test(s)) {
    goals.push("Remove off-topic tangents; keep content aligned with the source material.");
  }
  if (/\b(quiz|question|mcq|multiple choice|free response)\b/.test(s)) {
    goals.push("Update quiz questions/explanations as requested; keep valid MCQ shape (4 choices).");
  }
  if (/\b(title|rename|retitle|heading)\b/.test(s)) {
    goals.push("Rename module/lesson titles for clarity and consistent flow.");
  }
  if (/\b(merge|combine|split|reorganiz|restructur|reorder)\b/.test(s)) {
    goals.push("Restructure modules/lessons as requested; renumber module ids consecutively if merging/splitting.");
  }
  if (/\b(key terms?|vocabulary|definitions?|glossary)\b/.test(s)) {
    goals.push("Add, remove, or rewrite key_terms arrays in lessons as requested.");
  }
  if (/\b(examples?)\b/.test(s)) {
    goals.push("Add, remove, or rewrite examples arrays in lessons as requested.");
  }
  if (/\b(fix|correct|accura|wrong|error|mistake)\b/.test(s)) {
    goals.push("Fix factual or wording errors; do not invent new facts beyond the course.");
  }
  if (/\b(simplif|easier|beginner|explain)\b/.test(s)) {
    goals.push("Simplify explanations while preserving accuracy.");
  }
  if (/\b(advanced|deeper|detail|expand|elaborate)\b/.test(s)) {
    goals.push("Add depth and nuance where requested.");
  }
  if (/\b(image|picture|photo|figure|diagram|visual)\b/.test(s)) {
    goals.push("Remove or adjust images in lesson Markdown (![…](url) and <img> tags) as requested.");
  }

  if (goals.length === 0) {
    goals.push(
      "Apply the student's request literally. Change the course JSON — do not return it unchanged."
    );
  }

  return goals;
}

function wantsFullCourseScope(instruction: string): boolean {
  const s = normalizeInstruction(instruction);
  return (
    /\b(all|every|each|entire|whole|course[- ]wide|throughout)\b/.test(s) ||
    /\b(every|all) (module|lesson|unit)/.test(s)
  );
}

export function analyzeRefineIntent(
  course: CoursePayload,
  instruction: string
): RefineIntent {
  const moduleIds = parseTargetModuleIds(instruction, course.modules);
  const fullCourse = wantsFullCourseScope(instruction);
  const goals = inferGoals(instruction);
  const moduleCatalog = buildModuleCatalog(course.modules);

  let scope: RefineScope;
  if (moduleIds.length > 0 && !fullCourse) {
    scope = { kind: "modules", moduleIds };
  } else {
    scope = { kind: "full_course" };
  }

  const serialized = JSON.stringify(course);
  const compressUntouchedModules =
    serialized.length > 90_000 &&
    scope.kind === "modules" &&
    scope.moduleIds.length < course.modules.length;

  return {
    scope,
    goals,
    moduleCatalog,
    compressUntouchedModules,
  };
}

/** Shrink lesson bodies in modules we're not editing (saves tokens, keeps structure). */
export function compressCourseForRefineInput(
  course: CoursePayload,
  targetModuleIds: number[]
): CoursePayload {
  const targets = new Set(targetModuleIds);
  return {
    ...course,
    modules: course.modules.map((mod) => {
      if (targets.has(mod.id)) return mod;
      return {
        ...mod,
        lessons: mod.lessons.map((lesson) => ({
          ...lesson,
          content:
            lesson.content.length > 400
              ? `${lesson.content.slice(0, 400).trim()}… [content omitted — return this module UNCHANGED]`
              : lesson.content,
        })),
      };
    }),
  };
}

export function buildIntentPromptSection(intent: RefineIntent): string {
  const lines: string[] = ["PARSED EDIT INTENT (follow this):"];

  if (intent.scope.kind === "modules") {
    lines.push(
      `- SCOPE: Edit ONLY module id(s) ${intent.scope.moduleIds.join(", ")}. Every other module must be returned UNCHANGED (same titles, lessons, quiz).`
    );
  } else {
    lines.push("- SCOPE: Course-wide edit — apply across all modules and lessons when the student says all/every.");
  }

  lines.push("- MODULE CATALOG:");
  lines.push(intent.moduleCatalog);

  lines.push("- GOALS:");
  for (const g of intent.goals) {
    lines.push(`  • ${g}`);
  }

  if (intent.compressUntouchedModules) {
    lines.push(
      "- NOTE: Non-target modules have truncated lesson content in the input for size limits. Copy them back exactly from the structure shown; only fully rewrite target module(s)."
    );
  }

  lines.push(
    "- You MUST make visible changes matching the request. Returning identical content is a failure."
  );

  return lines.join("\n");
}

/** Deep-enough equality check — did refine actually change anything? */
export function coursePayloadChanged(
  before: CoursePayload,
  after: CoursePayload
): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}
