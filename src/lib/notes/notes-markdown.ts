/**
 * Shared markdown ⇄ TipTap-JSON grammar for AI-generated study notes.
 *
 * The note-generation models emit a deliberately tiny markdown subset:
 *   - "## " / "### "  headings (topic changes)
 *   - "- " bullets, "  - " one level of nesting
 *   - "1. " ordered items (worked examples, step-by-step)
 *   - "**term**" bold key terms
 *   - "> (AI) " AI-added context the lecturer did NOT say (rendered as a
 *     visually distinct callout, provenance "ai-context")
 *   - GFM pipe tables (`| col | col |` + `| --- | --- |` separator)
 *   - "---" horizontal rule
 *
 * This module is pure (no editor, no DOM) so BOTH consumers share one
 * grammar: the client `StreamingNotesWriter` (incremental, line-at-a-time)
 * and the server wrap-up review (whole-document, in
 * `src/lib/ai/live-lecture-notes.ts`). Divergence between the two would
 * corrupt round-trips (doc → markdown → model → markdown → doc), so keep
 * every rule here.
 */

/** Default highlighter color for key terms (`**bold**` / TipTap highlight). */
export const KEY_TERM_HIGHLIGHT_COLOR = "#fde68a";

export type NoteMarkJson = {
  type: string;
  attrs?: Record<string, string>;
};

/** Bold + highlight together — one visual treatment for key terms. */
export function keyTermMarks(): NoteMarkJson[] {
  return [
    { type: "bold" },
    { type: "highlight", attrs: { color: KEY_TERM_HIGHLIGHT_COLOR } },
  ];
}

export type NoteInlineJson = {
  type: "text";
  text: string;
  marks?: NoteMarkJson[];
};

export type NoteNodeJson = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<NoteNodeJson | NoteInlineJson>;
  text?: string;
  marks?: NoteMarkJson[];
};

export type NoteLineKind =
  | { kind: "heading"; level: 2 | 3; text: string; prefixLen: number }
  | { kind: "bullet"; depth: 0 | 1; text: string; prefixLen: number }
  | { kind: "ordered"; text: string; prefixLen: number }
  | { kind: "aiContext"; text: string; prefixLen: number }
  | { kind: "hr" }
  | { kind: "blank" }
  | { kind: "paragraph"; text: string; prefixLen: number };

/**
 * True while a partial line could still turn into a block prefix — the
 * streaming writer holds these few characters back until the prefix is
 * decided, so a "## " never flashes as literal text.
 */
export function mightBecomeNotePrefix(buf: string): boolean {
  if (buf.length === 0) return true;
  if (buf.length >= 8) return false;
  return (
    /^#{1,3}$/.test(buf) ||
    /^ {1,3}$/.test(buf) ||
    /^ {0,3}[-*]$/.test(buf) ||
    /^-{1,7}$/.test(buf) ||
    /^\d{1,2}\.?$/.test(buf) ||
    /^> ?\(?A?I?\)? ?$/.test(buf)
  );
}

/**
 * Classify a line (or the confirmed start of one). `text` is the content
 * after the prefix; for partial lines the caller streams the rest in later.
 */
