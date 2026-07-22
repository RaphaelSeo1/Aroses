import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { stripJsonFence } from "@/lib/ai/course-payload";
import {
  analyzeRefineIntent,
  parseTargetModuleIds,
} from "@/lib/ai/refine-course-intent";
import type { LessonEditOp } from "@/lib/ai/refine-lesson-ops";
import type { CoursePayload } from "@/types/course";

/** A single spot in the current course the edit will touch (for the preview). */
export type RefinePreviewEdit = {
  moduleId: number;
  lessonIndex: number;
  kind: "content" | "key_term" | "example";
  /** Content-span fields (kind === "content"). */
  start?: number;
  deleteLen?: number;
  insert?: string;
  /** Structured preview labels. */
  term?: string;
  definition?: string;
  example?: string;
  action?: "add" | "remove" | "replace";
};

/**
 * The planner is the "brain" of Refine with Rose. Instead of regex-guessing what
 * the student meant, a fast model reads the instruction + a lightweight course
 * outline and returns a structured execution plan. The orchestrator then runs the
 * cheapest reliable strategy:
 *
 *   - "bulk"          deterministic edits in code (remove images/terms/examples)
 *   - "per_module"    edit each target module independently (parallel, robust on
 *                     huge courses — no single giant JSON round-trip to truncate)
 *   - "whole_course"  structural edits (merge/split/reorder) needing global view
 *   - "metadata"      title/description only
 *
 * A regex fallback (from refine-course-intent) keeps the tool working if the
 * planner call fails or the key is missing.
 */

export type RefineBulkOp =
  | "remove_images"
  | "remove_key_terms"
  | "remove_examples";

export type RefineStrategy =
  | "bulk"
  | "per_module"
  | "whole_course"
  | "metadata";

export type RefinePlan = {
  /** One sentence describing what Rose understood (shown to the student). */
  summary: string;
  strategy: RefineStrategy;
  /** Empty = applies to all modules. */
  targetModuleIds: number[];
  /** Deterministic bulk ops to run in code before/instead of the model. */
  bulkOps: RefineBulkOp[];
  /** Tightened, self-contained instruction to apply to each module / the course. */
  editInstruction: string;
  /** Whether an LLM pass is needed after bulk ops. */
  needsLlm: boolean;
  /** True when the plan was produced by the regex fallback (not the model). */
  fromFallback: boolean;
  /**
   * Concrete proposed edits for the confirm UI (headings + bullets).
   * Example: "Shorten Module 2 lessons — cut repetition, keep definitions".
   */
  proposedChanges: string[];
  /**
   * Precomputed surgical edit locations (offsets in the CURRENT course) so the
   * UI can hover a caret over exactly what will change before the student
   * confirms. Present only for scoped per-module edits.
   */
  previewEdits?: RefinePreviewEdit[];
  /**
   * The exact ops behind {@link previewEdits}. On confirm these are re-applied
   * in code (no second model call) so the write is deterministic and can only
   * touch the previewed spans — never a whole-lesson rewrite.
   */
  previewOps?: { moduleId: number; ops: LessonEditOp[] }[];
};

function planModelId(): string {
  return process.env.ANTHROPIC_REFINE_PLANNER_MODEL?.trim() || "claude-haiku-4-5";
}

function buildOutline(course: CoursePayload): string {
  return course.modules
    .map((m) => {
      const lessonTitles = m.lessons.map((l) => l.title).join("; ");
      return `  id ${m.id}: "${m.title}" — lessons: ${lessonTitles}`;
    })
    .join("\n");
}

