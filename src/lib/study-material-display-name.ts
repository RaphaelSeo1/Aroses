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

function stemCandidate(raw: string): string | null {
  const t = sanitizeFileStem(raw, 180);
  const stripped = stripKnownDocumentExtension(t);
  return stripped.length > 0 ? stripped : null;
}

/**
 * Pick a human-readable base name from the generated course (built from PDF text).
 * Priority: course title → first module title → first lesson title.
 */
export function deriveFileStemFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Partial<CoursePayload>;

  if (typeof p.title === "string") {
    const s = stemCandidate(p.title);
    if (s) return s;
  }

  const m0 = p.modules?.[0];
  if (m0 && typeof m0.title === "string") {
    const s = stemCandidate(m0.title);
    if (s) return s;
  }

  const lesson0 = m0?.lessons?.[0];
  if (lesson0 && typeof lesson0.title === "string") {
    const s = stemCandidate(lesson0.title);
    if (s) return s;
  }

  return null;
}

/** @deprecated Stored labels are section titles without `.pdf`; use finalizeMaterialSectionLabel. */
export function stemToPdfFileName(stem: string): string {
  return finalizeMaterialSectionLabel(stem.replace(/\.pdf$/i, ""));
}

/** Resolve collisions when two builds derive the same title (e.g. two "Week 3"). */
export function dedupeSectionLabels(stems: string[]): string[] {
  const seenCount = new Map<string, number>();
  const out: string[] = [];

  for (const stem of stems) {
    const cleaned = finalizeMaterialSectionLabel(stem, 240);
    const key = cleaned.toLowerCase();
    const n = seenCount.get(key) ?? 0;
    seenCount.set(key, n + 1);
    const disambiguated =
      n === 0 ? cleaned : `${cleaned} (${n + 1})`;
    out.push(finalizeMaterialSectionLabel(disambiguated, 240));
  }

  return out;
}

/** @deprecated Use dedupeSectionLabels */
export const dedupePdfStemNames = dedupeSectionLabels;
