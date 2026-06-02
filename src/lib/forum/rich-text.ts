/**
 * Pure helpers for forum rich-text bodies (no TipTap React imports, so this is
 * safe to use from server route handlers).
 *
 * Forum posts store their formatted body as TipTap JSON in `forum_posts.body_rich`
 * and a plain-text mirror in `forum_posts.body` (used for search/previews and
 * for any legacy plain-text posts).
 */

/** Highlighter palette offered in the forum editor — mirrors the notes editor. */
export const FORUM_HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: "#fde68a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Purple", value: "#e9d5ff" },
  { label: "Orange", value: "#fed7aa" },
];

type RichNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
  content?: RichNode[];
};

/** Cap on total nodes to keep a single post from becoming pathological. */
const MAX_NODES = 5000;
/** Cap on nesting depth (lists within lists, etc.). */
const MAX_DEPTH = 30;

/**
 * Only http(s) and mailto links are allowed — neutralizes `javascript:` and
 * other script-bearing URIs at write time so rendering is safe.
 */
function isSafeLinkHref(href: unknown): href is string {
  if (typeof href !== "string") return false;
  const v = href.trim().toLowerCase();
  return (
    v.startsWith("http://") ||
    v.startsWith("https://") ||
    v.startsWith("mailto:")
  );
}

/** Images must be http(s) URLs (we host uploads on a public Storage bucket). */
function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== "string") return false;
  const v = src.trim().toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://");
}

/**
 * Walk a TipTap doc and strip anything unsafe:
 *   - link marks whose href isn't http(s)/mailto are removed
 *   - image nodes whose src isn't http(s) are dropped
 *   - total node count / depth is bounded
 *
 * Returns a sanitized doc, or null if the input isn't a usable doc.
 */
export function sanitizeForumDoc(input: unknown): RichNode | null {
  if (!input || typeof input !== "object") return null;
  const root = input as RichNode;
  if (root.type !== "doc") return null;

  let nodeCount = 0;

  const clean = (node: RichNode, depth: number): RichNode | null => {
    if (!node || typeof node !== "object") return null;
    if (depth > MAX_DEPTH) return null;
    if (++nodeCount > MAX_NODES) return null;

    if (node.type === "image") {
      const src = node.attrs?.src;
      if (!isSafeImageSrc(src)) return null;
      return {
        type: "image",
        attrs: {
          src,
          alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : null,
          title: typeof node.attrs?.title === "string" ? node.attrs.title : null,
        },
      };
    }

    const out: RichNode = {};
    if (typeof node.type === "string") out.type = node.type;
    if (typeof node.text === "string") out.text = node.text;
    if (node.attrs && typeof node.attrs === "object") out.attrs = node.attrs;

    if (Array.isArray(node.marks)) {
      const marks = node.marks.filter((m) => {
        if (m?.type === "link") return isSafeLinkHref(m.attrs?.href);
        return true;
      });
      if (marks.length > 0) out.marks = marks;
    }

    if (Array.isArray(node.content)) {
      const content: RichNode[] = [];
      for (const child of node.content) {
        const cleaned = clean(child, depth + 1);
        if (cleaned) content.push(cleaned);
      }
      out.content = content;
    }

    return out;
  };

  return clean(root, 0);
}

/** Flatten a TipTap doc into a plain-text mirror for search/previews. */
export function forumDocToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as RichNode;
    if (typeof n.text === "string") parts.push(n.text);
    if (Array.isArray(n.content)) {
      for (const child of n.content) walk(child);
      if (n.type === "paragraph" || n.type?.startsWith("heading")) {
        parts.push("\n");
      }
    }
  };
  walk(doc);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/** True when a sanitized doc carries no visible content (text or image). */
export function forumDocIsEmpty(doc: unknown): boolean {
  if (!doc || typeof doc !== "object") return true;
  let hasContent = false;
  const walk = (node: unknown) => {
    if (hasContent || !node || typeof node !== "object") return;
    const n = node as RichNode;
    if (typeof n.text === "string" && n.text.trim().length > 0) {
      hasContent = true;
      return;
    }
    if (n.type === "image") {
      hasContent = true;
      return;
    }
    if (Array.isArray(n.content)) for (const c of n.content) walk(c);
  };
  walk(doc);
  return !hasContent;
}