const PLANNER_SYSTEM = `You are the planning brain for "Refine with Rose", a course-editing tool. A student describes a change to their study course in plain language. You output ONE JSON object describing how to execute it. You do NOT edit content yourself.

Return ONLY this JSON shape (no prose, no fences):
{
  "summary": string,                       // 1 sentence: what you understood
  "strategy": "bulk" | "per_module" | "whole_course" | "metadata",
  "targetModuleIds": number[],             // [] means ALL modules
  "bulkOps": ("remove_images" | "remove_key_terms" | "remove_examples")[],
  "editInstruction": string,               // a clear, self-contained restatement to apply
  "needsLlm": boolean,                     // false ONLY if bulkOps fully satisfy the request
  "proposedChanges": string[]              // 2–6 short lines the student can confirm: what you will change
}

Strategy guide:
- "bulk": purely removing images/key-terms/examples across modules → set bulkOps, needsLlm false.
- "metadata": only the course title/description changes.
- "whole_course": ONLY merging/splitting/reordering modules, changing module COUNT, or anything needing a global view. NEVER use whole_course to add/remove/fix a key term, example, or a paragraph.
- "per_module": rewriting/shortening/fixing/retitling lesson or quiz CONTENT, AND adding/removing key terms or examples (the common case). Set targetModuleIds when the student names modules OR when a module is currently open for a deictic/unscoped request; else [] for all.

proposedChanges rules:
- Each item is one concrete edit the student can approve (e.g. "Add clearer definitions in Module 1 lessons", "Remove all lesson images course-wide", "Rewrite Module 3 quiz to match the lessons").
- Prefer specific module/lesson names from the outline when possible.
- Never invent topics that aren't implied by the request or outline.
- Describe surgical changes (add/remove/fix a part), not "rewrite the whole lesson", unless the student asked for a full rewrite.

Rules:
- If the student names modules by number or topic, resolve them to ids from the outline.
- Combine: e.g. "remove all images and shorten module 3" → bulkOps:["remove_images"], strategy:"per_module", targetModuleIds:[3], needsLlm:true.
- editInstruction must be understandable without the original phrasing.
- editInstruction MUST tell the editor to make a surgical change: preserve unchanged text verbatim; only insert/delete/replace the specific part requested. For key terms / examples, instruct a structured add/remove — never a lesson rewrite.
- Be decisive. Never return an empty plan.`;

/**
 * Verbs that imply the model must rewrite/restructure content (not just remove).
 * Intentionally only action verbs — scope nouns like "lesson", "module",
 * "content", "images" must NOT appear here, or phrases like "remove all images
 * in every module and lesson" would be misread as needing an LLM rewrite.
 */
const CONTENT_EDIT_RE =
  /\b(shorten|rewrite|reword|rephrase|fix|improve|enhance|merge|combine|split|reorder|reorganiz|restructur|add|insert|append|create|rename|retitle|expand|elaborate|simplify|clarify|summari[sz]e|condense|translate|convert|make it|turn it|rework)\b/;

/** True when the request is satisfied entirely by deterministic bulk removals. */
function isPureBulk(instruction: string, bulkOps: RefineBulkOp[]): boolean {
  if (bulkOps.length === 0) return false;
  return !CONTENT_EDIT_RE.test(instruction.toLowerCase());
}

/**
 * Deterministically detect "remove all X" requests from raw text. Used as a
 * safety net so a planner miss never leaves image/term/example removals to a
 * slow per-module LLM pass.
 */
function detectBulkOpsFromText(instruction: string): RefineBulkOp[] {
  const s = instruction.toLowerCase();
  const broad =
    /\b(all|every|each|entire|whole|across|everywhere|in the course|in my course)\b/.test(
      s
    );
  const remove =
    /\b(remove|delete|strip|clear|drop|hide|get rid of|take out|without|no more|no)\b/.test(
      s
    );
  if (!remove || !broad) return [];
  const ops: RefineBulkOp[] = [];
  if (
    /\b(images?|pictures?|photos?|figures?|diagrams?|illustrations?|visuals?|graphics?)\b/.test(
      s
    )
  ) {
    ops.push("remove_images");
  }
  if (/\b(key terms?|vocabulary|vocab|definitions?|glossary|terms?)\b/.test(s)) {
    ops.push("remove_key_terms");
  }
  if (/\bexamples?\b/.test(s)) ops.push("remove_examples");
  return ops;
}

function coerceStrategy(v: unknown): RefineStrategy {
  return v === "bulk" || v === "per_module" || v === "whole_course" || v === "metadata"
    ? v
    : "per_module";
}

/** Strategies where per-module scoping makes sense (not global structure/meta). */
function strategyAllowsScoping(s: RefineStrategy): boolean {
  return s === "per_module" || s === "bulk";
}

