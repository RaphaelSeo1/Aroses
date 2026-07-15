"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Scaled document thumbnail — same structure as the opened note, not a text snip. */
export function NoteCardPreview({ markdown }: { markdown: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-white dark:bg-zinc-950">
      <div
        className="origin-top-left"
        style={{
          width: "265%",
          transform: "scale(0.378)",
        }}
      >
        <article className="note-hub-preview px-5 py-4 text-[15px] leading-[1.55] text-zinc-700 dark:text-zinc-300">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: (props) => (
                <h1
                  className="mb-2 mt-0 text-[1.55rem] font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
                  {...props}
                />
              ),
              h2: (props) => (
                <h2
                  className="mb-1.5 mt-4 text-[1.2rem] font-semibold tracking-tight text-zinc-900 first:mt-0 dark:text-zinc-50"
                  {...props}
                />
              ),
              h3: (props) => (
                <h3
                  className="mb-1 mt-3 text-[1.05rem] font-semibold text-zinc-800 first:mt-0 dark:text-zinc-100"
                  {...props}
                />
              ),
              p: (props) => (
                <p className="mb-2.5 last:mb-0" {...props} />
              ),
              ul: (props) => (
                <ul
                  className="mb-2.5 list-disc space-y-0.5 pl-5 last:mb-0"
                  {...props}
                />
              ),
              ol: (props) => (
                <ol
                  className="mb-2.5 list-decimal space-y-0.5 pl-5 last:mb-0"
                  {...props}
                />
              ),
              li: (props) => <li className="pl-0.5" {...props} />,
              strong: (props) => (
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100" {...props} />
              ),
              em: (props) => <em className="italic" {...props} />,
              blockquote: (props) => (
                <blockquote
                  className="mb-2.5 border-l-[3px] border-violet-200 bg-violet-50/50 py-1 pl-3 text-[0.95em] text-zinc-600 dark:border-violet-800 dark:bg-violet-950/30 dark:text-zinc-400"
                  {...props}
                />
              ),
              hr: () => (
                <hr className="my-3 border-0 border-t border-zinc-200 dark:border-zinc-700" />
              ),
              a: ({ children }) => (
                <span className="font-medium text-violet-700 underline underline-offset-2 dark:text-violet-300">
                  {children}
                </span>
              ),
              code: ({ children }) => (
                <code className="rounded bg-zinc-100 px-1 py-0.5 text-[0.9em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
                  {children}
                </code>
              ),
              table: (props) => (
                <div className="mb-2.5 overflow-hidden">
                  <table
                    className="w-full border-collapse text-[0.85em] text-zinc-700 dark:text-zinc-300"
                    {...props}
                  />
                </div>
              ),
              th: (props) => (
                <th
                  className="border border-zinc-200 bg-zinc-50 px-1.5 py-1 text-left font-semibold dark:border-zinc-700 dark:bg-zinc-900"
                  {...props}
                />
              ),
              td: (props) => (
                <td
                  className="border border-zinc-200 px-1.5 py-1 align-top dark:border-zinc-700"
                  {...props}
                />
              ),
              img: ({ src, alt }) =>
                typeof src === "string" && src ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt={typeof alt === "string" ? alt : ""}
                    className="my-2 max-h-40 w-auto max-w-full rounded-md border border-zinc-200 object-cover dark:border-zinc-700"
                  />
                ) : null,
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      </div>
      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-zinc-950 dark:via-zinc-950/80" />
    </div>
  );
}
