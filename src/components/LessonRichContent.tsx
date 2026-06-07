"use client";

import "katex/dist/katex.min.css";
import { LessonFigure } from "@/components/LessonFigure";
import {
  extractMarkdownFigures,
  splitLeadParagraph,
  stripMarkdownFigures,
} from "@/lib/lesson-content-layout";
import { escapeCurrencyDollars } from "@/lib/markdown-math";
import type { LessonVisualAsset } from "@/types/course";
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
    <div className="mb-4 overflow-x-auto last:mb-0">
      <table
        className="min-w-full border-collapse text-sm text-zinc-800 dark:text-zinc-200"
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

function LessonBodyWithFigures({ markdown }: { markdown: string }) {
  const figures = extractMarkdownFigures(markdown);
  const textOnly = stripMarkdownFigures(markdown);
  const { lead, body } = splitLeadParagraph(textOnly);
  const [primary, ...secondary] = figures;

  return (
    <div className="space-y-4">
      {lead ? <MarkdownBlock markdown={lead} /> : null}

      {primary || body ? (
        <div className="md:flex md:items-start md:gap-6">
          {body ? (
            <div className="order-2 min-w-0 md:order-1 md:flex-1">
              <MarkdownBlock markdown={body} />
            </div>
          ) : null}

          {primary ? (
            <aside
              className={
                body
                  ? "order-1 mx-auto mb-1 w-full max-w-[280px] shrink-0 md:order-2 md:mx-0 md:mb-0 md:w-[38%] md:max-w-[260px]"
                  : "mx-auto w-full max-w-md"
              }
            >
              <LessonFigure
                src={primary.url}
                alt={primary.alt}
                variant="primary"
              />
            </aside>
          ) : null}
        </div>
      ) : null}

      {secondary.length > 0 ? (
        <div
          className={
            secondary.length === 1
              ? "mx-auto max-w-md pt-2"
              : "grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2"
          }
        >
          {secondary.map((fig) => (
            <LessonFigure
              key={fig.url}
              src={fig.url}
              alt={fig.alt}
              variant="secondary"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StructuredVisualAssets({
  assets,
  markdown,
}: {
  assets: LessonVisualAsset[];
  markdown: string;
}) {
  const inMarkdown = new Set(extractMarkdownFigures(markdown).map((f) => f.url));
  const extra = assets.filter((a) => a.imageUrl && !inMarkdown.has(a.imageUrl));
  if (extra.length === 0) return null;

  return (
    <div
      className={
        extra.length === 1
          ? "mx-auto max-w-md space-y-2 pt-2"
          : "grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2"
      }
    >
      {extra.map((asset) => (
        <figure key={asset.assetId} className="space-y-2">
          <LessonFigure
            src={asset.imageUrl}
            alt={asset.title || asset.caption}
            variant={extra.length === 1 ? "primary" : "secondary"}
          />
          {asset.whyRelevant ? (
            <figcaption className="text-center text-xs text-zinc-500 dark:text-zinc-400">
              {asset.whyRelevant}
            </figcaption>
          ) : null}
        </figure>
      ))}
    </div>
  );
}

export function LessonRichContent({
  markdown,
  visualAssets,
}: {
  markdown: string;
  visualAssets?: LessonVisualAsset[];
}) {
  if (!markdown.trim() && (!visualAssets || visualAssets.length === 0)) {
    return (
      <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
        No lesson text yet. Use Edit to add notes, images, and equations.
      </p>
    );
  }

  const hasFigures = extractMarkdownFigures(markdown).length > 0;
  const hasStructured =
    visualAssets?.some((a) => a.imageUrl?.trim()) ?? false;

  return (
    <div className="lesson-md text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 [&_.katex-display]:my-4 [&_.katex]:text-[1.05em]">
      {hasFigures ? (
        <LessonBodyWithFigures markdown={markdown} />
      ) : markdown.trim() ? (
        <MarkdownBlock markdown={markdown} />
      ) : null}
      {hasStructured && visualAssets ? (
        <StructuredVisualAssets assets={visualAssets} markdown={markdown} />
      ) : null}
    </div>
  );
}
