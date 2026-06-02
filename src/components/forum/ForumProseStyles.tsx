"use client";

/**
 * Shared typography for forum rich-text bodies. Rendered by both the editor and
 * the read-only renderer so authored content matches what's displayed. Scoped
 * to `.forum-rich`.
 */
export function ForumProseStyles() {
  return (
    <style jsx global>{`
      .forum-rich {
        font-size: 15px;
        line-height: 1.65;
        color: #3f3f46;
        word-break: break-word;
      }
      .dark .forum-rich {
        color: #d4d4d8;
      }
      .forum-rich:focus {
        outline: none;
      }
      .forum-rich > * + * {
        margin-top: 0.75rem;
      }
      .forum-rich h1,
      .forum-rich h2,
      .forum-rich h3 {
        font-weight: 700;
        letter-spacing: -0.01em;
        color: #18181b;
        line-height: 1.3;
      }
      .dark .forum-rich h1,
      .dark .forum-rich h2,
      .dark .forum-rich h3 {
        color: #fafafa;
      }
      .forum-rich h1 {
        font-size: 1.5rem;
      }
      .forum-rich h2 {
        font-size: 1.25rem;
      }
      .forum-rich h3 {
        font-size: 1.1rem;
      }
      .forum-rich p {
        margin: 0;
      }
      .forum-rich strong {
        font-weight: 700;
        color: #18181b;
      }
      .dark .forum-rich strong {
        color: #fafafa;
      }
      .forum-rich em {
        font-style: italic;
      }
      .forum-rich u {
        text-decoration: underline;
      }
      .forum-rich s {
        text-decoration: line-through;
      }
      .forum-rich a.forum-rich-link,
      .forum-rich a {
        color: #4f46e5;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .dark .forum-rich a {
        color: #a5b4fc;
      }
      .forum-rich ul,
      .forum-rich ol {
        padding-left: 1.4rem;
        margin: 0.25rem 0;
      }
      .forum-rich ul {
        list-style: disc;
      }
      .forum-rich ul ul {
        list-style: circle;
      }
      .forum-rich ol {
        list-style: decimal;
      }
      .forum-rich li {
        margin: 0.1rem 0;
      }
      .forum-rich li > p {
        margin: 0;
      }
      .forum-rich blockquote {
        margin: 0.5rem 0;
        padding: 0.25rem 0 0.25rem 0.9rem;
        border-left: 3px solid #d4d4d8;
        color: #52525b;
      }
      .dark .forum-rich blockquote {
        border-left-color: #3f3f46;
        color: #a1a1aa;
      }
      .forum-rich code {
        background: rgba(135, 131, 120, 0.15);
        color: #be123c;
        padding: 0.1rem 0.35rem;
        border-radius: 0.3rem;
        font-size: 0.88em;
        font-family: "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
      }
      .dark .forum-rich code {
        color: #fda4af;
      }
      .forum-rich pre {
        background: #f4f4f5;
        color: #18181b;
        padding: 0.85rem 1rem;
        border-radius: 0.6rem;
        overflow-x: auto;
        font-size: 0.86em;
        line-height: 1.6;
      }
      .dark .forum-rich pre {
        background: #18181b;
        color: #e4e4e7;
      }
      .forum-rich pre code {
        background: transparent;
        color: inherit;
        padding: 0;
      }
      .forum-rich mark {
        padding: 0.05rem 0.2rem;
        border-radius: 0.25rem;
        color: inherit;
      }
      .forum-rich hr {
        border: none;
        height: 1px;
        background: #e4e4e7;
        margin: 1.25rem 0;
      }
      .dark .forum-rich hr {
        background: #3f3f46;
      }
      .forum-rich img.forum-rich-img {
        max-width: 100%;
        height: auto;
        border-radius: 0.6rem;
        margin: 0.5rem 0;
        border: 1px solid #e4e4e7;
      }
      .dark .forum-rich img.forum-rich-img {
        border-color: #27272a;
      }
      .forum-rich img.forum-rich-img.ProseMirror-selectednode {
        outline: 2px solid #4f46e5;
        outline-offset: 2px;
      }
      .forum-rich p.is-editor-empty:first-child::before {
        content: attr(data-placeholder);
        color: #a1a1aa;
        float: left;
        height: 0;
        pointer-events: none;
      }
    `}</style>
  );
}
