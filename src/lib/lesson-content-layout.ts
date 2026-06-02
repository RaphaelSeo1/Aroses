export type MarkdownFigure = {
  alt: string;
  url: string;
};

const MD_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** Pull markdown image references out of lesson body text. */
export function extractMarkdownFigures(markdown: string): MarkdownFigure[] {
  const figures: MarkdownFigure[] = [];
  for (const match of markdown.matchAll(MD_IMAGE_RE)) {
    figures.push({ alt: match[1], url: match[2] });
  }
  return figures;
}

/** Remove markdown images so the remaining text can flow beside figures. */
export function stripMarkdownFigures(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]+\)\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Remove markdown images and HTML `<img>` tags from lesson body text. */
export function stripAllImagesFromMarkdown(markdown: string): string {
  let s = stripMarkdownFigures(markdown);
  s = s.replace(/<img\b[^>]*\/?>\s*/gi, "");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}

/** Split lead paragraph from the rest of the lesson body. */
export function splitLeadParagraph(markdown: string): {
  lead: string;
  body: string;
} {
  const trimmed = markdown.trim();
  if (!trimmed) return { lead: "", body: "" };
  const breakAt = trimmed.indexOf("\n\n");
  if (breakAt === -1) return { lead: trimmed, body: "" };
  return {
    lead: trimmed.slice(0, breakAt).trim(),
    body: trimmed.slice(breakAt + 2).trim(),
  };
}

/** Short caption for a figure (drops the "from filename.ext" suffix). */
export function figureCaption(alt: string): string {
  const fromIdx = alt.lastIndexOf(" from ");
  return fromIdx > 0 ? alt.slice(0, fromIdx).trim() : alt.trim();
}

export function lessonMarkdownHasImages(content: string): boolean {
  return extractMarkdownFigures(content).length > 0;
}
