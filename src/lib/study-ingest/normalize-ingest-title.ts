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

  // Leading enumeration: "2. 전신마취제", "3) 수면제", "1.2 Foo"
  t = t.replace(/^\d+(?:\.\d+)*[\.\):]\s*/, "");

  // Bare leading section number with no punctuation: "1 Institutional
  // Background" → "Institutional Background". Restricted to 1–2 digits so years
  // and data figures ("2024 Results", "10-K Filings") are left intact.
  t = t.replace(/^\d{1,2}\s+(?=[A-Za-z\uac00-\ud7a3])/, "");

  // Lecture/chapter/week chrome prefix when a real topic follows:
  // "Lecture 1: Introduction to the Annual Report" → "Introduction to the
  // Annual Report", "Chapter 2 - Bonding" → "Bonding". Bare "Lecture 3"
  // (no topic after the number) is left alone and rejected by isBadIngestTitle.
  t = t.replace(
    /^(?:lecture|lesson|chapter|week|unit|session|topic|module|part)\s+[0-9ivxlc]+\s*[:.\-–—]\s*(?=\S)/i,
    ""
  );

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

  t = titleCaseIfAllCaps(t);

  return t || raw.trim();
}

const SPEAKER_PREFIX = /^[A-Z][A-Z0-9\s.'-]{2,48}:\s*/;
const SECTION_PLACEHOLDER = /^section\s+\d+(?:\s*[§-]\s*\d+)?$/i;
// Bare enumeration headings that name nothing ("Lecture 3", "Chapter II").
// "Part/Page/Slide/Section N" are intentional positional fallbacks elsewhere.
const BARE_ENUM_TITLE =
  /^(?:lecture|lesson|chapter|week|unit|session|topic|module)\s+[0-9ivxlc]+$/i;
const TRANSCRIPT_FRAGMENT =
  /\b(that's|we're|you're|going to|let's|when you|where we|what we|what they|what you|so what|i'm|don't|isn't|aren't|gonna|we'll|you'll|i'll|because|although|however|haven't|hasn't|didn't|won't|wouldn't)\b/i;
const INCOMPLETE_PHRASE =
  /\b(haven't|hasn't|didn't|won't|wouldn't|couldn't|shouldn't|isn't|aren't|wasn't|weren't)\s*$/i;
const SPOKEN_CLAUSE =
  /\.\s+(?:So |And |But |What |When |Where |If |Then |Now |Okay |Ok )/i;
const VERB_LED_TITLE =
  /^(learn|understand|explore|master|discover|study|review|cover|introduce|explain|deep dive into)\b/i;
const VERBOSE_TITLE_OPENER =
  /^(core concepts|key principles|structure and interpretation|learn how|a comprehensive guide|an introduction to)\b/i;
const WEAK_MODULE_TITLE =
  /^(introduction|overview|module|core concepts|part\s+\d+|section\s+\d+|page\s+\d+|slide\s+\d+)$/i;
const UPLOAD_FILE_EXT =
  /\.(pdf|docx?|pptx?|xlsx?|txt|rtf|md|pages|key|numbers|png|jpe?g|gif|webp|heic|svg|csv|tsv|zip|rar|7z)$/i;

const GENERIC_COURSE_TITLE =
  /^(약리학|개요|서론|목차|introduction|overview|course|untitled section)$/i;

const GENERIC_INGEST_PLACEHOLDER =
  /^a (?:structured )?course (?:built )?from your uploaded materials\.?$/i;

const GENERIC_INTRO_LESSON =
  /^(약리학|서론|목차|introduction|overview|chapter\s+overview|lecture\s+overview)$/i;

/** Boilerplate outline/description text — never use as a user-facing title. */
export function isGenericIngestPlaceholder(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (GENERIC_INGEST_PLACEHOLDER.test(t)) return true;
  if (/^a course built from your uploaded materials\.?$/i.test(t)) return true;
  return false;
}

/** True when a title reads like a sentence/LLM blurb, not a short topic label. */
export function isSentenceLikeIngestTitle(raw: string): boolean {
  const t = normalizeIngestDisplayTitle(raw).trim();
  if (!t) return true;
  if (t.length > 52) return true;
  if (t.split(/\s+/).length > 9) return true;
  if (VERB_LED_TITLE.test(t)) return true;
  if (VERBOSE_TITLE_OPENER.test(t)) return true;
  return false;
}

/** True when raw text should not become a module/lesson label in the sidebar. */
export function isBadIngestTitle(raw: string): boolean {
  const t = normalizeIngestDisplayTitle(raw).trim();
  if (!t) return true;
  if (/^\d+$/.test(t)) return true;
  if (t.length === 1) return true;
  if (t.length === 2 && !/^[\uac00-\ud7a3]{2}$/.test(t)) return true;
  if (SECTION_PLACEHOLDER.test(t)) return true;
  if (BARE_ENUM_TITLE.test(t)) return true;
  if (/^untitled section$/i.test(t)) return true;
  if (SPEAKER_PREFIX.test(t)) return true;
  if (/^[A-Z][A-Z0-9\s.'-]{2,48}:$/.test(t)) return true;
  if (TRANSCRIPT_FRAGMENT.test(t)) return true;
  if (INCOMPLETE_PHRASE.test(t)) return true;
  if (SPOKEN_CLAUSE.test(t)) return true;
  if (isSentenceLikeIngestTitle(t)) return true;
  // Incomplete spoken lists: "company's assets, liabilities,"
  if (/,\s*$/.test(t)) return true;
  if (/^[a-z][a-z'-]*['']s\s+/i.test(t) && /,/.test(t)) return true;
  // Leftover file-extension fragments: "… (1).txt 2 mo…"
  if (UPLOAD_FILE_EXT.test(t) || /\.(pdf|docx?|pptx?|txt|rtf|md)\b/i.test(t)) {
    return true;
  }
  // Multiple clauses in a label usually means spoken transcript, not a heading.
  if (t.includes(".") && t.split(/\.\s+/).length >= 2 && t.length < 72) return true;
  // Spoken lecture lines — lowercase prose, not headings.
  if (
    t.length > 28 &&
    /^[a-z]/.test(t) &&
    /\b(the|and|or|to|a|an|is|are|was|were|of|in|on|for|that|this|with|we|you|what|so|up|goes)\b/i.test(
      t
    )
  ) {
    return true;
  }
  // Lowercase-first, multi-word labels are almost always transcript fragments
  // ("transaction ultimately increased retained"), not real headings.
  if (/^[a-z]/.test(t) && t.split(/\s+/).length >= 4) return true;
  return false;
}

/** Module/lesson placeholder labels that should not repeat across a course. */
export function isWeakModuleTitle(raw: string): boolean {
  const t = normalizeIngestDisplayTitle(raw).trim();
  if (!t) return true;
  if (WEAK_MODULE_TITLE.test(t)) return true;
  if (GENERIC_INTRO_LESSON.test(t)) return true;
  if (isBadIngestTitle(t)) return true;
  return false;
}

function partLabelFromPosition(position?: string): string | null {
  const p = position?.trim();
  if (!p) return null;
  const part = p.match(/\b(?:transcript part|section|part)\s+(\d+)/i);
  if (part) return `Part ${part[1]}`;
  return null;
}

function titleCaseIfAllCaps(raw: string): string {
  const t = raw.trim();
  if (t.length < 4 || t.length > 60) return t;
  const words = t.split(/\s+/);
  if (words.length === 0 || words.length > 10) return t;
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length < 3) return t;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  if (upper / letters.length < 0.82) return t;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function titleFromPosition(position?: string): string | null {
  const fromPart = partLabelFromPosition(position);
  if (fromPart) return fromPart;
  const p = position?.trim();
  if (!p || SECTION_PLACEHOLDER.test(p)) return null;
  const page = p.match(/\bpage\s+(\d+)/i);
  if (page) return `Page ${page[1]}`;
  const slide = p.match(/\bslide\s+(\d+)/i);
  if (slide) return `Slide ${slide[1]}`;
  return null;
}

/**
 * Pick the best short heading from chunk text — skips speaker lines and
 * transcript fragments that used to become lesson titles.
 */
export function pickBestTitleFromText(
  text: string,
  position?: string
): string {
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
    .filter((l) => l.length > 0);

  let best: { title: string; score: number } | null = null;
  for (const line of lines.slice(0, 24)) {
    if (line.length > 90) continue;
    const title = normalizeIngestDisplayTitle(line);
    if (isBadIngestTitle(title)) continue;

    let score = 0;
    if (/^lecture\s*\d/i.test(title)) score += 3;
    if (/^\d+[\.\):]\s/.test(line)) score += 5;
    if (title.split(/\s+/).length <= 7) score += 2;
    if (line.length <= 48) score += 2;
    if (/^[A-Z0-9]/.test(title) && !TRANSCRIPT_FRAGMENT.test(title)) score += 1;

    if (!best || score > best.score) best = { title, score };
  }

  if (best) return best.title;

  const fromPos = titleFromPosition(position);
  if (fromPos) return fromPos;

  return "Part 1";
}

/** Ensure lesson titles within one module are distinct and readable. */
export function polishLessonTitlesForModule(
  lessonTitles: string[],
  _moduleTitle?: string
): string[] {
  void _moduleTitle;
  const used = new Set<string>();

  return lessonTitles.map((raw, i) => {
    let title = normalizeIngestDisplayTitle(raw);
    if (isBadIngestTitle(title)) {
      title = `Part ${i + 1}`;
    }

    const key = title.toLowerCase();
    if (used.has(key)) {
      title = `${title} (${i + 1})`;
    }

    used.add(title.toLowerCase());
    return title;
  });
}

/** Skip generic intro labels when naming a module from its lessons. */
export function substantiveLessonTitles(lessonTitles: string[]): string[] {
  const out: string[] = [];
  for (const raw of lessonTitles) {
    const t = normalizeIngestDisplayTitle(raw);
    if (t.length === 0 || GENERIC_INTRO_LESSON.test(t)) continue;
    if (isBadIngestTitle(t)) continue;
    if (out[out.length - 1] === t) continue;
    out.push(t);
  }
  return out;
}

/** Stable course title from chunk headings (not LLM prose). */
export function deriveCourseTitleFromChunkTitles(titles: string[]): string {
  const normalized = titles
    .map((t) => normalizeIngestDisplayTitle(t))
    .filter((t) => t.length >= 2 && !isBadIngestTitle(t));

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

/**
 * Turn an upload filename into a short course title
 * (e.g. "EN-INTRODUCTION TO THE INCOME STATEMENT (1).TXT" → "Introduction To The Income Statement").
 */
export function deriveTitleFromUploadFileName(fileName: string): string | null {
  let base = (fileName.split(/[/\\]/).pop() ?? fileName).trim();
  if (!base) return null;
  // Multi-file uploads arrive as a combined label, e.g. "lecture.txt + 2 more"
  // or "lecture.txt, notes.pdf" — keep only the first file's name.
  base = base.replace(/\s*[+,]\s*\d+\s*more\b.*$/i, "").trim();
  base = base.split(/\s*,\s*/)[0]!.trim();
  // An extension may now sit mid-string ("lecture.txt + 2 more" → "lecture.txt").
  base = base.replace(new RegExp(`${UPLOAD_FILE_EXT.source}.*$`, "i"), "").trim();
  let stem = base;
  let prev = "";
  while (stem !== prev) {
    prev = stem;
    stem = stem.replace(UPLOAD_FILE_EXT, "").trim();
  }
  stem = stem.replace(/\s*[\(\[]\s*\d+\s*[\)\]]\s*$/g, "").trim();
  stem = stem.replace(/^[A-Z]{2,3}[-_\s]+(?=[A-Za-z])/i, "");
  stem = stem.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  stem = normalizeIngestDisplayTitle(stem);
  if (!stem || stem.length < 4) return null;
  if (GENERIC_COURSE_TITLE.test(stem)) return null;
  if (isGenericIngestPlaceholder(stem)) return null;
  if (/,\s*$/.test(stem)) return null;
  if (TRANSCRIPT_FRAGMENT.test(stem)) return null;
  if (VERBOSE_TITLE_OPENER.test(stem)) return null;
  return stem;
}

/** Pick the best course title from plan text, chunk headings, and upload names. */
export function resolveCourseDisplayTitle(input: {
  planTitle?: string | null;
  chunkTitles?: string[];
  uploadFileNames?: string[];
}): string {
  const plan = input.planTitle?.trim();
  if (
    plan &&
    !isGenericIngestPlaceholder(plan) &&
    !isBadIngestTitle(plan)
  ) {
    return normalizeIngestDisplayTitle(plan);
  }
  for (const fileName of input.uploadFileNames ?? []) {
    const fromFile = deriveTitleFromUploadFileName(fileName);
    if (fromFile) return fromFile;
  }
  return deriveCourseTitleFromChunkTitles(input.chunkTitles ?? []);
}

function disambiguateModuleTitle(title: string, index: number, used: Set<string>): string {
  let out = title;
  const key = out.toLowerCase();
  if (!used.has(key)) {
    used.add(key);
    return out;
  }
  out = `${title} (${index + 1})`;
  used.add(out.toLowerCase());
  return out;
}

export { disambiguateModuleTitle };

const HANGUL = /[\uac00-\ud7a3]/;

/**
 * Join two topic labels with a connector that matches their script:
 * Korean pairs read "A 및 B", everything else reads "A & B". This prevents
 * Korean chrome from leaking into English (or other Latin-script) titles.
 */
function joinTopicPair(a: string, b: string): string {
  const connector = HANGUL.test(a) && HANGUL.test(b) ? "및" : "&";
  return `${a} ${connector} ${b}`;
}

/** Deterministic module label from its lessons (pairs → "A & B" / "A 및 B"). */
export function moduleTitleFromLessonTitles(lessonTitles: string[]): string {
  const titles = lessonTitles
    .map((t) => normalizeIngestDisplayTitle(t))
    .filter(
      (t) =>
        t.length > 0 &&
        !isBadIngestTitle(t) &&
        !GENERIC_INTRO_LESSON.test(t)
    );
  if (titles.length === 0) {
    const fallback = lessonTitles
      .map((t) => normalizeIngestDisplayTitle(t))
      .filter((t) => t.length > 0 && !isBadIngestTitle(t));
    if (fallback.length > 0) return fallback[0]!;
    return "Module";
  }
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
    const combined = joinTopicPair(pair[0]!, pair[1]!);
    if (combined.length <= 40) return combined;
  }
  return substantive[0] ?? titles[0]!;
}
