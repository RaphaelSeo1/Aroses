/**
 * Source-text normalization shared by extraction and the coverage ledger.
 *
 * PDF text layers split ligatures into separate tokens ("fi rst identi fi ed",
 * "di ff erent", "fl atworm") and hard-wrap sentences across lines. Both
 * break token matching between a slide and the notes written from it, so
 * the same repair runs at extraction time and again on already-stored text.
 * Subject-neutral: only typography is touched, never wording.
 */

const LIGATURES = new Set(["fi", "fl", "ff", "ffi", "ffl"]);

/** Short real words that may legitimately precede a ligature fragment. */
const STANDALONE_BEFORE = new Set([
  "a", "an", "the", "of", "in", "to", "is", "and", "or", "by", "on", "at",
  "as", "for", "with", "from", "that", "this", "be", "we", "it", "its",
  "are", "was", "has", "had", "not", "but", "can", "may", "per", "into",
  "than", "then", "very", "some", "more", "most", "also", "each", "both",
  "only", "such", "when", "where", "how", "what", "why", "who", "all",
  "any", "one", "two", "no", "so", "if", "up", "do", "he", "she", "they",
  "you", "my", "our", "his", "her", "their", "these", "those", "new",
  "old", "big", "few", "own", "same", "next", "last", "first", "were",
  "cells", "cell", "de", "la", "le", "el", "et", "al", "vs",
]);

/**
 * Words that begin with a "fi"/"fl" ligature. When the ligature plus the
 * following fragment is one of these, the ligature starts a word
 * ("fi rst" → "first"); otherwise it finishes the previous fragment
 * ("identi fi ed" → "identified"). "ff" never starts an English word.
 */
const RIGHT_GLUE_WORDS = new Set([
  "first", "figure", "figures", "figured", "field", "fields", "final",
  "finally", "finals", "find", "finds", "finding", "findings", "fine",
  "finer", "finish", "finished", "finite", "fish", "fit", "fits", "fitting",
  "five", "fix", "fixed", "fixes", "fixation", "file", "files", "fill",
  "filled", "filling", "film", "films", "filter", "filters", "filtered",
  "filtering", "finger", "fingers", "fiber", "fibers", "fibre", "fibres",
  "fibrous", "fibril", "fibrils", "fidelity", "fission", "filament",
  "filaments", "fifty", "fifth", "fifteen", "fig", "figs", "fiction",
  "fictitious", "financial", "finance", "fire", "fired", "firing", "fixing",
  "fitness", "fields", "fiscal", "fibrin", "fibroblast", "fibroblasts",
  "flat", "flatworm", "flatworms", "flatten", "floor", "flow", "flows",
  "flowing", "fluid", "fluids", "flux", "fluxes", "flag", "flags", "flask",
  "flasks", "flame", "flames", "flash", "flexible", "flexibility", "flip",
  "flips", "float", "floats", "floating", "flood", "fluorescence",
  "fluorescent", "fluctuation", "fluctuations", "fluctuate", "flight",
  "flora", "fly", "flies", "flower", "flowers", "flowering", "fluent",
  "flank", "flanking", "flanks", "flaw", "flaws", "fleet", "flesh", "flu",
  "fluoride", "fluorine", "flux", "flavor", "flavour", "flee", "flow",
]);

/** Marks a ligature that the extractor glued (via TAB) to the previous token. */
const GLUE_LEFT = "\u0001";

/**
 * Re-join ligature fragments produced by PDF extraction. "identi fi ed" →
 * "identified", "fi rst" → "first", "a fl atworm" → "a flatworm",
 * "Di ff erences" → "Differences".
 */
