import {
  MAX_CHAT_ATTACHMENT_CHARS,
  MIN_CHAT_ATTACHMENT_CHARS,
} from "./chat-attachment-formats";

export type ChatAttachedFile = { name: string; text: string };

export type ParsedChatAttachments = {
  text: string;
  name: string;
  files: ChatAttachedFile[];
};

function asFile(value: unknown): ChatAttachedFile | null {
  if (!value || typeof value !== "object") return null;
  const name =
    typeof (value as { name?: unknown }).name === "string"
      ? (value as { name: string }).name.trim().slice(0, 200)
      : "";
  const text =
    typeof (value as { text?: unknown }).text === "string"
      ? (value as { text: string }).text.trim()
      : "";
  if (!text || text.length < MIN_CHAT_ATTACHMENT_CHARS) return null;
  return {
    name: name || "attachment",
    text: text.slice(0, MAX_CHAT_ATTACHMENT_CHARS),
  };
}

/**
 * Accept legacy `attachedPdfText` / `attachedPdfName` plus a newer
 * `attachedFiles` array. Combined text is capped so chat prompts stay bounded.
 */
export function parseChatAttachments(body: {
  attachedPdfText?: unknown;
  attachedPdfName?: unknown;
  attachedFiles?: unknown;
}): ParsedChatAttachments {
  const files: ChatAttachedFile[] = [];
  if (Array.isArray(body.attachedFiles)) {
    for (const item of body.attachedFiles) {
      const file = asFile(item);
      if (file) files.push(file);
      if (files.length >= 8) break;
    }
  }

  if (files.length === 0) {
    const pdf = asFile({
      name:
        typeof body.attachedPdfName === "string" ? body.attachedPdfName : "",
      text:
        typeof body.attachedPdfText === "string" ? body.attachedPdfText : "",
    });
    if (pdf) files.push(pdf);
  }

  if (files.length === 0) {
    return { text: "", name: "", files: [] };
  }

  const per = Math.max(
    1_200,
    Math.floor(MAX_CHAT_ATTACHMENT_CHARS / files.length)
  );
  const text = files
    .map((f) => `### ${f.name}\n${f.text.slice(0, per)}`)
    .join("\n\n")
    .slice(0, MAX_CHAT_ATTACHMENT_CHARS);
  const name = files
    .map((f) => f.name)
    .join(", ")
    .slice(0, 200);

  return { text, name, files };
}

export function formatAttachedFilesBlock(
  parsed: ParsedChatAttachments
): string {
  if (!parsed.text) return "";
  return `ATTACHED FILE${parsed.name ? ` (${parsed.name})` : ""}:\n${parsed.text}`;
}