export function classifyNoteLine(line: string): NoteLineKind {
  if (line.trim().length === 0) return { kind: "blank" };
  if (/^-{3,}\s*$/.test(line)) return { kind: "hr" };

  const heading = line.match(/^(#{1,3}) (.*)$/);
  if (heading) {
    return {
      kind: "heading",
      level: heading[1].length >= 3 ? 3 : 2,
      text: heading[2],
      prefixLen: heading[1].length + 1,
    };
  }

  const nestedBullet = line.match(/^( {2,3})[-*] (.*)$/);
  if (nestedBullet) {
    return {
      kind: "bullet",
      depth: 1,
      text: nestedBullet[2],
      prefixLen: nestedBullet[1].length + 2,
    };
  }

  const bullet = line.match(/^[-*] (.*)$/);
  if (bullet) {
    return { kind: "bullet", depth: 0, text: bullet[1], prefixLen: 2 };
  }

  const ordered = line.match(/^(\d{1,2})\. (.*)$/);
  if (ordered) {
    return {
      kind: "ordered",
      text: ordered[2],
      prefixLen: ordered[1].length + 2,
    };
  }

  const aiContext = line.match(/^> (?:\(AI\) )?(.*)$/);
  if (aiContext) {
    const prefixLen = line.length - aiContext[1].length;
    return { kind: "aiContext", text: aiContext[1], prefixLen };
  }

  return { kind: "paragraph", text: line, prefixLen: 0 };
}

/**
 * Strip dangling / unclosed emphasis markers left by truncated streams so
 * students don't see stray `*` / `**` in the finished line. Complete
 * `**bold**` and `*italic*` spans are preserved.
 */
export function sanitizeIncompleteInlineMarkdown(text: string): string {
  if (!text.includes("*")) return text;
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close === -1) {
        // Unclosed bold — drop the opening markers, keep the rest.
        out += text.slice(i + 2);
        break;
      }
      out += text.slice(i, close + 2);
      i = close + 2;
      continue;
    }
    if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      if (close === -1 || text[close + 1] === "*") {
        // Unclosed italic (or a lone `*` before `**`) — drop this marker.
        i += 1;
        continue;
      }
      out += text.slice(i, close + 1);
      i = close + 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
}

/**
 * Parse `**bold**` and `*italic*` spans into TipTap text nodes.
 * Unclosed markers are left literal — call
 * `sanitizeIncompleteInlineMarkdown` first when finalizing a line.
 */
export function parseInlineMarkdown(text: string): NoteInlineJson[] {
  const out: NoteInlineJson[] = [];
  let i = 0;
  let plain = "";

  const flushPlain = () => {
    if (plain) {
      out.push({ type: "text", text: plain });
      plain = "";
    }
  };

  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const close = text.indexOf("**", i + 2);
      if (close === -1) {
        plain += text.slice(i);
        break;
      }
      flushPlain();
      const inner = text.slice(i + 2, close);
      if (inner) {
        out.push({ type: "text", text: inner, marks: keyTermMarks() });
      }
      i = close + 2;
      continue;
    }
    if (text[i] === "*") {
      const close = text.indexOf("*", i + 1);
      // Don't treat `**` (handled above) or empty `**` as italic.
      if (close === -1 || close === i + 1 || text[close + 1] === "*") {
        plain += "*";
        i += 1;
        continue;
      }
      flushPlain();
      const inner = text.slice(i + 1, close);
      if (inner) {
        out.push({ type: "text", text: inner, marks: [{ type: "italic" }] });
      }
      i = close + 1;
      continue;
    }
    plain += text[i];
    i += 1;
  }
  flushPlain();
  return out.filter((n) => n.text.length > 0);
}

function inlineToMarkdown(
  content: Array<NoteNodeJson | NoteInlineJson> | undefined
): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((n) => {
      if (typeof n.text !== "string") {
        return inlineToMarkdown((n as NoteNodeJson).content);
      }
      const bold = n.marks?.some((m) => m.type === "bold");
      const italic = n.marks?.some((m) => m.type === "italic");
      let t = n.text;
      if (bold) t = `**${t}**`;
      else if (italic) t = `*${t}*`;
      return t;
    })
    .join("");
}

function paragraphOf(inline: NoteInlineJson[]): NoteNodeJson {
  return inline.length > 0
    ? { type: "paragraph", content: inline }
    : { type: "paragraph" };
}

/** True for a GFM pipe row (`| a | b |`). Leading `|` required to avoid math `|x|`. */
export function isGfmTableRowLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|")) return false;
  if (isGfmTableSeparatorLine(t)) return false;
  return t.includes("|", 1);
}

/** True for a GFM alignment/separator row (`| --- | :---: |`). */
export function isGfmTableSeparatorLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !/-{3,}/.test(t)) return false;
  const cells = splitTableCells(t);
  if (cells.length === 0) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c));
}

export function isGfmTableLine(line: string): boolean {
  return isGfmTableRowLine(line) || isGfmTableSeparatorLine(line);
}

function splitTableCells(line: string): string[] {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").map((c) => c.trim());
}

function tableCellNode(
  text: string,
  type: "tableHeader" | "tableCell"
): NoteNodeJson {
  return {
    type,
    content: [paragraphOf(parseInlineMarkdown(text))],
  };
}

/**
 * Consume a GFM pipe table starting at `start`. Returns the TipTap table
 * node and the index of the first line after the table.
 */
