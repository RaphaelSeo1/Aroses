import {
  isNotesFocusBucketId,
  NOTES_FOCUS_BUCKET_ID,
  notesFocusBucketId,
  parseNotesFocusBucketNoteId,
} from "./notes/notes-focus-bucket.ts";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isSrsMaterialUuid(id: string | null | undefined): boolean {
  return Boolean(id && UUID_RE.test(id.trim()));
}

function normId(id: string | null | undefined): string {
  return (id ?? "").trim().toLowerCase();
}

function collectToken(raw: string, into: Set<string>): void {
  const t = normId(raw);
  if (t && (UUID_RE.test(t) || isNotesFocusBucketId(t))) into.add(t);
}

/**
 * Parsed `/api/srs/session` material + note filters.
 *
 * `noteIds` query param: `null` means omitted (no extra note filter unless
 * `note:{uuid}` buckets appear in materialIds). An empty array means the
 * param was present and we should exclude note-sourced personal cards.
 */
export type ParsedSrsSessionScope = {
  /** Real study-material UUIDs. `null` = unrestricted. Empty = none. */
  materialUuids: Set<string> | null;
  noteIds: Set<string>;
  includeLegacyNotes: boolean;
  noteFilterActive: boolean;
  hasRestriction: boolean;
};

export function parseSrsSessionScope(input: {
  materialId?: string | null;
  materialIds?: string | null;
  /** `undefined` = omitted from the query string. */
  noteIds?: string | null | undefined;
  noteIdsSpecified?: boolean;
}): ParsedSrsSessionScope {
  const tokens = new Set<string>();
  if (input.materialId) collectToken(input.materialId, tokens);
  if (input.materialIds) {
    for (const piece of input.materialIds.split(",")) collectToken(piece, tokens);
  }

  const materialUuids = new Set<string>();
  const noteIds = new Set<string>();
  let includeLegacyNotes = false;
  for (const id of tokens) {
    if (UUID_RE.test(id)) materialUuids.add(id);
    const fromBucket = parseNotesFocusBucketNoteId(id);
    if (fromBucket) noteIds.add(fromBucket.toLowerCase());
    if (id === NOTES_FOCUS_BUCKET_ID) includeLegacyNotes = true;
  }

  const noteIdsSpecified =
    input.noteIdsSpecified === true ||
    (input.noteIdsSpecified !== false && input.noteIds != null);
  if (typeof input.noteIds === "string") {
    for (const piece of input.noteIds.split(",")) {
      const t = normId(piece);
      if (UUID_RE.test(t)) noteIds.add(t);
    }
  }

  const noteFilterActive = noteIdsSpecified || noteIds.size > 0;
  const hasRestriction = tokens.size > 0 || noteIdsSpecified;

  if (!hasRestriction) {
    return {
      materialUuids: null,
      noteIds,
      includeLegacyNotes: true,
      noteFilterActive: false,
      hasRestriction: false,
    };
  }

  return {
    materialUuids,
    noteIds,
    includeLegacyNotes,
    noteFilterActive,
    hasRestriction: true,
  };
}

export function personalCardInScope(
  scope: ParsedSrsSessionScope,
  card: { materialId?: string | null; sourceNoteId?: string | null }
): boolean {
  if (!scope.hasRestriction) return true;

  const mid = card.materialId ? normId(card.materialId) : "";
  const hasRealMaterial = Boolean(mid) && !isNotesFocusBucketId(mid);
  const sourceNoteId =
    typeof card.sourceNoteId === "string" && UUID_RE.test(card.sourceNoteId.trim())
      ? card.sourceNoteId.trim().toLowerCase()
      : null;

  if (scope.noteFilterActive) {
    if (sourceNoteId) return scope.noteIds.has(sourceNoteId);
    if (hasRealMaterial) {
      return scope.materialUuids != null && scope.materialUuids.has(mid);
    }
    return !mid && !sourceNoteId && scope.includeLegacyNotes;
  }

  if (hasRealMaterial) {
    return scope.materialUuids == null || scope.materialUuids.has(mid);
  }

  if (!mid) {
    if (sourceNoteId) {
      return (
        scope.noteIds.has(sourceNoteId) ||
        (scope.materialUuids == null && scope.includeLegacyNotes)
      );
    }
    return scope.includeLegacyNotes;
  }

  return scope.includeLegacyNotes && mid === NOTES_FOCUS_BUCKET_ID;
}

export function notesBucketForCard(sourceNoteId: string | null | undefined): string {
  return notesFocusBucketId(sourceNoteId);
}
