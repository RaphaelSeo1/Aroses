"use client";

import "katex/dist/katex.min.css";
import {
  splitLeadParagraph,
  splitMarkdownBeforeFirstTable,
  stripMarkdownFigures,
} from "@/lib/lesson-content-layout";
import { splitParagraphs } from "@/lib/course-build/figure-markers";
import { escapeCurrencyDollars } from "@/lib/markdown-math";
import type { LessonVisualAsset } from "@/types/course";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const markdownComponents = {
  h1: (props: React.ComponentProps<"h1">) => (
    <h1
      dir="auto"
      className="mb-3 mt-6 text-2xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50"
      {...props}
    />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <h2
      dir="auto"
      className="mb-2 mt-5 text-xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
      {...props}
    />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3
      dir="auto"
      className="mb-2 mt-4 text-lg font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
      {...props}
    />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p dir="auto" className="mb-4 last:mb-0" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul dir="auto" className="mb-4 list-disc space-y-1 ps-5 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol dir="auto" className="mb-4 list-decimal space-y-1 ps-5 last:mb-0" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => (
    <li className="ps-0.5" {...props} />
  ),
  a: ({
    href,
    children,
    ...rest
  }: React.ComponentProps<"a"> & { href?: string }) => (
    <a
      href={href}
      className="font-medium text-brand underline-offset-2 hover:underline dark:text-brand-soft"
      target={href?.startsWith("http") ? "_blank" : undefined}
      rel={href?.startsWith("http") ? "noreferrer" : undefined}
      {...rest}
    >
      {children}
    </a>
  ),
  blockquote: (props: React.ComponentProps<"blockquote">) => (
    <blockquote
      dir="auto"
      className="mb-4 border-s-4 border-zinc-200 ps-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
      {...props}
    />
  ),
  pre: (props: React.ComponentProps<"pre">) => (
    <pre
      className="mb-4 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-sm text-zinc-900 last:mb-0 dark:bg-zinc-900 dark:text-zinc-100"
      {...props}
    />
  ),
  table: (props: React.ComponentProps<"table">) => (
    <div className="mb-4 w-full overflow-x-auto last:mb-0">
      <table
        dir="auto"
        className="w-full min-w-[28rem] border-collapse text-sm text-zinc-800 dark:text-zinc-200"
        {...props}
      />
    </div>
  ),
  thead: (props: React.ComponentProps<"thead">) => (
    <thead className="bg-zinc-100 dark:bg-zinc-800/80" {...props} />
  ),
  th: (props: React.ComponentProps<"th">) => (
    <th
      className="border border-zinc-200 px-3 py-2 text-start font-semibold dark:border-zinc-700"
      {...props}
    />
  ),
  td: (props: React.ComponentProps<"td">) => (
    <td
      className="border border-zinc-200 px-3 py-2 align-top dark:border-zinc-700"
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...rest
  }: React.ComponentProps<"code"> & { className?: string }) => {
    const fenced = Boolean(className?.includes("language-"));
    if (fenced) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-zinc-100 px-1.5 py-0.5 text-sm text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
        {...rest}
      >
        {children}
      </code>
    );
  },
};

function MarkdownBlock({ markdown }: { markdown: string }) {
  if (!markdown.trim()) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {escapeCurrencyDollars(markdown)}
    </ReactMarkdown>
  );
}

const textLockClass =
  "lesson-text-lock w-full min-w-0 text-[15px] leading-relaxed text-zinc-700 [text-size-adjust:100%] [-webkit-text-size-adjust:100%] dark:text-zinc-300 [&_.katex-display]:my-4 [&_.katex]:text-[1.05em]";

function LessonFigure({ asset }: { asset: LessonVisualAsset }) {
  const caption = asset.caption || asset.title || (asset.sourcePage ? `From page ${asset.sourcePage} of your file` : "");
  return (
    <figure className="my-2 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/40">
      <a href={asset.imageUrl} target="_blank" rel="noreferrer" className="block bg-white p-2">
        {/* Figures are user-file crops on Supabase storage; next/image adds nothing here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={asset.imageUrl}
          alt={caption || "Figure from your file"}
          loading="lazy"
          className="mx-auto max-h-[28rem] w-auto max-w-full object-contain"
        />
      </a>
      {caption ? (
        <figcaption dir="auto" className="border-t border-zinc-100 px-3 py-2 text-[13px] leading-snug text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

/** Text runs with each figure after the paragraph the writer placed it under. */
function ContentWithFigures({ markdown, figures }: { markdown: string; figures: LessonVisualAsset[] }) {
  const paragraphs = splitParagraphs(markdown);
  const at = (f: LessonVisualAsset) =>
    Math.min(paragraphs.length, Math.max(0, f.placementAfterParagraph ?? paragraphs.length));
  const sorted = figures.slice().sort((a, b) => at(a) - at(b));
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const [i, f] of sorted.entries()) {
    const to = at(f);
    if (to > from) {
      parts.push(
        <div key={`t${i}`} className={textLockClass}>
          <MarkdownBlock markdown={paragraphs.slice(from, to).join("\n\n")} />
        </div>
      );
      from = to;
    }
    parts.push(<LessonFigure key={`f${f.assetId}`} asset={f} />);
  }
  if (from < paragraphs.length) {
    parts.push(
      <div key="rest" className={textLockClass}>
        <MarkdownBlock markdown={paragraphs.slice(from).join("\n\n")} />
      </div>
    );
  }
  return <div className="space-y-4">{parts}</div>;
}

/** Lesson body: opening text, then prose, then tables, with source figures where the writer placed them. */
export function LessonRichContent({
  markdown,
  figures,
}: {
  markdown: string;
  figures?: LessonVisualAsset[];
}) {
  const placed = (figures ?? []).filter((f) => f.imageUrl?.trim() && f.type !== "page_snapshot");
  if (markdown.trim() && placed.length > 0) {
    return <ContentWithFigures markdown={stripMarkdownFigures(markdown)} figures={placed} />;
  }
  if (!markdown.trim()) {
    return (
      <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
        No lesson text yet. Use Edit to add notes and equations.
      </p>
    );
  }

  const textMarkdown = stripMarkdownFigures(markdown);
  const { lead, body } = splitLeadParagraph(textMarkdown);
  const hasSplit = Boolean(body.trim());
  const bodySource = hasSplit ? body : textMarkdown;
  const { prose: proseBeforeTable, tables: tableMarkdown } =
    splitMarkdownBeforeFirstTable(bodySource);

  const leadBlock =
    hasSplit && lead.trim() ? (
      <div className={textLockClass}>
        <MarkdownBlock markdown={lead} />
      </div>
    ) : null;

  const proseBlock = proseBeforeTable.trim() ? (
    <div className={textLockClass}>
      <MarkdownBlock markdown={proseBeforeTable} />
    </div>
  ) : null;

  const tableBlock = tableMarkdown.trim() ? (
    <div className={textLockClass}>
      <MarkdownBlock markdown={tableMarkdown} />
    </div>
  ) : null;

  if (!leadBlock && !proseBlock && !tableBlock) {
    return (
      <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
        No lesson text yet. Use Edit to add notes and equations.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {leadBlock}
      {proseBlock}
      {tableBlock}
    </div>
  );
}
