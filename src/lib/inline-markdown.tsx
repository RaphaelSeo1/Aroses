import type { ReactNode } from "react";

/**
 * Lightweight inline markdown for course snippets — bold, italic, code.
 * Block syntax (headings, lists) is not supported; use LessonRichContent
 * for full lesson pages.
 */
export function parseInlineMarkdown(text: string): ReactNode[] {
  if (!text) return [];

  const re = /(\*\*[^*]+?\*\*|\*[^*]+?\*|`[^`]+?`)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(text.slice(last, m.index));
    }
    const raw = m[0];
    const key = `md-${m.index}`;
    if (raw.startsWith("**")) {
      out.push(
        <strong key={key} className="font-semibold text-zinc-900">
          {raw.slice(2, -2)}
        </strong>
      );
    } else if (raw.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-zinc-100 px-1 py-0.5 text-[0.92em] text-zinc-900"
        >
          {raw.slice(1, -1)}
        </code>
      );
    } else {
      out.push(<em key={key}>{raw.slice(1, -1)}</em>);
    }
    last = m.index + raw.length;
  }

  if (last < text.length) {
    out.push(text.slice(last));
  }

  return out;
}

/** Strip optional markdown emphasis wrappers around a matched term. */
export function stripInlineMarkdownWrappers(text: string): string {
  const t = text.trim();
  if (t.startsWith("**") && t.endsWith("**") && t.length > 4) {
    return t.slice(2, -2);
  }
  if (t.startsWith("*") && t.endsWith("*") && t.length > 2 && !t.startsWith("**")) {
    return t.slice(1, -1);
  }
  if (t.startsWith("`") && t.endsWith("`") && t.length > 2) {
    return t.slice(1, -1);
  }
  return text;
}
