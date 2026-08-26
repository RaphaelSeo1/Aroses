/**
 * Streaming protocol for live-lecture chat (Q&A + note edits).
 *
 *   @@thought <text>              optional — activity-log line, not the reply
 *   @@reply                       student-facing answer (markdown)
 *   @@delete <sectionId>          drop an AI note section (no body)
 *   @@highlight <sectionId> [color]
 *   @@revise <sectionId>          replacement notes markdown follows
 *   @@append                      new notes section follows
 *
 * Reply text is forwarded as `channel: "reply"`. Revise/append bodies use
 * `channel: "notes"`. Instant commands emit `op` events with no body.
 */

export const HIGHLIGHT_COLOR_HEX: Record<string, string> = {
  yellow: "#fde68a",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  purple: "#e9d5ff",
  orange: "#fed7aa",
};

export type LectureChatOp = "append" | "revise" | "delete" | "highlight";

export type LectureChatStreamEvent =
  | { type: "thought"; message: string }
  | {
      type: "op";
      op: LectureChatOp;
      sectionId: string;
      color?: string;
    }
  | { type: "text"; channel: "reply" | "notes"; delta: string };

export function createLectureChatParser(
  allowedIds: Set<string>,
  appendSectionId: string
): {
  push: (deltaText: string) => LectureChatStreamEvent[];
  flush: () => LectureChatStreamEvent[];
} {
  type Mode = "preamble" | "reply" | "append" | "revise" | "skip";
  let mode: Mode = "preamble";
  let line = "";
  let forwarded = 0;
  let deletes = 0;
  let highlights = 0;

  const notesBody = () => mode === "append" || mode === "revise";
  const replyBody = () => mode === "reply";
  const streamBody = () => notesBody() || replyBody();

  const completeLine = (out: LectureChatStreamEvent[]) => {
    if (forwarded === 0 && line.startsWith("@@")) {
      const trimmed = line.trim();
      if (trimmed === "@@reply") {
        mode = "reply";
      } else if (trimmed === "@@append") {
        mode = "append";
        out.push({ type: "op", op: "append", sectionId: appendSectionId });
      } else if (trimmed.startsWith("@@revise")) {
        const id = trimmed.slice("@@revise".length).trim();
        if (id && allowedIds.has(id)) {
          mode = "revise";
          out.push({ type: "op", op: "revise", sectionId: id });
        } else {
          mode = "skip";
        }
      } else if (trimmed.startsWith("@@delete")) {
        const id = trimmed.slice("@@delete".length).trim();
        if (id && allowedIds.has(id) && deletes < 4) {
          deletes += 1;
          out.push({ type: "op", op: "delete", sectionId: id });
        }
      } else if (trimmed.startsWith("@@highlight")) {
        const rest = trimmed.slice("@@highlight".length).trim();
        const parts = rest.split(/\s+/);
        const id = parts[0] ?? "";
        const colorName = (parts[1] ?? "yellow").toLowerCase();
        const color = HIGHLIGHT_COLOR_HEX[colorName] ?? HIGHLIGHT_COLOR_HEX.yellow;
        if (id && allowedIds.has(id) && highlights < 6) {
          highlights += 1;
          out.push({ type: "op", op: "highlight", sectionId: id, color });
        }
      } else if (trimmed.startsWith("@@thought")) {
        const message = trimmed.slice("@@thought".length).trim();
        if (message) out.push({ type: "thought", message });
      }
    } else if (notesBody()) {
      out.push({
        type: "text",
        channel: "notes",
        delta: `${line.slice(forwarded)}\n`,
      });
    } else if (replyBody()) {
      out.push({
        type: "text",
        channel: "reply",
        delta: `${line.slice(forwarded)}\n`,
      });
    } else if (mode === "preamble" && line.trim()) {
      // Model skipped @@reply — treat leftover prose as the student answer.
      mode = "reply";
      out.push({
        type: "text",
        channel: "reply",
        delta: `${line.slice(forwarded)}\n`,
      });
    }
    line = "";
    forwarded = 0;
  };

  return {
    push(deltaText: string): LectureChatStreamEvent[] {
      const out: LectureChatStreamEvent[] = [];
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
        if (streamBody()) {
          const mayBeMarker =
            forwarded === 0 && line.startsWith("@") && line.length < 80;
          if (!mayBeMarker && line.length > forwarded) {
            out.push({
              type: "text",
              channel: notesBody() ? "notes" : "reply",
              delta: line.slice(forwarded),
            });
            forwarded = line.length;
          }
        }
      }
      return out;
    },
    flush(): LectureChatStreamEvent[] {
      const out: LectureChatStreamEvent[] = [];
      if (line.length > 0) completeLine(out);
      return out;
    },
  };
}
