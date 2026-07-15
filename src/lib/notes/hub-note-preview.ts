import {
  noteNodesToMarkdown,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";

/**
 * Build markdown for Notes hub card thumbnails from TipTap JSON (preferred)
 * or plain text fallback — keeps headings/lists/bold so the preview reads
 * like the opened note instead of a flat word snippet.
 */
export function hubNotePreviewMarkdown(
  contentJson: unknown,
  contentText: unknown,
  maxChars = 1600
): string | null {
  let md = "";
  if (contentJson && typeof contentJson === "object") {
    const content = (contentJson as { content?: unknown }).content;
    if (Array.isArray(content) && content.length > 0) {
      md = noteNodesToMarkdown(normalizePreviewNodes(content as NoteNodeJson[]));
    }
  }
  if (!md.trim() && typeof contentText === "string") {
    md = contentText.replace(/\r\n/g, "\n").trim();
  }
  if (!md.trim()) return null;
  if (md.length <= maxChars) return md;
  const cut = md.slice(0, maxChars);
  const lastNl = cut.lastIndexOf("\n");
  const trimmed =
    lastNl > maxChars * 0.55 ? cut.slice(0, lastNl) : cut.replace(/\s+\S*$/, "");
  return `${trimmed.trimEnd()}\n…`;
}

function normalizePreviewNodes(nodes: NoteNodeJson[]): NoteNodeJson[] {
  return nodes.map((node) => {
    if (node.type === "heading") {
      const level = Number(node.attrs?.level);
      // noteNodesToMarkdown only emits ## / ### — map h1 → ## for preview.
      if (level === 1) {
        return { ...node, attrs: { ...node.attrs, level: 2 } };
      }
    }
    if (node.type === "taskList") {
      return {
        type: "bulletList",
        content: (node.content ?? []).map((item) => {
          if (item.type !== "listItem" && (item as NoteNodeJson).type !== "taskItem") {
            return item as NoteNodeJson;
          }
          return {
            type: "listItem",
            content: (item as NoteNodeJson).content,
          };
        }),
      };
    }
    return node;
  });
}
