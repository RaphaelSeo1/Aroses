import { createHash } from "node:crypto";
import type { CourseOutputLanguage } from "@/lib/course-output-language";
import type { CoursePayload } from "@/types/course";

/** Locales we generate / translate course content into. */
export type CourseContentLocale =
  | "en"
  | "ko"
  | "es"
  | "fr"
  | "ja"
  | "zh";

export function courseContentLocaleToOutputLanguage(
  locale: CourseContentLocale
): CourseOutputLanguage {
  return locale;
}

/** Rough primary-language detection from extracted upload text. */
export function detectSourceLocaleFromText(text: string): CourseContentLocale {
  const sample = text.slice(0, 14_000);
  let hangul = 0;
  let hiraganaKatakana = 0;
  let cjkOther = 0;
  let latin = 0;
  for (const ch of sample) {
    const c = ch.charCodeAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) hangul++;
    else if (
      (c >= 0x3040 && c <= 0x309f) ||
      (c >= 0x30a0 && c <= 0x30ff)
    ) {
      hiraganaKatakana++;
    } else if (c >= 0x4e00 && c <= 0x9fff) cjkOther++;
    else if (
      (c >= 65 && c <= 90) ||
      (c >= 97 && c <= 122)
    ) {
      latin++;
    }
  }
  if (hangul > 80 && hangul > latin * 0.12) return "ko";
  if (hiraganaKatakana > 40 && hiraganaKatakana > hangul) return "ja";
  if (cjkOther > 120 && hangul < 40 && hiraganaKatakana < 40) return "zh";
  return "en";
}

/**
 * Canonical content is always generated in the source material's primary language.
 * Display locale follows the user's upload picker (`en` / `ko` / `auto`).
 */
export function resolveCanonicalAndDisplayLocales(
  outputLanguage: CourseOutputLanguage,
  sourceText: string
): {
  canonicalLocale: CourseContentLocale;
  displayLocale: CourseContentLocale;
} {
  const canonicalLocale = detectSourceLocaleFromText(sourceText);
  let displayLocale: CourseContentLocale;
  if (outputLanguage === "auto") displayLocale = canonicalLocale;
  else displayLocale = outputLanguage;
  return { canonicalLocale, displayLocale };
}

/** Stable key so duplicate uploads of the same file share one canonical payload. */
export function computeContentSourceKey(
  sourceText: string,
  originalFileName: string | null | undefined
): string {
  const normName = (originalFileName ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const sample = sourceText.trim().slice(0, 12_000);
  return createHash("sha256")
    .update(normName)
    .update("\0")
    .update(sample)
    .digest("hex");
}

export type PayloadStructureFingerprint = {
  moduleCount: number;
  modules: {
    lessonCount: number;
    keyTermCounts: number[];
    exampleCounts: number[];
    quizCount: number;
  }[];
};

export function payloadStructureFingerprint(
  payload: CoursePayload
): PayloadStructureFingerprint {
  return {
    moduleCount: payload.modules.length,
    modules: payload.modules.map((m) => ({
      lessonCount: m.lessons.length,
      keyTermCounts: m.lessons.map((l) => l.key_terms.length),
      exampleCounts: m.lessons.map((l) => l.examples.length),
      quizCount: m.quiz.length,
    })),
  };
}

export class CoursePayloadStructureMismatchError extends Error {
  constructor(
    message: string,
    readonly details?: { canonical: PayloadStructureFingerprint; other: PayloadStructureFingerprint }
  ) {
    super(message);
    this.name = "CoursePayloadStructureMismatchError";
  }
}

/** Fail when translated payload drifts from canonical structure. */
export function assertPayloadStructureMatch(
  canonical: CoursePayload,
  other: CoursePayload
): void {
  const a = payloadStructureFingerprint(canonical);
  const b = payloadStructureFingerprint(other);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new CoursePayloadStructureMismatchError(
      "Translated course structure does not match canonical (lesson/term/quiz counts differ).",
      { canonical: a, other: b }
    );
  }

  for (let mi = 0; mi < canonical.modules.length; mi++) {
    const cMod = canonical.modules[mi]!;
    const oMod = other.modules[mi]!;
    for (let li = 0; li < cMod.lessons.length; li++) {
      const cSources = cMod.lessons[li]?.sources ?? [];
      const oSources = oMod.lessons[li]?.sources ?? [];
      if (JSON.stringify(cSources) !== JSON.stringify(oSources)) {
        throw new CoursePayloadStructureMismatchError(
          `Lesson source attribution mismatch at module ${mi + 1} lesson ${li + 1}.`
        );
      }
    }
  }
}

/** Source locators are language-neutral — always copy from canonical after translate. */
export function mergeSourcesFromCanonical(
  canonical: CoursePayload,
  translated: CoursePayload
): CoursePayload {
  return {
    ...translated,
    modules: translated.modules.map((mod, mi) => ({
      ...mod,
      lessons: mod.lessons.map((les, li) => ({
        ...les,
        sources: canonical.modules[mi]?.lessons[li]?.sources ?? les.sources,
        visual_assets:
          canonical.modules[mi]?.lessons[li]?.visual_assets ?? les.visual_assets,
      })),
    })),
  };
}
