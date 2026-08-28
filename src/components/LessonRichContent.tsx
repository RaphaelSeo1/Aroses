"use client";

import "katex/dist/katex.min.css";
import {
  splitLeadParagraph,
  splitMarkdownBeforeFirstTable,
  stripMarkdownFigures,
} from "@/lib/lesson-content-layout";
import { escapeCurrencyDollars } from "@/lib/markdown-math";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

const markdownComponents = {
  h1: (props: React.ComponentProps<"h1">) => (
    <h1
      className="mb-3 mt-6 text-2xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50"
      {...props}
    />
  ),
  h2: (props: React.ComponentProps<"h2">) => (
    <h2
      className="mb-2 mt-5 text-xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
      {...props}
    />
  ),
  h3: (props: React.ComponentProps<"h3">) => (
    <h3
      className="mb-2 mt-4 text-lg font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
      {...props}
    />
  ),
  p: (props: React.ComponentProps<"p">) => (
    <p className="mb-4 last:mb-0" {...props} />
  ),
  ul: (props: React.ComponentProps<"ul">) => (
    <ul className="mb-4 list-disc space-y-1 pl-5 last:mb-0" {...props} />
  ),
  ol: (props: React.ComponentProps<"ol">) => (
    <ol className="mb-4 list-decimal space-y-1 pl-5 last:mb-0" {...props} />
  ),
  li: (props: React.ComponentProps<"li">) => (
    <li className="pl-0.5" {...props} />
  ),
  strong: (props: React.ComponentProps<"strong">) => (
    <strong
      className="rounded-[0.2rem] bg-[#fde68a] px-[0.18rem] py-[0.05rem] font-bold text-inherit [box-decoration-break:clone] [[data-lesson-highlight-color]_&]:bg-transparent [[data-lesson-highlight-color]_&]:px-0 [[data-lesson-highlight-color]_&]:py-0"
      {...props}
    />
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
      className="mb-4 border-l-4 border-zinc-200 pl-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
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
      className="border border-zinc-200 px-3 py-2 text-left font-semibold dark:border-zinc-700"
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

/** Lesson body: opening text, then prose, then tables — no generated figures. */
export function LessonRichContent({ markdown }: { markdown: string }) {
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