export function repairLigatureSplits(text: string): string {
  const marked = text.replace(
    /(\S)\t(fi|fl|ff|ffi|ffl)(?= )/gi,
    (_, before: string, lig: string) => `${before} ${GLUE_LEFT}${lig}`
  );
  const words = marked.replace(/\t/g, " ").split(/ +/);
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    const forced = w.startsWith(GLUE_LEFT);
    const lig = forced ? w.slice(1) : w;
    if (LIGATURES.has(lig.toLowerCase())) {
      const next = words[i + 1] ?? "";
      const prev = out.length > 0 ? out[out.length - 1]! : "";
      if (/^[a-z]/.test(next)) {
        const prevBare = prev.toLowerCase().replace(/[^a-z]/g, "");
        const prevIsWordLike = /^[A-Za-z][A-Za-z-]*$/.test(prev) && !/^[A-Z]{2,}$/.test(prev);
        const combined = `${lig}${next}`.toLowerCase().replace(/[^a-z]/g, "");
        let glueLeft: boolean;
        if (forced) glueLeft = true;
        else if (!prev || !prevIsWordLike) glueLeft = false;
        else if (lig.toLowerCase().startsWith("ff")) glueLeft = true;
        else if (RIGHT_GLUE_WORDS.has(combined)) glueLeft = false;
        else glueLeft = !STANDALONE_BEFORE.has(prevBare);
        if (glueLeft && prev) {
          out[out.length - 1] = `${prev}${lig}${next}`;
        } else {
          out.push(`${lig}${next}`);
        }
        i += 2;
        continue;
      }
    }
    out.push(forced ? lig : w);
    i += 1;
  }
  return out.join(" ").replace(/ {2,}/g, " ").trim();
}

/**
 * Normalize extracted source text: ligatures, odd whitespace, spaced
 * apostrophes. Remaining TABs separate text boxes that share a visual row
 * (diagram labels) — they become their own lines so they are not glued
 * onto a neighbouring sentence.
 */
export function normalizeSourceText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const parts = splitTextBoxes(
        line
          // TAB glued to the previous token + ligature: extractor's glue signal.
          .replace(/(\S)\t(fi|fl|ff|ffi|ffl)(?= )/gi, `$1 ${GLUE_LEFT}$2`)
          // TAB before a word-initial ligature: plain space.
          .replace(/\t(fi|fl|ff|ffi|ffl)(?= )/gi, " $1")
      )
        .map((part) =>
          repairLigatureSplits(part)
            .replace(/\s*’\s*s\b/g, "’s")
            .replace(/\s+([,.;:!?)])/g, "$1")
            .replace(/\(\s+/g, "(")
            .replace(/\s{2,}/g, " ")
            .trim()
        )
        .filter(Boolean);
      // Keep paragraph breaks (an empty source line stays one empty line).
      return parts.length > 0 ? parts : [""];
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

/**
 * Extractors emit TABs both around emphasized runs inside a sentence
 * ("phosphorylating\tmany\t targets", "It\t’ s") and between separate text
 * boxes on one visual row (diagram labels). A TAB followed by lowercase or
 * punctuation, or preceded by a connector/comma, continues the sentence;
 * any other TAB starts a new line.
 */
