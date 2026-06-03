import Link from "next/link";
import type { ReactNode } from "react";
import type { HonestFaqItem } from "@/lib/help-honest-faq";
import { HONEST_FAQ_INTRO, HONEST_FAQ_ITEMS, HELP_APP_FAQ_ITEMS } from "@/lib/help-honest-faq";

/** Render `**bold**` and markdown links `[text](/path)` in FAQ copy. */
function FaqRichText({ text }: { text: string }) {
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

function FaqBlock({ item }: { item: HonestFaqItem }) {
  return (
    <div id={`faq-${item.id}`} className="scroll-mt-28 border-b border-zinc-100 pb-8 last:border-0 dark:border-zinc-800/80">
      <h3 className="text-base font-semibold leading-snug text-zinc-900 dark:text-zinc-50">
        {item.question}
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        {item.paragraphs.map((p, i) => (
          <p key={i}>
            <FaqRichText text={p} />
          </p>
        ))}
        {item.bullets?.length ? (
          <ul className="list-disc space-y-2 pl-5">
            {item.bullets.map((b, i) => (
              <li key={i}>
                <FaqRichText text={b} />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function HonestFaqSection() {
  return (
    <section id="faq" className="mt-16 scroll-mt-28 pb-8">
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
        {HONEST_FAQ_INTRO.title}
      </h2>
      <p className="mt-2 max-w-2xl text-sm italic text-zinc-500 dark:text-zinc-500">
        {HONEST_FAQ_INTRO.subtitle}
      </p>

      <div className="mt-8 space-y-0">
        {HONEST_FAQ_ITEMS.map((item) => (
          <FaqBlock key={item.id} item={item} />
        ))}
      </div>

      <h3 className="mt-12 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        Quick app questions
      </h3>
      <p className="mt-1 text-sm text-zinc-500">
        How features in Aroses fit together — see the sections above for walkthroughs.
      </p>
      <div className="mt-6 space-y-0">
        {HELP_APP_FAQ_ITEMS.map((item) => (
          <FaqBlock key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}