export function consumeGfmTable(
  lines: string[],
  start: number
): { node: NoteNodeJson; end: number } | null {
  if (start >= lines.length || !isGfmTableLine(lines[start]!)) return null;

  const block: string[] = [];
  let i = start;
  while (i < lines.length && isGfmTableLine(lines[i]!)) {
    block.push(lines[i]!);
    i += 1;
  }
  if (block.length === 0) return null;

  let header: string[] | null = null;
  const body: string[][] = [];
  let idx = 0;

  if (
    block.length >= 2 &&
    isGfmTableRowLine(block[0]!) &&
    isGfmTableSeparatorLine(block[1]!)
  ) {
    header = splitTableCells(block[0]!);
    idx = 2;
  }

  for (; idx < block.length; idx++) {
    const line = block[idx]!;
    if (isGfmTableSeparatorLine(line)) continue;
    if (isGfmTableRowLine(line)) body.push(splitTableCells(line));
  }

  // Models sometimes omit the separator — treat the first data row as header.
  if (!header) {
    if (body.length === 0) return null;
    header = body.shift()!;
  }

  const colCount = Math.max(header.length, ...body.map((r) => r.length), 1);
  const pad = (cells: string[]): string[] => {
    const out = cells.slice(0, colCount);
    while (out.length < colCount) out.push("");
    return out;
  };

  const rows: NoteNodeJson[] = [
    {
      type: "tableRow",
      content: pad(header).map((c) => tableCellNode(c, "tableHeader")),
    },
    ...body.map((r) => ({
      type: "tableRow",
      content: pad(r).map((c) => tableCellNode(c, "tableCell")),
    })),
  ];

  return { node: { type: "table", content: rows }, end: i };
}

function tableToMarkdown(node: NoteNodeJson): string {
  const rows = (node.content ?? []) as NoteNodeJson[];
  const cellTexts: string[][] = [];
  for (const row of rows) {
    if (row.type !== "tableRow") continue;
    const cells = (row.content ?? []) as NoteNodeJson[];
    const parts = cells.map((cell) =>
      inlineToMarkdown(cell.content).replace(/\|/g, "\\|").trim()
    );
    if (parts.length > 0) cellTexts.push(parts);
  }
  if (cellTexts.length === 0) return "";

  const cols = Math.max(...cellTexts.map((r) => r.length), 1);
  const fmt = (cells: string[]) => {
    const padded = cells.slice(0, cols);
    while (padded.length < cols) padded.push("");
    return `| ${padded.join(" | ")} |`;
  };

  const out = [fmt(cellTexts[0]!)];
  out.push(`| ${Array.from({ length: cols }, () => "---").join(" | ")} |`);
  for (let r = 1; r < cellTexts.length; r++) {
    out.push(fmt(cellTexts[r]!));
  }
  return out.join("\n");
}

/**
 * Convert the markdown subset into top-level TipTap JSON nodes. Every
 * top-level node is stamped with the given provenance + sectionId
 * (ai-context callouts get provenance "ai-context" regardless).
 */
