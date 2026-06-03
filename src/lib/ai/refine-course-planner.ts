import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { stripJsonFence } from "@/lib/ai/course-payload";
import {
  analyzeRefineIntent,
  parseTargetModuleIds,
} from "@/lib/ai/refine-course-intent";
import type { CoursePayload } from "@/types/course";

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
  "needsLlm": boolean                      // false ONLY if bulkOps fully satisfy the request
}

Strategy guide:
- "bulk": purely removing images/key-terms/examples across modules → set bulkOps, needsLlm false.
- "metadata": only the course title/description changes.
- "whole_course": merging/splitting/reordering modules, changing module COUNT, or anything needing a global view.
- "per_module": rewriting/shortening/fixing/retitling lesson or quiz CONTENT (the common case). Set targetModuleIds when the student names modules ("module 2", "the Krebs cycle module"); else [] for all.

Rules:
- If the student names modules by number or topic, resolve them to ids from the outline.
- Combine: e.g. "remove all images and shorten module 3" → bulkOps:["remove_images"], strategy:"per_module", targetModuleIds:[3], needsLlm:true.
- editInstruction must be understandable without the original phrasing.
- Be decisive. Never return an empty plan.`;

function coerceStrategy(v: unknown): RefineStrategy {
  return v === "bulk" || v === "per_module" || v === "whole_course" || v === "metadata"
    ? v
    : "per_module";
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

/** Regex-only plan, used when the planner model is unavailable or errors. */
export function fallbackPlan(
  course: CoursePayload,
  instruction: string
): RefinePlan {
  const intent = analyzeRefineIntent(course, instruction);
  const s = instruction.toLowerCase();
  const bulkOps: RefineBulkOp[] = [];
  const broad =
    /\b(all|every|each|entire|whole|across|in the course|in my course)\b/.test(s);
  const remove = /\b(remove|delete|strip|clear|drop|hide|get rid of|without|no)\b/.test(s);
  if (remove && broad) {
    if (/\b(images?|pictures?|photos?|figures?|diagrams?|illustrations?|visuals?)\b/.test(s))
      bulkOps.push("remove_images");
    if (/\b(key terms?|vocabulary|definitions?|glossary)\b/.test(s))
      bulkOps.push("remove_key_terms");
    if (/\bexamples?\b/.test(s)) bulkOps.push("remove_examples");
  }

  const targetModuleIds =
    intent.scope.kind === "modules" ? intent.scope.moduleIds : [];

  const onlyBulk =
    bulkOps.length > 0 &&
    !/\b(shorten|rewrite|reword|fix|improve|merge|split|add|rename|retitle|quiz|tone|expand|simplify|clarify|content)\b/.test(
      s
    );

  let strategy: RefineStrategy = "per_module";
  if (onlyBulk) strategy = "bulk";
  else if (/\b(merge|combine|split|reorder|reorganiz|restructur|fewer modules|more modules|number of modules)\b/.test(s))
    strategy = "whole_course";
  else if (/\b(course (title|name|description)|overall description)\b/.test(s))
    strategy = "metadata";

  return {
    summary: `Applying your request${targetModuleIds.length ? ` to module ${targetModuleIds.join(", ")}` : " across the course"}.`,
    strategy,
    targetModuleIds,
    bulkOps,
    editInstruction: instruction.trim(),
    needsLlm: !onlyBulk,
    fromFallback: true,
  };
}

export async function planRefine(
  course: CoursePayload,
  instruction: string
): Promise<RefinePlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackPlan(course, instruction);

  const anthropic = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 });
  const validIds = new Set(course.modules.map((m) => m.id));

  const userPrompt = `COURSE OUTLINE (ids + titles + lesson titles only):
${buildOutline(course)}

TOTAL MODULES: ${course.modules.length}

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
    if (!block || block.type !== "text") return fallbackPlan(course, instruction);

    const parsed = JSON.parse(stripJsonFence(block.text)) as Record<string, unknown>;

    const bulkOps = coerceBulkOps(parsed.bulkOps);
    let targetModuleIds = coerceModuleIds(parsed.targetModuleIds, validIds);
    // Safety net: if the model missed an explicit "module N", recover it.
    if (targetModuleIds.length === 0) {
      const regexIds = parseTargetModuleIds(instruction, course.modules);
      const broad = /\b(all|every|each|entire|whole)\b/.test(instruction.toLowerCase());
      if (regexIds.length > 0 && !broad) targetModuleIds = regexIds;
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
    const needsLlm =
      parsed.needsLlm === false && bulkOps.length > 0 ? false : strategy !== "bulk";

    return {
      summary,
      strategy: bulkOps.length > 0 && !needsLlm ? "bulk" : strategy,
      targetModuleIds,
      bulkOps,
      editInstruction,
      needsLlm,
      fromFallback: false,
    };
  } catch (err) {
    console.warn("[refine-planner] fell back to regex plan", err);
    return fallbackPlan(course, instruction);
  }
}
