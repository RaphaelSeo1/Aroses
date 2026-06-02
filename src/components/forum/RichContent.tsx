"use client";

import { useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { buildForumExtensions } from "@/components/forum/forum-extensions";
import { ForumProseStyles } from "@/components/forum/ForumProseStyles";
import { forumDocIsEmpty } from "@/lib/forum/rich-text";

/**
 * Read-only renderer for a forum post body.
 *
 * - When `json` is a non-empty TipTap doc, it's rendered through the same
 *   schema the editor uses (a non-editable editor instance).
 * - Otherwise it falls back to the plain-text `fallback` (legacy posts that
 *   predate rich bodies, or posts authored as plain text).
 *
 * Link/image URLs are sanitized server-side at write time, so the rendered
 * output is safe.
 */
export function RichContent({
  json,
  fallback,
  className,
}: {
  json: unknown;
  fallback: string;
  className?: string;
}) {
  const hasRich = useMemo(
    () => Boolean(json) && !forumDocIsEmpty(json),
    [json]
  );

  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      extensions: buildForumExtensions(),
      content: hasRich ? (json as object) : null,
      editorProps: { attributes: { class: "forum-rich" } },
    },
    [hasRich, json]
  );

  return (
    <div className={className}>
      <ForumProseStyles />
      {hasRich && editor ? (
        <EditorContent editor={editor} />
      ) : fallback ? (
        <div className="forum-rich whitespace-pre-wrap">{fallback}</div>
      ) : null}
    </div>
  );
}