export function markdownToNoteNodes(
  markdown: string,
  opts: { sectionId?: string | null; provenance?: string | null }
): NoteNodeJson[] {
  const stamp = (node: NoteNodeJson, provenance?: string): NoteNodeJson => ({
    ...node,
    attrs: {
      ...(node.attrs ?? {}),
      provenance: provenance ?? opts.provenance ?? null,
      sectionId: opts.sectionId ?? null,
    },
  });

  const nodes: NoteNodeJson[] = [];
  type OpenList = {
    node: NoteNodeJson;
    type: "bulletList" | "orderedList";
  };
  let openList: OpenList | null = null;

  const closeList = () => {
    openList = null;
  };

  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;

    if (isGfmTableLine(rawLine)) {
      closeList();
      const table = consumeGfmTable(lines, i);
      if (table) {
        nodes.push(stamp(table.node));
        i = table.end - 1;
        continue;
      }
    }

    const line = classifyNoteLine(rawLine);
    switch (line.kind) {
      case "blank":
        closeList();
        break;
      case "hr":
        closeList();
        nodes.push(stamp({ type: "horizontalRule" }));
        break;
      case "heading":
        closeList();
        nodes.push(
          stamp({
            type: "heading",
            attrs: { level: line.level },
            content: parseInlineMarkdown(line.text.trim()),
          })
        );
        break;
      case "aiContext":
        closeList();
        nodes.push(
          stamp(
            {
              type: "callout",
              attrs: { emoji: "✨" },
              content: [paragraphOf(parseInlineMarkdown(line.text.trim()))],
            },
            "ai-context"
          )
        );
        break;
      case "paragraph":
        closeList();
        nodes.push(stamp(paragraphOf(parseInlineMarkdown(line.text.trim()))));
        break;
      case "bullet":
      case "ordered": {
        const listType = line.kind === "ordered" ? "orderedList" : "bulletList";
        const item: NoteNodeJson = {
          type: "listItem",
          content: [paragraphOf(parseInlineMarkdown(line.text.trim()))],
        };
        if (line.kind === "bullet" && line.depth === 1 && openList) {
          // Nest under the last item of the open list.
          const items = openList.node.content as NoteNodeJson[];
          const last = items[items.length - 1];
          if (last) {
            const lastContent = last.content as NoteNodeJson[];
            const tail = lastContent[lastContent.length - 1];
            if (tail && tail.type === "bulletList") {
              (tail.content as NoteNodeJson[]).push(item);
            } else {
              lastContent.push({ type: "bulletList", content: [item] });
            }
            break;
          }
        }
        if (!openList || openList.type !== listType) {
          const listNode = stamp({ type: listType, content: [item] });
          nodes.push(listNode);
          openList = { node: listNode, type: listType };
        } else {
          (openList.node.content as NoteNodeJson[]).push(item);
        }
        break;
      }
    }
  }
  return nodes;
}

function listToMarkdown(node: NoteNodeJson, ordered: boolean): string {
  const lines: string[] = [];
  let index = 1;
  for (const item of (node.content ?? []) as NoteNodeJson[]) {
    if (item.type !== "listItem") continue;
    const parts = (item.content ?? []) as NoteNodeJson[];
    const textParts: string[] = [];
    const nested: string[] = [];
    for (const part of parts) {
      if (part.type === "bulletList" || part.type === "orderedList") {
        for (const child of (part.content ?? []) as NoteNodeJson[]) {
          if (child.type !== "listItem") continue;
          nested.push(`  - ${inlineToMarkdown(child.content).trim()}`);
        }
      } else {
        textParts.push(inlineToMarkdown(part.content));
      }
    }
    const marker = ordered ? `${index}. ` : "- ";
    lines.push(`${marker}${textParts.join(" ").trim()}`);
    lines.push(...nested);
    index += 1;
  }
  return lines.join("\n");
}

/**
 * Serialize top-level note nodes back into the markdown subset — used to
 * show the model its own recent sections for grounded self-revision.
 */
export function noteNodesToMarkdown(nodes: NoteNodeJson[]): string {
  const out: string[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "heading": {
        const level = node.attrs?.level === 3 ? "###" : "##";
        out.push(`${level} ${inlineToMarkdown(node.content).trim()}`);
        break;
      }
      case "paragraph": {
        const text = inlineToMarkdown(node.content).trim();
        if (text) out.push(text);
        break;
      }
      case "bulletList":
        out.push(listToMarkdown(node, false));
        break;
      case "orderedList":
        out.push(listToMarkdown(node, true));
        break;
      case "callout": {
        const text = inlineToMarkdown(node.content).trim();
        if (!text) break;
        out.push(
          node.attrs?.provenance === "ai-context" ? `> (AI) ${text}` : `> ${text}`
        );
        break;
      }
      case "horizontalRule":
        out.push("---");
        break;
      case "image": {
        const src =
          typeof node.attrs?.src === "string" ? node.attrs.src.trim() : "";
        if (src) {
          const alt =
            typeof node.attrs?.alt === "string" ? node.attrs.alt.trim() : "";
          out.push(`![${alt}](${src})`);
        }
        break;
      }
      case "table": {
        const md = tableToMarkdown(node);
        if (md) out.push(md);
        break;
      }
      default: {
        const text = inlineToMarkdown(node.content).trim();
        if (text) out.push(text);
      }
    }
  }
  return out.join("\n").trim();
}
