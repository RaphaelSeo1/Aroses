/**
 * The @@ line-marker streaming protocol between the note-generation model
 * and the client (see `src/lib/ai/live-lecture-notes.ts` for the prompt):
 *
 *   @@thought <text>       zero or more, FIRST — short user-visible narration
 *   @@revise <sectionId>   zero or more — new or corrected bullets
 *   @@delete <sectionId>   zero or more — exact lines to remove
 *   @@append               exactly once — new-notes body follows
 *   @@summary              exactly once, LAST — rolling summary follows
 *                          (accumulated here, never forwarded)
 *
 * Pure and incremental: fed raw token deltas, emits typed events as each
 * line completes. Body text is forwarded one whole line at a time so a
 * marker can never leak, wherever the model puts it: indented, after a
 * bullet/number/quote prefix, wrapped in ** or backticks, in any casing,
 * with its payload on the same line ("@@summary Lecture covers…"), or
 * after note text on the same line.
 */

export type LiveNotesStreamEvent =
  | { type: "thought"; message: string }
  | {
      type: "op";
      op: "append" | "revise" | "delete";
      sectionId: string;
    }
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

export type ProtocolDirective = {
  /** Note text before the directive on the same line ("" when none). */
  before: string;
  /** Lower-cased directive name, e.g. "summary". */
  name: string;
  /** Payload after the directive name on the same line. */
  rest: string;
};

const DIRECTIVE_RE = /@@\s*([a-z][a-z_-]*)/i;
/** Indentation, list/quote/heading prefixes and emphasis wrappers. */
const DECORATION_ONLY_RE = /^(?:\s|[-*+>#`_~•]|\d{1,3}[.)])*$/;
const CODE_FENCE_RE = /^\s*```[a-z]*\s*$/i;

function cleanPayload(raw: string): string {
  return raw
    .replace(/^[\s:*`_—–-]+/, "")
    .replace(/[\s*`_]+$/, "")
    .trim();
}

/**
 * Locate a protocol directive anywhere in one line. Returns null for normal
 * note text. `before` keeps any real note text that preceded it.
 */
export function findProtocolDirective(line: string): ProtocolDirective | null {
  const hit = DIRECTIVE_RE.exec(line);
  if (!hit) return null;
  const prefix = line.slice(0, hit.index);
  const before = DECORATION_ONLY_RE.test(prefix)
    ? ""
    : prefix.replace(/[*_`]+$/, "").trimEnd();
  return {
    before,
    name: hit[1]!.toLowerCase(),
    rest: cleanPayload(line.slice(hit.index + hit[0].length)),
  };
}

/**
 * Remove every protocol directive (and its same-line payload) from finished
 * markdown. Note text before a mid-line directive is kept.
 */
export function stripProtocolLines(markdown: string): string {
  if (!markdown.includes("@@")) return markdown;
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const directive = findProtocolDirective(line);
    if (!directive) {
      out.push(line);
    } else if (directive.before.trim()) {
      out.push(directive.before);
    }
  }
  return out.join("\n");
}

/** Section ids are bare tokens; models sometimes wrap them in [..] or `..`. */
function directiveTarget(rest: string): string {
  const first = rest.split(/\s+/)[0] ?? "";
  return first.replace(/^[[(<`"'*]+|[\])>`"'*:.,]+$/g, "");
}

/** Same-line payload after @@append worth keeping (a real markdown block). */
function appendPayloadLine(rest: string): string | null {
  return /^(#{2,3}\s|[-*]\s|\d{1,2}\.\s|\|)/.test(rest) ? rest : null;
}

export function createMarkerParser(
  allowedReviseIds: Set<string>,
  appendSectionId: string
): MarkerParser {
  type Mode =
    | "preamble"
    | "append"
    | "revise"
    | "delete"
    | "summary"
    | "skip";
  let mode: Mode = "preamble";
  let line = "";
  const summaryParts: string[] = [];

  const isBody = () =>
    mode === "append" ||
    mode === "revise" ||
    mode === "delete";

  const contentLine = (text: string, out: LiveNotesStreamEvent[]) => {
    if (isBody()) {
      if (CODE_FENCE_RE.test(text)) return;
      out.push({ type: "text", delta: `${text}\n` });
    } else if (mode === "summary") {
      summaryParts.push(text);
    }
  };

  const applyDirective = (
    directive: ProtocolDirective,
    out: LiveNotesStreamEvent[]
  ) => {
    const { name, rest } = directive;
    if (name === "append") {
      mode = "append";
      out.push({ type: "op", op: "append", sectionId: appendSectionId });
      const payload = appendPayloadLine(rest);
      if (payload) contentLine(payload, out);
    } else if (name === "revise" || name === "delete") {
      const id = directiveTarget(rest);
      if (id && allowedReviseIds.has(id)) {
        mode = name;
        out.push({ type: "op", op: name, sectionId: id });
      } else {
        // Unknown target — swallow its body entirely.
        mode = "skip";
      }
    } else if (name === "summary") {
      mode = "summary";
      if (rest) summaryParts.push(rest);
    } else if (name === "thought") {
      if (rest) out.push({ type: "thought", message: rest });
    } else {
      // Any other @@ directive is protocol noise — drop it and its body.
      mode = "skip";
    }
  };

  const completeLine = (out: LiveNotesStreamEvent[]) => {
    const raw = line.replace(/\r$/, "");
    line = "";
    const directive = findProtocolDirective(raw);
    if (!directive) {
      contentLine(raw, out);
      return;
    }
    if (directive.before) contentLine(directive.before, out);
    applyDirective(directive, out);
  };

  return {
    push(deltaText: string): LiveNotesStreamEvent[] {
      const out: LiveNotesStreamEvent[] = [];
      let buf = deltaText;
      while (buf.length > 0) {
        const nl = buf.indexOf("\n");
        if (nl < 0) {
          line += buf;
          break;
        }
        line += buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        completeLine(out);
      }
      return out;
    },
    flush(): LiveNotesStreamEvent[] {
      const out: LiveNotesStreamEvent[] = [];
      if (line.length > 0) completeLine(out);
      return out;
    },
    summaryText(): string {
      return summaryParts.join("\n").trim();
    },
  };
}
