import Anthropic from "@anthropic-ai/sdk";
import { parseCourseModule, stripJsonFence } from "@/lib/ai/course-payload";
import {
  assertPayloadStructureMatch,
  mergeSourcesFromCanonical,
  type CourseContentLocale,
} from "@/lib/course-canonical";
import { getPdfAnthropicTimeoutMs } from "@/lib/pdf-route-duration";
import type { CourseModule, CoursePayload } from "@/types/course";

const MODEL = "claude-sonnet-4-6";

function localeLabel(locale: CourseContentLocale): string {
  return locale === "ko" ? "Korean (한국어)" : "English";
}

function translationRules(
  sourceLocale: CourseContentLocale,
  targetLocale: CourseContentLocale
): string {
  return `TRANSLATION RULES (critical):
- Source locale: ${localeLabel(sourceLocale)}. Target locale: ${localeLabel(targetLocale)}.
- Preserve JSON shape exactly: same number of modules, lessons, key_terms, examples, and quiz items.
- Do NOT add, remove, merge, reorder, or split lessons, sections, key terms, examples, or quiz questions.
- Translate natural-language strings only (titles, content, definitions, examples, questions, choices, explanations, reference answers).
- Keep chemical notation, formulas, σ/π, HOMO/LUMO, unit symbols, and numbers identical unless grammar requires a minor particle in ${localeLabel(targetLocale)}.
- Preserve factual claims exactly (e.g. gas colors, wavelengths, numerical values). Do not "correct" facts during translation.
- JSON keys stay in English; string values are in ${localeLabel(targetLocale)}.`;
}

async function translateJsonBlock<T>(
  anthropic: Anthropic,
  prompt: string,
  parse: (raw: unknown) => T
): Promise<T> {
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 12_288,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new Error("Translation model returned no text");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(block.text));
  } catch {
    throw new Error("Translation model returned invalid JSON");
  }
  return parse(parsed);
}

async function translateTitleDescription(
  anthropic: Anthropic,
  canonical: CoursePayload,
  sourceLocale: CourseContentLocale,
  targetLocale: CourseContentLocale
): Promise<{ title: string; description: string }> {
  const prompt = `Translate this course title and description.
${translationRules(sourceLocale, targetLocale)}

Output ONLY JSON: { "title": string, "description": string }

SOURCE:
${JSON.stringify({ title: canonical.title, description: canonical.description })}`;

  return translateJsonBlock(anthropic, prompt, (raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid title block");
    const o = raw as Record<string, unknown>;
    const title = typeof o.title === "string" ? o.title.trim() : "";
    const description =
      typeof o.description === "string" ? o.description.trim() : "";
    if (!title) throw new Error("Missing translated title");
    return { title, description };
  });
}

async function translateModule(
  anthropic: Anthropic,
  module: CourseModule,
  sourceLocale: CourseContentLocale,
  targetLocale: CourseContentLocale
): Promise<CourseModule> {
  const prompt = `Translate this course module JSON to ${localeLabel(targetLocale)}.
${translationRules(sourceLocale, targetLocale)}

Output ONLY JSON: { "module": { ...same schema... } }
Include lessons and quiz arrays with the SAME lengths as the source.

SOURCE MODULE:
${JSON.stringify({ module })}`;

  return translateJsonBlock(anthropic, prompt, (raw) => {
    if (!raw || typeof raw !== "object") throw new Error("Invalid module block");
    const o = raw as Record<string, unknown>;
    const mod = parseCourseModule(o.module);
    if (mod.id !== module.id) {
      return { ...mod, id: module.id };
    }
    return mod;
  });
}

/**
 * Structure-preserving translation of a canonical course payload.
 * Retries the full pass up to `maxAttempts` on structure mismatch.
 */
export async function translateCoursePayload(
  canonical: CoursePayload,
  targetLocale: CourseContentLocale,
  sourceLocale: CourseContentLocale,
  options?: { maxAttempts?: number }
): Promise<CoursePayload> {
  if (targetLocale === sourceLocale) return canonical;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

  const maxAttempts = options?.maxAttempts ?? 3;
  const anthropic = new Anthropic({
    apiKey,
    timeout: getPdfAnthropicTimeoutMs(),
    maxRetries: 0,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const { title, description } = await translateTitleDescription(
        anthropic,
        canonical,
        sourceLocale,
        targetLocale
      );
      const modules: CourseModule[] = [];
      for (const mod of canonical.modules) {
        modules.push(
          await translateModule(anthropic, mod, sourceLocale, targetLocale)
        );
      }
      const translated: CoursePayload = { title, description, modules };
      const withSources = mergeSourcesFromCanonical(canonical, translated);
      assertPayloadStructureMatch(canonical, withSources);
      return withSources;
    } catch (e) {
      lastErr = e;
      console.warn(
        `[translate-course-payload] attempt ${attempt}/${maxAttempts} failed`,
        e
      );
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Course translation failed after retries");
}
