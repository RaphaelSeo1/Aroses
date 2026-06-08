/**
 * Normalize PDF/slide chrome into short, stable topic labels for course
 * outlines. Same upload should always produce the same module/lesson names.
 */

const MAX_TITLE_LEN = 50;

/** Remove PDF extraction noise: PUA glyphs, replacement chars, lone junk tokens. */
export function stripTitleGarbage(raw: string): string {
  let t = raw
    .replace(/[\uE000-\uF8FF\uFFF0-\uFFFF\ufeff]/g, "")
    .replace(/[\u200b-\u200f\u2028\u2029]/g, "")
    .replace(/\ufffd/g, "")
    .replace(/\s+/g, " ")
    .trim();

  t = t
    .split(/\s+/)
    .filter((tok) => {
      if (!tok) return false;
      if (tok.length === 1 && !/[\uac00-\ud7a3A-Za-z0-9]/.test(tok)) return false;
      if (/^[^\uac00-\ud7a3A-Za-z0-9]{1,2}$/.test(tok)) return false;
      return true;
    })
    .join(" ");

  return t.trim();
}

/** Strip chapter headers, slide indices, and footer noise from a raw chunk title. */
export function normalizeIngestDisplayTitle(raw: string): string {
  let t = stripTitleGarbage(raw);
  if (!t) return stripTitleGarbage(raw) || raw.trim();
  t = t.replace(/\s+/g, " ").trim();
  if (!t) return t;

  // Korean chapter chrome: "3장 중추신경계통 약물", "3 장 중추신경계통"
  t = t.replace(
    /^\d+\s*장\s*(?:중추신경계통\s*)?(?:약물\s*)?/i,
    ""
  );
  t = t.replace(/^\d+\s*장\s*[\uac00-\ud7a3\s]{2,24}\s*/i, "");

  // Section index markers from this pharmacology deck: _[2], _ [10]
  t = t.replace(/_?\s*\[\s*\d+\s*\]\s*/g, " ");

  // Leading enumeration: "2. 전신마취제", "3) 수면제"
  t = t.replace(/^\d+[\.\):]\s*/, "");

  // Trailing underscore / page chrome
  t = t.replace(/\s*_\s*$/g, "");
  t = t.replace(/\s*_\s*\[\s*\d+\s*\]\s*$/g, "");

  t = t.replace(/\s+/g, " ").trim();

  // Prefer the substantive segment after a dash when the left side is chrome.
  if (t.length > MAX_TITLE_LEN) {
    const parts = t.split(/\s*[-–—]\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1]!;
      if (last.length >= 3) t = last;
    }
  }

  if (t.length > MAX_TITLE_LEN) {
    t = `${t.slice(0, MAX_TITLE_LEN - 1).trim()}…`;
  }

  return t || raw.trim();
}

const GENERIC_COURSE_TITLE =
  /^(약리학|개요|서론|목차|introduction|overview|course|untitled section)$/i;

const GENERIC_INGEST_PLACEHOLDER =
  /^a (?:structured )?course (?:built )?from your uploaded materials\.?$/i;

/** Boilerplate outline/description text — never use as a user-facing title. */
export function isGenericIngestPlaceholder(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (GENERIC_INGEST_PLACEHOLDER.test(t)) return true;
  if (/^a course built from your uploaded materials\.?$/i.test(t)) return true;
  return false;
}

const GENERIC_INTRO_LESSON =
  /^(약리학|서론|목차|introduction|overview|chapter\s+overview|lecture\s+overview)$/i;

/** Skip generic intro labels when naming a module from its lessons. */
export function substantiveLessonTitles(lessonTitles: string[]): string[] {
  const out: string[] = [];
  for (const raw of lessonTitles) {
    const t = normalizeIngestDisplayTitle(raw);
    if (t.length === 0 || GENERIC_INTRO_LESSON.test(t)) continue;
    if (out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out;
}

/** Stable course title from chunk headings (not LLM prose). */
export function deriveCourseTitleFromChunkTitles(titles: string[]): string {
  const normalized = titles
    .map((t) => normalizeIngestDisplayTitle(t))
    .filter((t) => t.length >= 2);

  const joined = normalized.join(" ");
  if (
    /중추신경|뇌전증|마취|수면제|파킨슨|알츠하이머|항정신|기분장애|진통|마약/i.test(
      joined
    )
  ) {
    return "중추신경계 약물";
  }

  for (const t of normalized) {
    if (!GENERIC_COURSE_TITLE.test(t) && t.length >= 4) {
      return t.length > 60 ? `${t.slice(0, 57).trim()}…` : t;
    }
  }

  const first = normalized[0]?.trim();
  return first && first.length > 0 ? first : "Course";
}

/** Deterministic module label from its lessons (pairs → "A 및 B"). */
export function moduleTitleFromLessonTitles(lessonTitles: string[]): string {
  const titles = lessonTitles
    .map((t) => normalizeIngestDisplayTitle(t))
    .filter((t) => t.length > 0);
  if (titles.length === 0) return "Module";
  if (titles.length === 1) return titles[0]!;

  const substantive = substantiveLessonTitles(titles);
  const pair =
    substantive.length >= 2
      ? substantive.slice(0, 2)
      : substantive.length === 1
        ? [substantive[0]!, titles.find((t) => t !== substantive[0]) ?? titles[0]!]
        : titles.slice(0, 2);

  if (pair.length === 2) {
    if (pair[0] === pair[1]) return pair[0]!;
    const combined = `${pair[0]} 및 ${pair[1]}`;
    if (combined.length <= 40) return combined;
  }
  return substantive[0] ?? titles[0]!;
}
