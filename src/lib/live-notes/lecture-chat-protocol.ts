/**
 * Streaming protocol for live-lecture chat (Q&A + note edits).
 *
 *   @@thought <text>              optional — activity-log line, not the reply
 *   @@reply                       student-facing answer (markdown)
 *   @@delete <sectionId>          drop a note section (no body)
 *   @@highlight <sectionId> [color|none]
 *   @@unhighlight <sectionId>
 *   @@revise <sectionId>          replacement notes markdown follows
 *   @@append                      new notes section follows
 *
 * Reply text is forwarded as `channel: "reply"` only after `@@reply`.
 * Unmarked preamble is emitted as `thought`, never as the student bubble.
 * Revise/append bodies use `channel: "notes"`. Instant commands emit `op`
 * events with no body.
 */

export const HIGHLIGHT_COLOR_HEX: Record<string, string> = {
  yellow: "#fde68a",
  green: "#bbf7d0",
  blue: "#bfdbfe",
  pink: "#fbcfe8",
  purple: "#e9d5ff",
  orange: "#fed7aa",
};

export const HIGHLIGHT_CLEAR_TOKENS = new Set([
  "none",
  "clear",
  "off",
  "remove",
  "unhighlight",
]);

export type LectureChatOp =
  | "append"
  | "revise"
  | "delete"
  | "highlight"
  | "unhighlight";

export type LectureChatStreamEvent =
  | { type: "thought"; message: string }
  | {
      type: "op";
      op: LectureChatOp;
      sectionId: string;
      color?: string;
    }
  | { type: "text"; channel: "reply" | "notes"; delta: string };

export type LectureChatParserSection = {
  sectionId: string;
  markdown: string;
};

/**
 * Map a model-supplied @@revise/@@delete/@@highlight target onto a real
 * section id. Exact ids, leftover tokens on the marker line, and heading
 * text ("scarcity") all resolve; an empty target falls back to the last
 * section so "change that" still lands.
 */