function coerceBulkOps(v: unknown): RefineBulkOp[] {
  if (!Array.isArray(v)) return [];
  const out: RefineBulkOp[] = [];
  for (const x of v) {
    if (x === "remove_images" || x === "remove_key_terms" || x === "remove_examples") {
      out.push(x);
    }
  }
  return [...new Set(out)];
}

function coerceModuleIds(v: unknown, valid: Set<number>): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = typeof x === "number" ? x : Number(x);
    if (Number.isFinite(n) && valid.has(n)) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function coerceProposedChanges(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push(x.trim());
  }
  return out.length > 0 ? out.slice(0, 8) : fallback;
}

function defaultProposedChanges(
  course: CoursePayload,
  instruction: string,
  plan: Omit<RefinePlan, "proposedChanges" | "fromFallback"> & {
    fromFallback?: boolean;
  }
): string[] {
  const lines: string[] = [];
  if (plan.bulkOps.includes("remove_images")) {
    lines.push("Remove all images from lessons across the course");
  }
  if (plan.bulkOps.includes("remove_key_terms")) {
    lines.push("Remove key-term glossaries from lessons");
  }
  if (plan.bulkOps.includes("remove_examples")) {
    lines.push("Remove example lists from lessons");
  }
  const targets =
    plan.targetModuleIds.length > 0
      ? plan.targetModuleIds
          .map((id) => course.modules.find((m) => m.id === id)?.title ?? `Module ${id}`)
          .join(", ")
      : "all modules";
  if (plan.needsLlm) {
    lines.push(
      plan.strategy === "metadata"
        ? "Update the course title and description"
        : plan.strategy === "whole_course"
          ? "Restructure modules to match your request"
          : `Rewrite / refine lesson content in ${targets}`
    );
  }
  if (lines.length === 0) {
    lines.push(plan.summary || instruction.trim());
  }
  return lines;
}

/** Regex-only plan, used when the planner model is unavailable or errors. */
export function fallbackPlan(
  course: CoursePayload,
  instruction: string,
  currentModuleId?: number
): RefinePlan {
  const intent = analyzeRefineIntent(course, instruction);
  const s = instruction.toLowerCase();
  const bulkOps = detectBulkOpsFromText(instruction);

  let targetModuleIds =
    intent.scope.kind === "modules" ? intent.scope.moduleIds : [];

  const onlyBulk = isPureBulk(instruction, bulkOps);

  let strategy: RefineStrategy = "per_module";
  if (onlyBulk) strategy = "bulk";
  else if (/\b(merge|combine|split|reorder|reorganiz|restructur|fewer modules|more modules|number of modules)\b/.test(s))
    strategy = "whole_course";
  else if (/\b(course (title|name|description)|overall description)\b/.test(s))
    strategy = "metadata";

  // Deictic / unscoped edits default to the open module (fast + visible).
  const currentModule =
    typeof currentModuleId === "number"
      ? course.modules.find((m) => m.id === currentModuleId)
      : undefined;
  if (
    targetModuleIds.length === 0 &&
    currentModule &&
    strategyAllowsScoping(strategy) &&
    !mentionsWholeCourse(instruction) &&
    (DEICTIC_RE.test(s) ||
      !/\bmodule|section|lesson|chapter|unit\b/.test(s))
  ) {
    targetModuleIds = [currentModule.id];
  }

  const base = {
    summary: `Applying your request${targetModuleIds.length ? ` to module ${targetModuleIds.join(", ")}` : " across the course"}.`,
    strategy,
    targetModuleIds,
    bulkOps,
    editInstruction: instruction.trim(),
    needsLlm: !onlyBulk,
  };

  return {
    ...base,
    fromFallback: true,
    proposedChanges: defaultProposedChanges(course, instruction, base),
  };
}

/** Deictic edits ("this", "here", "current lesson") with no explicit module. */
const DEICTIC_RE =
  /\b(this|these|current|currently|here|open|above|below|selected|the section|this section|this lesson|this module|this page|this part)\b/;