function splitTextBoxes(line: string): string[] {
  if (!line.includes("\t")) return [line];
  const parts = line.split("\t");
  // Table row: three or more short cells on one visual row stay together
  // ("Singapore | Af | 26 | 28 | 2,340") so the row's names and numbers are
  // audited as one contribution instead of scattering into bare labels.
  const cells = parts.map((p) => p.trim()).filter(Boolean);
  if (
    cells.length >= 3 &&
    cells.every((c) => c.split(/\s+/).length <= 4) &&
    cells.some((c) => /\d/.test(c))
  ) {
    return [cells.join(" | ")];
  }
  const out: string[] = [];
  let cur = parts[0] ?? "";
  for (let i = 1; i < parts.length; i++) {
    const next = parts[i]!;
    const nextTrim = next.trimStart();
    const curTrim = cur.trimEnd();
    const lastWord = curTrim.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
    const continues =
      !nextTrim ||
      !curTrim ||
      /^[a-z’',:;)\]]/.test(nextTrim) ||
      /[,;:(\[/=+&-]$/.test(curTrim) ||
      TRAILING_CONNECTOR.has(lastWord);
    if (continues) cur = `${curTrim} ${nextTrim}`;
    else {
      out.push(cur);
      cur = next;
    }
  }
  out.push(cur);
  return out;
}

/** Words that almost never end a sentence — the line was wrapped mid-clause. */
const TRAILING_CONNECTOR = new Set([
  "a", "an", "the", "of", "to", "in", "on", "at", "by", "for", "from",
  "with", "and", "or", "but", "as", "into", "than", "that", "which", "who",
  "whose", "is", "are", "was", "were", "be", "been", "has", "have", "had",
  "not", "its", "their", "his", "her", "this", "these", "those", "called",
  "between", "through", "via", "during", "until", "after", "before", "when",
  "where", "while", "because", "if", "so", "then", "also", "both", "either",
  "neither", "per", "over", "under", "about", "across", "along", "among",
  "around", "toward", "towards", "within", "without", "upon", "like",
  "unlike", "versus", "vs", "may", "can", "will", "would", "should", "must",
  "very", "more", "most", "less", "no", "each", "every", "some", "any",
  "relatively", "approximately", "how", "why", "what", "requires",
]);

const NOISE_LINE_RE = /^(?:https?:\/\/\S+|www\.\S+|@\w+|doi:\S+)$/i;

function endsSentence(s: string): boolean {
  return /[.!?…]["”’)]?\s*$/.test(s);
}

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

function shouldJoin(bufferLines: string[], line: string): boolean {
  if (bufferLines.length === 0) return false;
  const buffer = bufferLines.join(" ");
  if (endsSentence(buffer)) return false;
  // A lone word is a label/heading, not a sentence start — never extend it.
  if (wordCount(buffer) < 2) return false;
  const lastWord = buffer
    .split(/\s+/)
    .pop()!
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (TRAILING_CONNECTOR.has(lastWord)) return true;
  if (/[,;:\-–—/=+&]$/.test(buffer)) return true;
  const opens = (buffer.match(/\(/g) ?? []).length;
  const closes = (buffer.match(/\)/g) ?? []).length;
  if (opens > closes) return true;
  // A bare number / symbol line ("1", ">1", "→") is a diagram label, never
  // the tail of the sentence above it.
  if (!/[A-Za-z]/.test(line)) return false;
  // Wide sentence lines followed by a short lowercase fragment: that is a
  // diagram label sitting under the sentence, not its tail. Narrow text
  // boxes (2–3 words per line throughout) keep joining.
  const avgWords = wordCount(buffer) / bufferLines.length;
  if (avgWords >= 6 && wordCount(line) <= 3 && !endsSentence(line)) return false;
  if (/^[a-z]/.test(line)) return true;
  if (/^[(\[]/.test(line)) return true;
  if (/^\d/.test(line) && !/^\d+[.)]\s/.test(line)) return true;
  // Shouted continuation ("…process of homologous" + "PAIRING (physical…"):
  // the capitalized word is followed by lowercase prose, and the buffer
  // reads as a sentence start (capital letter, no label symbols).
  if (
    /^[A-Z]{3,}\s+[a-z(]/.test(line) &&
    wordCount(buffer) >= 6 &&
    /^[A-Z]/.test(buffer) &&
    !/::|\//.test(buffer)
  ) {
    return true;
  }
  return false;
}

/**
 * Turn hard-wrapped source text (slides, PDF pages) into logical segments:
 * sentences or standalone fragments (diagram labels, headings, list items).
 * Wrapped lines are re-joined before splitting on sentence boundaries.
 */
export function segmentSourceText(text: string): string[] {
  const norm = normalizeSourceText(text);
  const lines = norm
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !NOISE_LINE_RE.test(l));
  const joined: string[] = [];
  let buffer: string[] = [];
  for (const line of lines) {
    if (shouldJoin(buffer, line)) {
      buffer.push(line);
    } else {
      if (buffer.length > 0) joined.push(buffer.join(" "));
      buffer = [line];
    }
  }
  if (buffer.length > 0) joined.push(buffer.join(" "));

  const out: string[] = [];
  for (const chunk of joined) {
    const parts = chunk
      .split(
        /(?<=[.!?…]["”’)]?)(?<!\b(?:Dr|Drs|Prof|Mr|Mrs|Ms|Fig|Figs|Eq|No|St|vs|al|approx|ca|cf|ed|eds|vol|pp|Jr|Sr|Inc|Ltd|e\.g|i\.e|[A-Z])\.)\s+(?=[A-Z0-9“"(])/
      )
      .map((p) => p.trim())
      .filter(Boolean);
    out.push(...parts);
  }
  return out;
}