export function resolveLectureChatSectionId(
  raw: string,
  allowed: Set<string>,
  sections: LectureChatParserSection[],
  preferredSectionId?: string
): string | null {
  const trimmed = raw.trim();
  const preferred =
    preferredSectionId && allowed.has(preferredSectionId)
      ? preferredSectionId
      : null;
  if (!trimmed) {
    if (preferred) return preferred;
    const last = sections[sections.length - 1];
    return last && allowed.has(last.sectionId) ? last.sectionId : null;
  }
  const token = trimmed.split(/\s+/)[0] ?? "";
  if (allowed.has(token)) return token;
  for (const id of allowed) {
    if (trimmed.includes(id)) return id;
  }
  const q = trimmed.toLowerCase();
  for (const s of sections) {
    if (!allowed.has(s.sectionId)) continue;
    const heading = s.markdown
      .match(/^#{1,3}\s+(.+)$/m)?.[1]
      ?.trim()
      .toLowerCase();
    if (heading && (q.includes(heading) || heading.includes(q))) {
      return s.sectionId;
    }
  }
  if (sections.length === 1 && allowed.has(sections[0]!.sectionId)) {
    return sections[0]!.sectionId;
  }
  return preferred;
}

const PROTOCOL_LEAK_LINE =
  /@@(?:revise|append|delete|highlight|unhighlight|thought|reply)\b|sectionId/i;
const MIGHT_LEAK_RE = /@@|sectionId/i;

export function isProtocolLeakLine(line: string): boolean {
  return PROTOCOL_LEAK_LINE.test(line);
}

/**
 * Split a model @@reply body into student-visible text vs protocol/CoT leaks.
 * Leaked lines should be shown under Thinking…, never in the chat bubble.
 */
export function splitStudentFacingReply(text: string): {
  visible: string;
  leaked: string[];
} {
  if (!text) return { visible: "", leaked: [] };
  const leaked: string[] = [];
  const visible: string[] = [];
  for (const line of text.split("\n")) {
    if (isProtocolLeakLine(line)) leaked.push(line.trim());
    else visible.push(line);
  }
  return {
    visible: visible.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    leaked: leaked.filter(Boolean),
  };
}

/** Drop fences and @@ protocol lines from a chat-notes body. */
export function sanitizeChatNotesMarkdown(markdown: string): string {
  const unfenced = markdown
    .replace(/```(?:markdown|md)?\s*\n?([\s\S]*?)```/gi, "$1")
    .replace(/```/g, "");
  return unfenced
    .split("\n")
    .filter((line) => !isProtocolLeakLine(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CHATTY_NOTE_LINE =
  /^(here('s| is)|here you go|great question|good question|not (in|part of) this lecture|let me|i('ll| can| would)|sure[,!]|of course|absolutely|no problem|got it|i added|i've added|updated your notes|added (a |that |this )?(short |brief )?(note|section|bullet))/i;

/**
 * Keep study-note structure (headings, bullets, tables) and drop the
 * conversational reply the model often pastes into @@append.
 */
function isStudyNoteLine(t: string): boolean {
  return (
    /^#{1,3}\s/.test(t) ||
    /^[-*]\s/.test(t) ||
    /^\d+\.\s/.test(t) ||
    /^\|/.test(t) ||
    /^>\s/.test(t) ||
    /^\*\*[^*].+\*\*/.test(t)
  );
}

export function extractStudyNoteLines(markdown: string): string {
  const keep: string[] = [];
  const loose: string[] = [];
  for (const line of sanitizeChatNotesMarkdown(markdown).split("\n")) {
    const t = line.trim();
    if (!t) {
      if (keep.length > 0 && keep[keep.length - 1] !== "") keep.push("");
      continue;
    }
    if (CHATTY_NOTE_LINE.test(t)) continue;
    if (isStudyNoteLine(t)) {
      keep.push(line);
      continue;
    }
    if (t.length <= 180) loose.push(`- ${t}`);
  }
  const structured = keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (structured) return structured;
  return loose.slice(0, 6).join("\n").trim();
}

export function visibleReplyForStream(raw: string, complete: boolean): string {
  if (complete) return splitStudentFacingReply(raw).visible;
  const nl = raw.lastIndexOf("\n");
  if (nl < 0) return MIGHT_LEAK_RE.test(raw) ? "" : raw;
  const { visible } = splitStudentFacingReply(raw.slice(0, nl));
  const tail = raw.slice(nl + 1);
  if (!tail || MIGHT_LEAK_RE.test(tail)) return visible;
  return visible ? `${visible}\n${tail}` : tail;
}

export function createLectureChatParser(
  allowedIds: Set<string>,
  appendSectionId: string,
  sections: LectureChatParserSection[] = [],
  preferredSectionId?: string
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
  let revises = 0;

  const notesBody = () => mode === "append" || mode === "revise";
  const replyBody = () => mode === "reply";
  const streamBody = () => notesBody() || replyBody();
  const resolveTarget = (raw: string) =>
    resolveLectureChatSectionId(
      raw,
      allowedIds,
      sections,
      preferredSectionId
    );
  const lastResortId = () => {
    if (preferredSectionId && allowedIds.has(preferredSectionId)) {
      return preferredSectionId;
    }
    const last = sections[sections.length - 1]?.sectionId;
    return last && allowedIds.has(last) ? last : undefined;
  };

  const completeLine = (out: LectureChatStreamEvent[]) => {
    if (forwarded === 0 && line.startsWith("@@")) {
      const trimmed = line.trim();
      if (trimmed === "@@reply" || trimmed.startsWith("@@reply ")) {
        mode = "reply";
        const rest = trimmed.slice("@@reply".length).trim();
        if (rest) {
          if (isProtocolLeakLine(rest)) {
            out.push({ type: "thought", message: rest });
          } else {
            out.push({
              type: "text",
              channel: "reply",
              delta: `${rest}\n`,
            });
          }
        }
      } else if (trimmed === "@@append") {
        mode = "append";
        out.push({ type: "op", op: "append", sectionId: appendSectionId });
      } else if (trimmed.startsWith("@@revise")) {
        const raw = trimmed.slice("@@revise".length).trim();
        const id = resolveTarget(raw);
        if (id && revises < 4) {
          revises += 1;
          mode = "revise";
          out.push({ type: "op", op: "revise", sectionId: id });
          const leftover = raw.startsWith(id)
            ? raw.slice(id.length).trim()
            : "";
          if (leftover && /^[#\-*>\d]/.test(leftover)) {
            out.push({
              type: "text",
              channel: "notes",
              delta: `${leftover}\n`,
            });
          }
        } else {
          const fallbackId = lastResortId();
          if (fallbackId && revises < 4) {
            revises += 1;
            mode = "revise";
            out.push({ type: "op", op: "revise", sectionId: fallbackId });
            if (raw && /^[#\-*>\d]/.test(raw)) {
              out.push({
                type: "text",
                channel: "notes",
                delta: `${raw}\n`,
              });
            }
          } else {
            mode = "skip";
          }
        }
      } else if (trimmed.startsWith("@@delete")) {
        const raw = trimmed.slice("@@delete".length).trim();
        const id = resolveTarget(raw);
        if (id && deletes < 4) {
          deletes += 1;
          out.push({ type: "op", op: "delete", sectionId: id });
        }
      } else if (trimmed.startsWith("@@unhighlight")) {
        const raw = trimmed.slice("@@unhighlight".length).trim();
        const token = (raw.split(/\s+/)[0] ?? "").toLowerCase();
        if ((token === "all" || token === "*") && highlights < 6) {
          highlights += 1;
          out.push({ type: "op", op: "unhighlight", sectionId: "all" });
        } else {
          const id = resolveTarget(raw);
          if (id && highlights < 6) {
            highlights += 1;
            out.push({ type: "op", op: "unhighlight", sectionId: id });
          }
        }
      } else if (trimmed.startsWith("@@highlight")) {
        const rest = trimmed.slice("@@highlight".length).trim();
        const parts = rest.split(/\s+/);
        let colorName = "yellow";
        let idRaw = rest;
        const last = (parts[parts.length - 1] ?? "").toLowerCase();
        if (HIGHLIGHT_COLOR_HEX[last] || HIGHLIGHT_CLEAR_TOKENS.has(last)) {
          colorName = last;
          idRaw = parts.slice(0, -1).join(" ");
        }
        const idRawLower = idRaw.trim().toLowerCase();
        if (
          HIGHLIGHT_CLEAR_TOKENS.has(colorName) &&
          (idRawLower === "all" || idRawLower === "*") &&
          highlights < 6
        ) {
          highlights += 1;
          out.push({ type: "op", op: "unhighlight", sectionId: "all" });
        } else {
          const id = resolveTarget(idRaw);
          if (id && highlights < 6) {
            highlights += 1;
            if (HIGHLIGHT_CLEAR_TOKENS.has(colorName)) {
              out.push({ type: "op", op: "unhighlight", sectionId: id });
            } else {
              const color =
                HIGHLIGHT_COLOR_HEX[colorName] ?? HIGHLIGHT_COLOR_HEX.yellow;
              out.push({ type: "op", op: "highlight", sectionId: id, color });
            }
          }
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
      // Prose before @@reply is internal narration, never the student bubble.
      out.push({ type: "thought", message: line.trim() });
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
