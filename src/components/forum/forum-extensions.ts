import type { AnyExtension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";

/**
 * Shared TipTap schema for forum post bodies. Used both by the editor
 * (`RichTextEditor`) and the read-only renderer (`RichContent`) so what you
 * author is exactly what renders.
 *
 * Link/image URLs are sanitized server-side at write time (see
 * `@/lib/forum/rich-text`), so the rendered output is safe by construction.
 */
export function buildForumExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
    }),
    Underline,
    Highlight.configure({ multicolor: true }),
    Link.configure({
      openOnClick: true,
      autolink: true,
      protocols: ["http", "https", "mailto"],
      HTMLAttributes: {
        class: "forum-rich-link",
        rel: "noopener noreferrer nofollow",
        target: "_blank",
      },
    }),
    Image.configure({
      inline: false,
      HTMLAttributes: { class: "forum-rich-img" },
    }),
  ];
}
