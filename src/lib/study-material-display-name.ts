import type { CoursePayload } from "@/types/course";

const INVALID_FILENAME_CHARS = /[/\\?%*:|"<>]/g;

/**
 * Trailing document / image extensions often appear on uploads or in model output.
 * Strip them so stored names read as section titles, not filenames.
 */
const DOCUMENT_EXTENSION =
  /\.(pdf|docx?|pptx?|xlsx?|txt|rtf|md|pages|key|numbers|png|jpe?g|gif|webp|heic|svg|csv|tsv|zip|rar|7z)$/i;

export function stripKnownDocumentExtension(name: string): string {
  let s = name.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(DOCUMENT_EXTENSION, "").trim();
  }
  return s;
}

/** Shown in the UI; legacy rows may still end in `.pdf` — normalize for display. */
export function displayMaterialSectionLabel(stored: string): string {
  const t = stored.trim();
  if (!t) return t;
  const d = stripKnownDocumentExtension(t);
  return d.length > 0 ? d : t;
}

/** Store-safe section label: no file extension, safe characters, length cap. */
export function finalizeMaterialSectionLabel(
  raw: string,
  maxLen = 240
): string {
  const withoutExt = stripKnownDocumentExtension(raw);
  return sanitizeFileStem(withoutExt, maxLen);
}

/** Strip unsafe characters and collapse whitespace for use in a filename stem. */
export function sanitizeFileStem(raw: string, maxLen: number): string {
  const s = raw
    .replace(INVALID_FILENAME_CHARS, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen)
    .trim();
  return s;
}

function stemCandidate(raw: string, maxLen = 180): string | null {
  const t = sanitizeFileStem(raw, maxLen);
  const stripped = stripKnownDocumentExtension(t);
  return stripped.length > 0 ? stripped : null;
}

const GENERIC_TITLE_LINE =
  /^(introduction|overview|welcome|background|preface|foreword|summary|conclusions?|references?|acknowledgements?|table of contents)\b/i;

const GENERIC_LECTURE_NUM = /^lecture\s*\d+\b/i;

function firstDescriptionLine(desc: string): string | null {
  const line = desc.split(/\r?\n+/)[0]?.trim() ?? "";
  if (line.length < 16 || line.length > 220) return null;
  const noHash = line.replace(/^#+\s*/, "").trim();
  return noHash.length >= 16 ? noHash : null;
}

function scoreStemForMaterialLabel(stem: string, sourceIndex: number): number {
  let score = Math.min(100, stem.length);
  if (GENERIC_TITLE_LINE.test(stem)) score -= 42;
  if (GENERIC_LECTURE_NUM.test(stem)) score -= 18;
  if (/^week\s*\d+\b/i.test(stem)) score -= 6;
  // Later candidates (module 1+, second lesson) tend to be the concrete lecture topic.
  score += Math.min(24, sourceIndex * 3);
  return score;
}

/**
 * Collect possible labels from generated course JSON (order = rough priority before scoring).
 */
function collectPayloadTitleCandidates(p: Partial<CoursePayload>): string[] {
  const raw: string[] = [];
  const mods = p.modules ?? [];
  for (let i = 0; i < Math.min(mods.length, 6); i++) {
    const mod = mods[i];
    if (mod && typeof mod.title === "string") raw.push(mod.title);
    const l0 = mod?.lessons?.[0];
    if (l0 && typeof l0.title === "string") raw.push(l0.title);
  }
  if (typeof p.title === "string") raw.push(p.title);
  if (typeof p.description === "string") {
    const fl = firstDescriptionLine(p.description);
    if (fl) raw.push(fl);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const k = r.trim().toLowerCase();
    if (k.length < 3 || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

/**
 * Pick a human-readable base name from the generated course (built from PDF text).
 * Chooses the strongest candidate among module titles, lesson titles, course title, and
 * the first line of the course description (slide-style courses often repeat a broad
 * course title across uploads; module titles are usually more specific).
 */
export function deriveFileStemFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<CoursePayload>;
  const candidates = collectPayloadTitleCandidates(p);

  let best: string | null = null;
  let bestScore = -Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const stem = stemCandidate(candidates[i], 200);
    if (!stem) continue;
    const sc = scoreStemForMaterialLabel(stem, i);
    if (sc > bestScore) {
      bestScore = sc;
      best = stem;
    }
  }
  return best;
}

/** Full stored label from course payload, or null if nothing usable. */
export function suggestMaterialLabelFromPayload(payload: unknown): string | null {
  const stem = deriveFileStemFromPayload(payload);
  if (!stem) return null;
  return finalizeMaterialSectionLabel(stem, 240);
}

/** @deprecated Stored labels are section titles without `.pdf`; use finalizeMaterialSectionLabel. */
export function stemToPdfFileName(stem: string): string {
  return finalizeMaterialSectionLabel(stem.replace(/\.pdf$/i, ""));
}

const MAX_SECTION_LABEL_LEN = 240;
/** Room so ` (2)` … ` (99)` is never truncated off the end. */
const DEDUPE_SUFFIX_RESERVE = 12;

/** Resolve collisions when two builds derive the same title (e.g. two "Week 3"). */
export function dedupeSectionLabels(stems: string[]): string[] {
  const seenCount = new Map<string, number>();
  const out: string[] = [];
  const stemCap = MAX_SECTION_LABEL_LEN - DEDUPE_SUFFIX_RESERVE;

  for (const stem of stems) {
    const cleaned = finalizeMaterialSectionLabel(stem, stemCap);
    const key = cleaned.toLowerCase();
    const n = seenCount.get(key) ?? 0;
    seenCount.set(key, n + 1);
    const disambiguated =
      n === 0 ? cleaned : `${cleaned} (${n + 1})`;
    out.push(finalizeMaterialSectionLabel(disambiguated, MAX_SECTION_LABEL_LEN));
  }

  return out;
}

/** @deprecated Use dedupeSectionLabels */
export const dedupePdfStemNames = dedupeSectionLabels;
