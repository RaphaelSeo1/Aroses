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
 *   - "---" horizontal rule
 *
 * This module is pure (no editor, no DOM) so BOTH consumers share one
 * grammar: the client `StreamingNotesWriter` (incremental, line-at-a-time)
 * and the server wrap-up review (whole-document, in
 * `src/lib/ai/live-lecture-notes.ts`). Divergence between the two would
 * corrupt round-trips (doc → markdown → model → markdown → doc), so keep
 * every rule here.
 */

export type NoteInlineJson = {
  type: "text";
  text: string;
  marks?: Array<{ type: string }>;
};

export type NoteNodeJson = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: Array<NoteNodeJson | NoteInlineJson>;
  text?: string;
  marks?: Array<{ type: string }>;
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

/** Parse `**bold**` spans into TipTap text nodes. Unclosed `**` is literal. */
export function parseInlineMarkdown(text: string): NoteInlineJson[] {
  const out: NoteInlineJson[] = [];
  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf("**");
    if (open === -1) {
      out.push({ type: "text", text: rest });
      break;
    }
    const close = rest.indexOf("**", open + 2);
    if (close === -1) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (open > 0) out.push({ type: "text", text: rest.slice(0, open) });
    const inner = rest.slice(open + 2, close);
    if (inner) {
      out.push({ type: "text", text: inner, marks: [{ type: "bold" }] });
    }
    rest = rest.slice(close + 2);
  }
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
      return bold ? `**${n.text}**` : n.text;
    })
    .join("");
}

function paragraphOf(inline: NoteInlineJson[]): NoteNodeJson {
  return inline.length > 0
    ? { type: "paragraph", content: inline }
    : { type: "paragraph" };
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

  for (const rawLine of markdown.split("\n")) {
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
      default: {
        const text = inlineToMarkdown(node.content).trim();
        if (text) out.push(text);
      }
    }
  }
  return out.join("\n").trim();
}