function mentionsWholeCourse(instruction: string): boolean {
  // Only true "apply everywhere" language should widen scope to all modules.
  // Merely mentioning "the course" (e.g. "delete X from the course") must NOT
  // — that should still scope to the open module so we don't rewrite the world.
  return /\b(all|every|each|entire|whole|everywhere|course[- ]?wide|throughout)\b/.test(
    instruction.toLowerCase()
  );
}

export async function planRefine(
  course: CoursePayload,
  instruction: string,
  currentModuleId?: number
): Promise<RefinePlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPlan(course, instruction, currentModuleId);

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const validIds = new Set(course.modules.map((m) => m.id));
  const currentModule =
    typeof currentModuleId === "number"
      ? course.modules.find((m) => m.id === currentModuleId)
      : undefined;

  const userPrompt = `COURSE OUTLINE (ids + titles + lesson titles only):
${buildOutline(course)}

TOTAL MODULES: ${course.modules.length}
${
  currentModule
    ? `\nCURRENTLY OPEN MODULE: id ${currentModule.id} — "${currentModule.title}"\nIf the request is deictic ("this", "here", "current", "this section/lesson/module") or does not name a module AND does not clearly say the whole course, set targetModuleIds to [${currentModule.id}] (the open module) — do NOT default to all modules.\n`
    : ""
}
STUDENT REQUEST:
${instruction.trim()}

Output the plan JSON now.`;

  try {
    const msg = await anthropic.messages.create({
      model: planModelId(),
      max_tokens: 1024,
      temperature: 0,
      system: PLANNER_SYSTEM,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text")
      return fallbackPlan(course, instruction, currentModuleId);

    const parsed = JSON.parse(stripJsonFence(block.text)) as Record<string, unknown>;

    const bulkOps = [
      ...new Set([
        ...coerceBulkOps(parsed.bulkOps),
        ...detectBulkOpsFromText(instruction),
      ]),
    ];
    let targetModuleIds = coerceModuleIds(parsed.targetModuleIds, validIds);
    // Safety net: if the model missed an explicit "module N", recover it.
    if (targetModuleIds.length === 0) {
      const regexIds = parseTargetModuleIds(instruction, course.modules);
      const broad = /\b(all|every|each|entire|whole)\b/.test(instruction.toLowerCase());
      if (regexIds.length > 0 && !broad) targetModuleIds = regexIds;
    }
    // Deictic / unscoped edits default to the open module, not the whole course,
    // so "shorten this" edits one module (fast + visible) instead of all.
    if (
      targetModuleIds.length === 0 &&
      currentModule &&
      strategyAllowsScoping(coerceStrategy(parsed.strategy)) &&
      !mentionsWholeCourse(instruction) &&
      (DEICTIC_RE.test(instruction.toLowerCase()) ||
        !/\bmodule|section|lesson|chapter|unit\b/.test(
          instruction.toLowerCase()
        ))
    ) {
      targetModuleIds = [currentModule.id];
    }

    const strategy = coerceStrategy(parsed.strategy);
    const editInstruction =
      typeof parsed.editInstruction === "string" && parsed.editInstruction.trim()
        ? parsed.editInstruction.trim()
        : instruction.trim();
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : "Applying your edit.";
    // A pure removal (images/terms/examples with no rewrite verbs) is fully
    // deterministic — never wait on the model, regardless of what it claimed.
    const pureBulk = isPureBulk(instruction, bulkOps);
    const needsLlm = pureBulk
      ? false
      : parsed.needsLlm === false && bulkOps.length > 0
        ? false
        : strategy !== "bulk";

    const base = {
      summary,
      strategy: (!needsLlm && bulkOps.length > 0 ? "bulk" : strategy) as RefineStrategy,
      targetModuleIds,
      bulkOps,
      editInstruction,
      needsLlm,
    };

    return {
      ...base,
      fromFallback: false,
      proposedChanges: coerceProposedChanges(
        parsed.proposedChanges,
        defaultProposedChanges(course, instruction, base)
      ),
    };
  } catch (err) {
    console.warn("[refine-planner] fell back to regex plan", err);
    return fallbackPlan(course, instruction);
  }
}
