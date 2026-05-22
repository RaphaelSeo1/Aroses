"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Typography from "@tiptap/extension-typography";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { Markdown } from "@tiptap/markdown";

/**
 * Rich-text editor for the Tutor Session recap.
 *
 * The recap is stored as Markdown on the server (so it round-trips
 * cleanly with the AI generator and the read-only `LessonRichContent`
 * renderer). For editing, however, the student should feel like they
 * are typing in a normal document — not staring at `##` and `>`.
 *
 * Implementation: TipTap with the official `@tiptap/markdown` extension.
 *   - Initial content is loaded with `contentType: 'markdown'` so the
 *     stored Markdown is parsed into ProseMirror nodes.
 *   - On save we call `editor.getMarkdown()` to serialize back to a
 *     Markdown string that's wire-compatible with the existing recap
 *     schema (same headings / lists / blockquotes / etc.).
 *
 * This component is purposely UNCONTROLLED — the parent gives an
 * initial markdown blob and a `getMarkdown` ref. We don't try to keep
 * React state in sync on every keystroke (would re-render the entire
 * tree on each character). The parent calls `getMarkdown()` only when
 * the Save button is pressed.
 */
export type TutorRecapEditorHandle = {
  /** Serialize the editor's current content back to Markdown. */
  getMarkdown: () => string;
};

export function TutorRecapEditor({
  initialMarkdown,
  editorRef,
  className,
}: {
  initialMarkdown: string;
  editorRef: React.RefObject<TutorRecapEditorHandle | null>;
  className?: string;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // We're providing our own Link below, but StarterKit's default
        // mark works fine — leaving it active is harmless because the
        // custom Link extension below overrides via priority.
        link: false,
      }),
      Markdown,
      Underline,
      Typography,
      Highlight,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "tn-link",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          return "Start writing your recap…";
        },
        includeChildren: false,
      }),
    ],
    editorProps: {
      attributes: {
        // Reuses the same `.tn-prose` rules NotesPanel ships so the
        // recap looks identical to the read-only LessonRichContent
        // rendering — just with a blinking caret in it.
        class:
          "tn-prose max-w-none focus:outline-none min-h-[28rem] caret-zinc-700",
      },
    },
    // Loaded as markdown via the Markdown extension — the parser
    // turns the stored Markdown string into ProseMirror JSON so the
    // student sees a normal-looking document, not raw `##`/`>` syntax.
    content: initialMarkdown,
    contentType: "markdown",
  });

  // Expose the markdown serializer to the parent via the ref. We
  // re-bind on every editor identity change (i.e. on mount).
  useEffect(() => {
    if (!editorRef || !editor) return;
    editorRef.current = {
      getMarkdown: () => editor.getMarkdown(),
    };
    return () => {
      if (editorRef.current && editorRef.current.getMarkdown === editor.getMarkdown) {
        editorRef.current = null;
      }
    };
  }, [editor, editorRef]);

  return (
    <div className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}
