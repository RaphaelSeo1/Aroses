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

export function isCourseQuantitativeQaEnabled(): boolean {
  const flag = process.env.COURSE_NUMERIC_QA?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
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
  return `You are a quantitative QA auditor for structured course JSON on Aroses.

Your job is to find and **fix** teaching errors in numeric worked examples — not to rewrite unrelated prose.

Check every lesson in this module for:

1. **Arithmetic consistency** — balance-sheet totals must equal the sum of listed accounts; equity effects must match described transactions. If the source material below contains a numeric slip (e.g. transcript says total assets $420 but cash + inventory + PP&E = $320), **teach the correct math ($320)**. Do not propagate source errors into load-bearing examples.

2. **Margin vs markup** — gross profit **margin** = profit ÷ revenue. **Markup** on cost = profit ÷ cost. Never label markup as "gross profit margin" (wrong: 60% margin when profit $30, cost $50, revenue $80 — correct margin is 37.5%).

3. **Journal entry headings** — step labels must name the same debit/credit side as the entry lines shown (if Sales is debited, the heading must say Debit Sales, not Credit Sales).

4. **Multiple net figures** — if net income or net profit appears more than once at different stages (e.g. before vs after depreciation), label each clearly so they are not contradictory.

Rules:
- Return ONLY valid JSON: \`{ "module": { ... } }\` with the **same** module id, lesson count, and lesson titles as input.
- Fix content, examples, key_terms, and quiz questions/reference answers where numbers or labels are wrong.
- Preserve Markdown structure and teaching flow; make minimal edits needed for correctness.
- ${formatOutputLanguageGenerationBlock(outputLanguage)}

--- MODULE JSON ---
${JSON.stringify({ module: mod })}

--- SOURCE MATERIAL (for grounding — may contain errors; prefer correct math) ---
${sourceExcerpt.slice(0, 48_000)}`;
}

/**
 * Post-generation pass: audit one module for arithmetic / accounting consistency.
 * Returns the original module unchanged when QA is disabled, nothing to check, or on failure.
 */
export async function auditModuleQuantitativeConsistency(
  mod: CourseModule,
  sourceExcerpt: string,
  outputLanguage: CourseOutputLanguage
): Promise<CourseModule> {
  if (!isCourseQuantitativeQaEnabled() || !moduleNeedsQuantitativeQa(mod)) {
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
      const parsed = JSON.parse(stripJsonFence(text)) as { module?: unknown };
      if (!parsed.module) return mod;
      const repaired = parseCourseModuleLoose(parsed.module);
      if (repaired.lessons.length !== mod.lessons.length) return mod;
      console.info("[course-quantitative-qa] module audited", {
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

  console.warn("[course-quantitative-qa] audit skipped after error", {
    moduleId: mod.id,
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  return mod;
}
