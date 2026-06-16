import Link from "next/link";
import type { ReactNode } from "react";

/** Render `**bold**` and markdown links `[text](/path)` in help copy. */
export function HelpRichText({ text }: { text: string }) {
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let key = 0;

  const pushSegment = (segment: string) => {
    if (!segment) return;
    const boldRe = /\*\*([^*]+)\*\*/g;
    let bi = 0;
    let bm: RegExpExecArray | null;
    while ((bm = boldRe.exec(segment)) !== null) {
      if (bm.index > bi) {
        parts.push(segment.slice(bi, bm.index));
      }
      parts.push(
        <strong key={`b-${key++}`} className="font-semibold text-zinc-800 dark:text-zinc-200">
          {bm[1]}
        </strong>
      );
      bi = boldRe.lastIndex;
    }
    if (bi < segment.length) parts.push(segment.slice(bi));
  };

  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(text)) !== null) {
    pushSegment(text.slice(last, m.index));
    const href = m[2];
    const internal = href.startsWith("/");
    parts.push(
      internal ? (
        <Link
          key={`l-${key++}`}
          href={href}
          className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
        >
          {m[1]}
        </Link>
      ) : (
        <a
          key={`l-${key++}`}
          href={href}
          className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
          target="_blank"
          rel="noopener noreferrer"
        >
          {m[1]}
        </a>
      )
    );
    last = linkRe.lastIndex;
  }
  pushSegment(text.slice(last));

  return <>{parts}</>;
}
