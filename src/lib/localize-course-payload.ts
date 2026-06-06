import { translateCoursePayload } from "@/lib/ai/translate-course-payload";
import {
  assertPayloadStructureMatch,
  computeContentSourceKey,
  mergeSourcesFromCanonical,
  resolveCanonicalAndDisplayLocales,
  type CourseContentLocale,
} from "@/lib/course-canonical";
import type { CourseOutputLanguage } from "@/lib/course-output-language";
import type { CourseOutlinePayload } from "@/lib/ai/course-payload";
import type { CourseModule, CoursePayload } from "@/types/course";

export function coursePayloadToOutline(
  payload: CoursePayload
): CourseOutlinePayload {
  return {
    title: payload.title,
    description: payload.description,
    modules: payload.modules.map((m) => ({
      id: m.id,
      title: m.title,
      lesson_titles: m.lessons.map((l) => l.title),
    })),
  };
}

export type LocalizedCourseMaterial = {
  canonical: CoursePayload;
  display: CoursePayload;
  baseLocale: CourseContentLocale;
  displayLocale: CourseContentLocale;
  contentSourceKey: string;
};

export function outlineAndModulesToPayload(
  outline: CourseOutlinePayload,
  modules: CourseModule[]
): CoursePayload {
  return {
    title: outline.title,
    description: outline.description,
    modules,
  };
}

/**
 * Build canonical (source-language) and display (user-selected) payloads.
 * When locales differ, display is produced by translation — not regeneration.
 */
export async function buildLocalizedCourseMaterial(
  outline: CourseOutlinePayload,
  modules: CourseModule[],
  sourceText: string,
  originalFileName: string | null | undefined,
  outputLanguage: CourseOutputLanguage
): Promise<LocalizedCourseMaterial> {
  const { canonicalLocale, displayLocale } = resolveCanonicalAndDisplayLocales(
    outputLanguage,
    sourceText
  );
  const canonical = outlineAndModulesToPayload(outline, modules);
  const contentSourceKey = computeContentSourceKey(
    sourceText,
    originalFileName
  );

  if (displayLocale === canonicalLocale) {
    return {
      canonical,
      display: canonical,
      baseLocale: canonicalLocale,
      displayLocale,
      contentSourceKey,
    };
  }

  const translated = await translateCoursePayload(
    canonical,
    displayLocale,
    canonicalLocale
  );
  const display = mergeSourcesFromCanonical(canonical, translated);
  assertPayloadStructureMatch(canonical, display);

  return {
    canonical,
    display,
    baseLocale: canonicalLocale,
    displayLocale,
    contentSourceKey,
  };
}

/** Reuse an existing canonical row; translate only if the new upload needs another locale. */
export async function displayPayloadFromExistingCanonical(
  canonical: CoursePayload,
  baseLocale: CourseContentLocale,
  outputLanguage: CourseOutputLanguage,
  sourceText: string,
  originalFileName?: string | null
): Promise<LocalizedCourseMaterial> {
  const { displayLocale } = resolveCanonicalAndDisplayLocales(
    outputLanguage,
    sourceText
  );
  const contentSourceKey = computeContentSourceKey(
    sourceText,
    originalFileName
  );

  if (displayLocale === baseLocale) {
    return {
      canonical,
      display: canonical,
      baseLocale,
      displayLocale,
      contentSourceKey,
    };
  }

  const translated = await translateCoursePayload(
    canonical,
    displayLocale,
    baseLocale
  );
  const display = mergeSourcesFromCanonical(canonical, translated);
  assertPayloadStructureMatch(canonical, display);

  return {
    canonical,
    display,
    baseLocale,
    displayLocale,
    contentSourceKey,
  };
}
