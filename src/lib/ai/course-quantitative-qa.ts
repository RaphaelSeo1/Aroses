import Anthropic from "@anthropic-ai/sdk";
import {
  APIConnectionError,
  APIError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { parseCourseModuleLoose, stripJsonFence } from "@/lib/ai/course-payload";
import type { CourseOutputLanguage } from "@/lib/course-output-language";
import { formatOutputLanguageGenerationBlock } from "@/lib/course-output-language";
import { getPdfAnthropicTimeoutMs } from "@/lib/pdf-route-duration";
import type { CourseModule } from "@/types/course";

const QA_SIGNAL =
  /(\$\s?\d|(?:\d[\d,]*\.?\d*)\s*%|gross\s+(?:profit\s+)?margin|markup|debit|credit|retained earnings|balance sheet|net income|total assets|equity|journal entr|closing entr|income statement|contra-asset|accumulated depreciation)/i;

function resolveQaModel(): string {
  const override = process.env.ANTHROPIC_COURSE_QA_MODEL?.trim();
  if (override) return override;
  return "claude-haiku-4-5";
}

type CourseBuildProfile = "express" | "fast" | "balanced" | "full";

export function isCourseQuantitativeQaEnabled(
  profile?: CourseBuildProfile
): boolean {
  const flag = process.env.COURSE_NUMERIC_QA?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  // Speed/cost: only run the extra audit pass by default on the deepest profile.
  if (profile && profile !== "full") return false;
  return true;
}

/** Skip QA when lesson bodies have no numbers / accounting vocabulary. */
export function moduleNeedsQuantitativeQa(mod: CourseModule): boolean {
  const blob = [
    mod.title,
    ...mod.lessons.flatMap((l) => [
      l.title,
      l.content,
      ...(l.examples ?? []),
    ]),
    ...mod.quiz.map((q) => q.question),
  ].join("\n");
  return QA_SIGNAL.test(blob);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

function isRetryableApiError(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  if (err instanceof APIConnectionError) return true;
  if (err instanceof APIError && typeof err.status === "number") {
    return [408, 429, 500, 502, 503, 529].includes(err.status);
  }
  return false;
}

function extractTextBlock(msg: Anthropic.Message): string {
  const block = msg.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

function buildQaInstruction(
  mod: CourseModule,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage
): string {
  return `You are a source-fidelity QA auditor for structured course JSON on Aroses.

Your job is to remove content the model **invented or editorialized** — NOT to correct the source's math. The source material below is authoritative even where it appears wrong; a separate disclaimer already warns students that AI-generated content may contain mistakes. Do not second-guess the source.

Check every lesson in this module and fix ONLY these problems:

1. **Fabricated figures, tables, or worked examples** — Remove any computed value, total, balance sheet, journal entry, table, or worked example that does NOT appear in the source material below and is not directly and unambiguously derivable from numbers the source gives. Do NOT recompute or "correct" the source's numbers: if the source states a figure, keep it exactly as stated even if it does not balance. If the source never works a calculation through, delete the model's invented calculation rather than fixing it.

2. **Self-referential / editorializing commentary** — Delete first-person hedging, doubt, or narration of reasoning (e.g. "Wait—this doesn't balance", "hmm", "let me reconsider", "it seems", "as an AI"). Also delete invented explanations the model added to justify a discrepancy (e.g. claiming "we haven't recorded depreciation" to cover a gap the source never discussed).

3. **Mislabeled source figures** — Only when the source itself supplies BOTH the number and its label, keep them paired as the source gives them (e.g. do not relabel a source "markup" as "margin"). Never change a number to make a label fit, and never introduce a figure the source lacks.

Rules:
- Return ONLY valid JSON: \`{ "module": { ... } }\` with the **same** module id, lesson count, and lesson titles as input.
- Make MINIMAL edits: delete fabricated or editorialized spans; otherwise preserve the source's framing, figures, Markdown structure, and teaching flow verbatim.
- Never add new figures, tables, or corrections of your own.
- ${formatOutputLanguageGenerationBlock(outputLanguage)}

--- MODULE JSON ---
${JSON.stringify({ module: mod })}

--- SOURCE MATERIAL (authoritative — reproduce faithfully, even where it appears to contain errors) ---
${sourceExcerpt.slice(0, 48_000)}`;
}

/**
 * Post-generation pass: audit one module for SOURCE FIDELITY — strip figures,
 * tables, and worked examples the model fabricated (not present in / derivable
 * from the source) and remove self-referential or editorializing commentary.
 * It does NOT recompute or "correct" the source's own numbers.
 * Returns the original module unchanged when QA is disabled, nothing to check, or on failure.
 */
export async function auditModuleQuantitativeConsistency(
  mod: CourseModule,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage,
  profile: CourseBuildProfile = "full"
): Promise<CourseModule> {
  if (!isCourseQuantitativeQaEnabled(profile) || !moduleNeedsQuantitativeQa(mod)) {
    return mod;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return mod;

  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  const instruction = buildQaInstruction(mod, sourceExcerpt, outputLanguage);
  let lastErr: unknown;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const msg = await anthropic.messages.create({
        model: resolveQaModel(),
        max_tokens: 16_384,
        temperature: 0.1,
        messages: [{ role: "user", content: instruction }],
      });
      const text = extractTextBlock(msg);
      // Tolerate stray prose around the JSON by extracting the first balanced
      // brace block, so a model that appends commentary after the JSON object
      // doesn't make us skip the whole audit.
      const cleaned = stripJsonFence(text).trim();
      const objStart = cleaned.indexOf("{");
      const objEnd = cleaned.lastIndexOf("}");
      const jsonSlice =
        objStart >= 0 && objEnd > objStart
          ? cleaned.slice(objStart, objEnd + 1)
          : cleaned;
      const parsed = JSON.parse(jsonSlice) as { module?: unknown };
      if (!parsed.module) return mod;
      const repaired = parseCourseModuleLoose(parsed.module);
      if (repaired.lessons.length !== mod.lessons.length) return mod;
      console.info("[course-fidelity-qa] module audited", {
        moduleId: mod.id,
        title: mod.title,
      });
      return { ...repaired, id: mod.id, title: mod.title };
    } catch (err) {
      lastErr = err;
      if (!isRetryableApiError(err) || attempt >= 2) break;
      await sleep(1200 * 2 ** attempt);
    }
  }

  console.warn("[course-fidelity-qa] audit skipped after error", {
    moduleId: mod.id,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  return mod;
}
