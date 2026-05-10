"use client";

import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

export function LessonRichContent({ markdown }: { markdown: string }) {
  if (!markdown.trim()) {
    return (
      <p className="text-sm italic text-zinc-500 dark:text-zinc-400">
        No lesson text yet. Use Edit to add notes, images, and equations.
      </p>
    );
  }

  return (
    <div className="lesson-md text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300 [&_.katex-display]:my-4 [&_.katex]:text-[1.05em]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: (props) => (
            <h1
              className="mb-3 mt-6 text-2xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-50"
              {...props}
            />
          ),
          h2: (props) => (
            <h2
              className="mb-2 mt-5 text-xl font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
              {...props}
            />
          ),
          h3: (props) => (
            <h3
              className="mb-2 mt-4 text-lg font-semibold text-zinc-900 first:mt-0 dark:text-zinc-100"
              {...props}
            />
          ),
          p: (props) => <p className="mb-4 last:mb-0" {...props} />,
          ul: (props) => (
            <ul
              className="mb-4 list-disc space-y-1 pl-5 last:mb-0"
              {...props}
            />
          ),
          ol: (props) => (
            <ol
              className="mb-4 list-decimal space-y-1 pl-5 last:mb-0"
              {...props}
            />
          ),
          li: (props) => <li className="pl-0.5" {...props} />,
          a: ({ href, children, ...rest }) => (
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
          blockquote: (props) => (
            <blockquote
              className="mb-4 border-l-4 border-zinc-200 pl-4 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400"
              {...props}
            />
          ),
          pre: (props) => (
            <pre
              className="mb-4 overflow-x-auto rounded-lg bg-zinc-100 p-3 text-sm text-zinc-900 last:mb-0 dark:bg-zinc-900 dark:text-zinc-100"
              {...props}
            />
          ),
          code: ({ className, children, ...rest }) => {
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
          img: ({ src, alt, ...rest }) => (
            <span className="my-4 block">
              <img
                src={src}
                alt={alt ?? ""}
                className="max-h-[min(480px,70vh)] w-auto max-w-full rounded-lg border border-zinc-200 dark:border-zinc-700"
                loading="lazy"
                {...rest}
              />
            </span>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
