/**
 * The @@ line-marker streaming protocol between the note-generation model
 * and the client (see `src/lib/ai/live-lecture-notes.ts` for the prompt):
 *
 *   @@thought <text>       zero or more, FIRST — short user-visible narration
 *   @@revise <sectionId>   zero or more — body fragment follows each
 *   @@delete <sectionId>   zero or more — exact lines to remove follow each
 *   @@append               exactly once — new-notes body follows
 *   @@summary              exactly once, LAST — rolling summary follows
 *                          (accumulated here, never forwarded)
 *
 * Pure and incremental: fed raw token deltas, emits typed events without
 * waiting for the full response. Lines starting with "@" are held until
 * their newline (markers are short) so a marker can never leak as text;
 * everything else forwards token-by-token with no added latency.
 */

export type LiveNotesStreamEvent =
  | { type: "thought"; message: string }
  | { type: "op"; op: "append" | "revise" | "delete"; sectionId: string }
  | { type: "text"; delta: string }
  | { type: "summary"; summary: string };

export type MarkerParser = {
  /** Feed a raw model text delta; returns the events it completes. */
  push: (deltaText: string) => LiveNotesStreamEvent[];
  /** Flush a trailing line at end-of-stream. */
  flush: () => LiveNotesStreamEvent[];
  /** Accumulated @@summary body (available after the stream ends). */
  summaryText: () => string;
};

export function createMarkerParser(
  allowedReviseIds: Set<string>,
  appendSectionId: string
): MarkerParser {
  type Mode = "preamble" | "append" | "revise" | "delete" | "summary" | "skip";
  let mode: Mode = "preamble";
  let line = "";
  /** How many chars of the current partial line were already forwarded. */
  let forwarded = 0;
  const summaryParts: string[] = [];
  /** Lines written before any marker; recovered at flush if no op ever came. */
  const preambleLines: string[] = [];
  let sawOp = false;

  const isBody = () =>
    mode === "append" || mode === "revise" || mode === "delete";

  const completeLine = (out: LiveNotesStreamEvent[]) => {
    if (forwarded === 0 && line.startsWith("@@")) {
      const trimmed = line.trim();
      if (trimmed === "@@append") {
        mode = "append";
        sawOp = true;
        out.push({ type: "op", op: "append", sectionId: appendSectionId });
      } else if (trimmed.startsWith("@@revise")) {
        const id = trimmed.slice("@@revise".length).trim();
        if (id && allowedReviseIds.has(id)) {
          mode = "revise";
          sawOp = true;
          out.push({ type: "op", op: "revise", sectionId: id });
        } else {
          // Unknown / student-edited target — swallow its body entirely.
          mode = "skip";
        }
      } else if (trimmed.startsWith("@@delete")) {
        const id = trimmed.slice("@@delete".length).trim();
        if (id && allowedReviseIds.has(id)) {
          mode = "delete";
          sawOp = true;
          out.push({ type: "op", op: "delete", sectionId: id });
        } else {
          mode = "skip";
        }
      } else if (trimmed === "@@summary") {
        mode = "summary";
      } else if (trimmed.startsWith("@@thought")) {
        const message = trimmed.slice("@@thought".length).trim();
        if (message) out.push({ type: "thought", message });
      }
      // Any other @@ line is protocol noise — drop it.
    } else if (isBody()) {
      out.push({ type: "text", delta: `${line.slice(forwarded)}\n` });
    } else if (mode === "summary") {
      summaryParts.push(line);
    } else if (mode === "preamble") {
      preambleLines.push(line);
    }
    line = "";
    forwarded = 0;
  };

  /**
   * The model occasionally writes a whole batch of notes and forgets the
   * `@@append` marker. Dropping that text loses every fact in the batch, so
   * when no op was ever emitted and the preamble looks like notes (a heading
   * or several bullets), recover it as the append body.
   */
  const recoverUnmarkedNotes = (out: LiveNotesStreamEvent[]) => {
    if (sawOp) return;
    const text = preambleLines.join("\n").trim();
    if (!text) return;
    const lines = text.split("\n").filter((l) => l.trim());
    const hasHeading = lines.some((l) => /^#{1,3}\s\S/.test(l.trim()));
    const bullets = lines.filter((l) => /^(?:[-*•]|\d+[.)])\s\S/.test(l.trim()));
    if (!hasHeading && bullets.length < 2) return;
    out.push({ type: "op", op: "append", sectionId: appendSectionId });
    out.push({ type: "text", delta: `${text}\n` });
  };

  return {
    push(deltaText: string): LiveNotesStreamEvent[] {
      const out: LiveNotesStreamEvent[] = [];
      let buf = deltaText;
      while (buf.length > 0) {
        const nl = buf.indexOf("\n");
        if (nl >= 0) {
          line += buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          completeLine(out);
          continue;
        }
        line += buf;
        buf = "";
        // Forward the partial body line unless it may still be a marker.
        if (isBody()) {
          const mayBeMarker =
            forwarded === 0 && line.startsWith("@") && line.length < 64;
          if (!mayBeMarker && line.length > forwarded) {
            out.push({ type: "text", delta: line.slice(forwarded) });
            forwarded = line.length;
          }
        }
      }
      return out;
    },
    flush(): LiveNotesStreamEvent[] {
      const out: LiveNotesStreamEvent[] = [];
      if (line.length > 0) completeLine(out);
      recoverUnmarkedNotes(out);
      return out;
    },
    summaryText(): string {
      return summaryParts.join("\n").trim();
    },
  };
}
