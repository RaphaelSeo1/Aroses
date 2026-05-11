"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders tutor replies — Claude often uses **bold** and lists; plain &lt;p&gt;
 * showed asterisks literally.
 */
export function StudyChatMessageMarkdown({ source }: { source: string }) {
  return (
    <div className="study-chat-md text-sm leading-relaxed text-inherit [&_a]:font-medium [&_a]:text-brand [&_a]:underline-offset-2 [&_a]:hover:underline dark:[&_a]:text-brand-soft [&_code]:rounded [&_code]:bg-zinc-200/90 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[13px] dark:[&_code]:bg-zinc-800 [&_em]:italic [&_li]:my-0.5 [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:last:mb-0 [&_p]:mb-2 [&_p]:last:mb-0 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:last:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => (
            <a
              href={href}
              target={href?.startsWith("http") ? "_blank" : undefined}
              rel={
                href?.startsWith("http") ? "noreferrer noopener" : undefined
              }
              {...rest}
            >
              {children}
            </a>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
