import { combinedSourceMarker } from "../study-ingest/combine";

export const LIVE_LECTURE_INGEST_MAX = 500_000;

/** Minimum so a present primary source is never dropped when others are huge. */
const PRIMARY_FLOOR = 48_000;
const SECONDARY_FLOOR = 16_000;
const PRIMARY_WEIGHT = 3;
const SECONDARY_WEIGHT = 1;

export type LiveLectureSourceParts = {
  title: string;
  notesMarkdown?: string;
  transcript: string;
  screenContent?: string;
  deckContent?: string;
  /** Chat-attached handout / worksheet PDF extract, if the client still has it. */
  handoutContent?: string;
};

type SourceKind = "notes" | "transcript" | "slides" | "screen" | "handout";

type PackedSource = {
  kind: SourceKind;
  heading: string;
  body: string;
  weight: number;
  floor: number;
};

function isPrimary(kind: SourceKind): boolean {
  return kind === "notes" || kind === "transcript" || kind === "slides";
}

/**
 * Weighted water-fill: every present source gets a floor, then leftover budget
 * is shared by weight. Primary kinds (notes / transcript / slides) share equally
 * at a higher weight so none of the three is starved by another.
 */
export function allocateLiveLectureBudgets(
  lengths: number[],
  weights: number[],
  floors: number[],
  budget: number
): number[] {
  const n = lengths.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || budget <= 0) return alloc;

  let remaining = budget;
  for (let i = 0; i < n; i++) {
    const give = Math.min(lengths[i]!, floors[i]!, remaining);
    alloc[i] = give;
    remaining -= give;
  }

  while (remaining > 0) {
    const active: number[] = [];
    let totalW = 0;
    for (let i = 0; i < n; i++) {
      if (alloc[i]! < lengths[i]!) {
        active.push(i);
        totalW += weights[i]!;
      }
    }
    if (active.length === 0 || totalW <= 0) break;

    const unit = Math.floor(remaining / totalW);
    if (unit <= 0) {
      for (const i of active) {
        if (remaining <= 0) break;
        alloc[i]! += 1;
        remaining -= 1;
      }
      continue;
    }

    let used = 0;
    for (const i of active) {
      const want = lengths[i]! - alloc[i]!;
      const give = Math.min(want, unit * weights[i]!);
      alloc[i]! += give;
      used += give;
    }
    if (used === 0) break;
    remaining -= used;
  }

  return alloc;
}

function collectSources(parts: LiveLectureSourceParts, title: string): PackedSource[] {
  const rows: Array<{
    kind: SourceKind;
    raw: string | undefined;
  }> = [
    { kind: "notes", raw: parts.notesMarkdown },
    { kind: "transcript", raw: parts.transcript },
    { kind: "slides", raw: parts.deckContent },
    { kind: "screen", raw: parts.screenContent },
    { kind: "handout", raw: parts.handoutContent },
  ];
  const out: PackedSource[] = [];
  for (const row of rows) {
    const body = (row.raw ?? "").trim();
    if (!body) continue;
    out.push({
      kind: row.kind,
      heading: `[from ${title} ${row.kind}]`,
      body,
      weight: isPrimary(row.kind) ? PRIMARY_WEIGHT : SECONDARY_WEIGHT,
      floor: isPrimary(row.kind) ? PRIMARY_FLOOR : SECONDARY_FLOOR,
    });
  }
  return out;
}

function liveLecturePackHeader(sourceCount: number): string {
  return (
    `=== COMBINED STUDY MATERIALS: ${sourceCount} SOURCES (EQUAL WEIGHT) ===\n` +
    `Live lecture capture. Generated notes, speech transcript, and slides are equal primary sources (on-screen extracts and chat handouts are extra uploaded material). Cover the UNION of unique teachable content — including slide pages the lecturer never spoke and spoken explanations that never appeared on slides. When the same concept appears in more than one source, teach it ONCE at the richest version (prefer slide tables/formulas + note structure + spoken explanation). Do not copy the same table or fact twice.`
  );
}

/**
 * Pack notes + transcript + slides (+ screen/handout) into the ingest blob.
 *
 * Uses `===== SOURCE n/N — FILE: … =====` markers so course generation's
 * fair truncator cannot drop an entire source class, plus `[from … notes|
 * transcript|slides|screen|handout]` headings the model (and admin labels) read.
 */
export function packLiveLectureIngestBlob(
  parts: LiveLectureSourceParts
): string {
  const title = parts.title.trim() || "Live lecture";
  const sources = collectSources(parts, title);
  if (sources.length === 0) return "";

  if (sources.length === 1) {
    const only = sources[0]!;
    return `${only.heading}\n${only.body}`.slice(0, LIVE_LECTURE_INGEST_MAX);
  }

  const header = liveLecturePackHeader(sources.length);
  const markers = sources.map((s, i) =>
    combinedSourceMarker(i + 1, sources.length, `${title} [${s.kind}]`)
  );
  const joinOverhead = (sources.length - 1) * 2;
  const markerOverhead = markers.reduce((n, m, i) => {
    return n + m.length + 1 + sources[i]!.heading.length + 1;
  }, 0);
  const bodyBudget = Math.max(
    sources.length * 800,
    LIVE_LECTURE_INGEST_MAX - header.length - 2 - markerOverhead - joinOverhead
  );

  const lengths = sources.map((s) => s.body.length);
  const weights = sources.map((s) => s.weight);
  const floors = sources.map((s) => s.floor);
  const alloc = allocateLiveLectureBudgets(lengths, weights, floors, bodyBudget);

  const blocks = sources.map((s, i) => {
    const budget = Math.max(400, alloc[i]!);
    const body = s.body.length <= budget ? s.body : s.body.slice(0, budget);
    return `${markers[i]}\n${s.heading}\n${body}`;
  });

  let packed = `${header}\n\n${blocks.join("\n\n")}`;
  if (packed.length <= LIVE_LECTURE_INGEST_MAX) return packed;

  // Last-resort trim: shrink the longest body, never drop a source heading.
  const overflow = packed.length - LIVE_LECTURE_INGEST_MAX;
  let longest = 0;
  for (let i = 1; i < sources.length; i++) {
    if (alloc[i]! > alloc[longest]!) longest = i;
  }
  const shrink = Math.min(alloc[longest]!, overflow + 8);
  const nextBody = sources[longest]!.body.slice(
    0,
    Math.max(400, alloc[longest]! - shrink)
  );
  blocks[longest] =
    `${markers[longest]}\n${sources[longest]!.heading}\n${nextBody}`;
  packed = `${header}\n\n${blocks.join("\n\n")}`;
  return packed.length <= LIVE_LECTURE_INGEST_MAX
    ? packed
    : packed.slice(0, LIVE_LECTURE_INGEST_MAX);
}
