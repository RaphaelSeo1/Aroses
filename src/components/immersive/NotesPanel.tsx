"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Typography from "@tiptap/extension-typography";
import { SlashCommand } from "./notes/SlashCommand";
import { Callout } from "./notes/Callout";

/**
 * Premium Notion-style notes panel docked to the right side of
 * Mentored Learning.
 *
 * Surface goals (per spec):
 *   - Feels like opening a Notion page — generous whitespace, clean
 *     typography hierarchy, document title up top.
 *   - Rich formatting: H1/H2/H3, bold/italic/underline/strike,
 *     bullet / numbered / task lists with nesting, code blocks,
 *     blockquotes, dividers, links, highlights, callouts.
 *   - Slash-command menu (Notion-style) for inserting blocks.
 *   - Bubble menu over selections for inline formatting.
 *   - Auto-save with a subtle, fading "Saved" indicator.
 *
 * Storage / data contract is unchanged:
 *   - GET/PUT /api/mentored/notes/[materialId]
 *   - Same JSON+text payload shape.
 *   - Same imperative `appendBlock` handle the parent uses for
 *     auto-generated notes (only the *formatting* of what gets
 *     appended is richer now — H2 + intro + nested bullets +
 *     optional callout instead of an H3 + flat bullets).
 */

export type NoteSuggestion = {
  id: string;
  text: string;
  /** Optional heading shown above the text in the suggestion card. */
  heading?: string;
};

export type AutoGenerateBlock = {
  /** H2 heading — typically the chunk concept. */
  heading: string;
  /** Optional intro paragraph above the bullets. */
  intro?: string;
  /** Top-level bullets. Each can optionally have nested sub-bullets. */
  bullets: Array<
    | string
    | {
        text: string;
        /**
         * When set, the leading word(s) become bold (key term style).
         * E.g. `{ text: "Mitochondria are the energy hubs...", bold: "Mitochondria" }`
         */
        bold?: string;
        children?: string[];
      }
  >;
  /** Optional callout block appended below the bullets (key takeaway). */
  callout?: { emoji?: string; text: string };
};

export type NotesPanelHandle = {
  /** Append a structured block (heading + optional intro + bullets + optional callout). */
  appendBlock: (input: AutoGenerateBlock) => void;
};

/**
 * Pick a deterministic emoji for the doc title based on the course /
 * lesson name. Cheap heuristic — better than nothing, no AI call.
 * Falls back to 📝.
 */
function pickDocEmoji(title: string): string {
  const t = title.toLowerCase();
  const map: { keys: string[]; emoji: string }[] = [
    { keys: ["biology", "cell", "anatomy", "physiology", "organ", "dna", "gene"], emoji: "🧬" },
    { keys: ["heart", "cardio", "blood"], emoji: "❤️" },
    { keys: ["brain", "neuro", "nerv"], emoji: "🧠" },
    { keys: ["chem"], emoji: "🧪" },
    { keys: ["physics", "force", "energy", "atom", "quantum"], emoji: "⚛️" },
    { keys: ["math", "algebra", "calculus", "geometry"], emoji: "📐" },
    { keys: ["history", "war", "ancient", "empire"], emoji: "🏛️" },
    { keys: ["geo", "earth", "map", "climate"], emoji: "🌍" },
    { keys: ["space", "astron", "planet"], emoji: "🪐" },
    { keys: ["code", "program", "software", "comput", "algo"], emoji: "💻" },
    { keys: ["lit", "english", "poem", "novel", "writing"], emoji: "📖" },
    { keys: ["psych", "behavior", "mind"], emoji: "🧠" },
    { keys: ["econ", "market", "money", "finance"], emoji: "💰" },
    { keys: ["law", "legal", "policy"], emoji: "⚖️" },
    { keys: ["music", "song", "rhythm"], emoji: "🎵" },
    { keys: ["art", "design", "paint"], emoji: "🎨" },
    { keys: ["language", "grammar", "vocab"], emoji: "🗣️" },
  ];
  for (const { keys, emoji } of map) {
    if (keys.some((k) => t.includes(k))) return emoji;
  }
  return "📝";
}

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0 || diff < 4 * 1000) return "just now";
  if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

/** Strip a TipTap doc → plain text mirror for the server payload. */
function docToPlainText(doc: unknown): string {
  if (!doc || typeof doc !== "object") return "";
  const parts: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; text?: string; content?: unknown[] };
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

export function NotesPanel({
  materialId,
  notesEndpoint,
  lessonTitle,
  courseTitle,
  suggestions,
  onConsumeSuggestion,
  autoGenerate,
  onAutoGenerateChange,
  className,
  editorRef,
}: {
  /**
   * Mentored Learning path — when set, the panel reads/writes
   * `/api/mentored/notes/[materialId]`. Mutually exclusive with
   * `notesEndpoint`.
   */
  materialId?: string;
  /**
   * Tutor Session path (or any future host) — explicit endpoint base
   * for GET (returns `{ notes: {...} }`) and PUT (accepts
   * `{ contentJson, contentText }`). When set, takes precedence over
   * `materialId`.
   */
  notesEndpoint?: string;
  /** Document title (current module / lesson / session). */
  lessonTitle: string;
  /** Course / session-scope title shown under the document title. */
  courseTitle: string;
  suggestions: NoteSuggestion[];
  /** Called when the student adds a suggestion (used to dismiss it). */
  onConsumeSuggestion: (id: string) => void;
  autoGenerate: boolean;
  onAutoGenerateChange: (next: boolean) => void;
  className?: string;
  /** Optional imperative handle so the parent can append notes. */
  editorRef?: React.RefObject<NotesPanelHandle | null>;
}) {
  const endpoint = notesEndpoint ?? `/api/mentored/notes/${materialId}`;
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const initialDocRef = useRef<unknown | null>(null);

  const docEmoji = useMemo(
    () => pickDocEmoji(`${lessonTitle} ${courseTitle}`),
    [lessonTitle, courseTitle]
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // CodeBlock + Blockquote + HorizontalRule come from StarterKit.
        // We re-style them via the global CSS at the bottom.
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Typography,
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
      Callout,
      SlashCommand,
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          return "Type '/' for commands, or just start writing…";
        },
        includeChildren: false,
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "tn-prose max-w-none focus:outline-none min-h-[18rem] caret-zinc-700",
      },
      handleKeyDown: (view, event) => {
        // Cmd+K for link insertion — match Notion's default.
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          const url = window.prompt("Paste link URL");
          if (!url) return true;
          const { state, dispatch } = view;
          const { from, to } = state.selection;
          const text = state.doc.textBetween(from, to, "");
          if (text.length === 0) {
            const linkNode = state.schema.text(url, [
              state.schema.marks.link.create({ href: url }),
            ]);
            dispatch(state.tr.replaceSelectionWith(linkNode, false));
          } else {
            dispatch(
              state.tr.addMark(
                from,
                to,
                state.schema.marks.link.create({ href: url })
              )
            );
          }
          return true;
        }
        return false;
      },
    },
    content: undefined,
  });

  // Imperative handle for the parent — auto-generate uses this to
  // append structured "Rose just covered X" blocks directly into the
  // doc. Layout is now Notion-style: H2 heading, optional intro,
  // bullets with optional bold key terms + nested children, optional
  // callout.
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = {
      appendBlock: ({ heading, intro, bullets, callout }) => {
        if (!editor) return;
        const chain = editor.chain().focus("end");

        chain.insertContent({
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: heading }],
        });

        if (intro && intro.trim().length > 0) {
          chain.insertContent({
            type: "paragraph",
            content: [{ type: "text", text: intro.trim() }],
          });
        }

        if (bullets.length > 0) {
          chain.insertContent({
            type: "bulletList",
            content: bullets.map((b) => {
              const text = typeof b === "string" ? b : b.text;
              const bold = typeof b === "string" ? undefined : b.bold;
              const children =
                typeof b === "string" ? undefined : b.children ?? undefined;

              type RichText = {
                type: "text";
                text: string;
                marks?: { type: string }[];
              };
              const inlineContent: RichText[] = [];
              if (bold && text.toLowerCase().startsWith(bold.toLowerCase())) {
                inlineContent.push({
                  type: "text",
                  text: text.slice(0, bold.length),
                  marks: [{ type: "bold" }],
                });
                inlineContent.push({
                  type: "text",
                  text: text.slice(bold.length),
                });
              } else {
                inlineContent.push({ type: "text", text });
              }

              const itemContent: Array<Record<string, unknown>> = [
                { type: "paragraph", content: inlineContent },
              ];
              if (children && children.length > 0) {
                itemContent.push({
                  type: "bulletList",
                  content: children.map((c) => ({
                    type: "listItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: c }],
                      },
                    ],
                  })),
                });
              }
              return { type: "listItem", content: itemContent };
            }),
          });
        }

        if (callout && callout.text.trim().length > 0) {
          chain.insertContent({
            type: "callout",
            attrs: { emoji: callout.emoji ?? "💡" },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: callout.text.trim() }],
              },
            ],
          });
        }

        chain.run();
      },
    };
    return () => {
      if (editorRef.current) editorRef.current = null;
    };
  }, [editor, editorRef]);

  // Initial load — hydrate the editor with the saved doc once.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(endpoint);
        if (!res.ok) return;
        const body = (await res.json()) as {
          notes?: {
            contentJson: unknown;
            autoGenerate: boolean;
            updatedAt?: string;
          };
        };
        if (cancelled) return;
        const doc = body.notes?.contentJson;
        if (doc && editor && !editor.isDestroyed) {
          initialDocRef.current = doc;
          editor.commands.setContent(doc as never, { emitUpdate: false });
        }
        if (typeof body.notes?.autoGenerate === "boolean") {
          onAutoGenerateChange(body.notes.autoGenerate);
        }
        if (body.notes?.updatedAt) {
          const t = Date.parse(body.notes.updatedAt);
          if (!Number.isNaN(t)) setLastSavedAt(t);
        }
      } catch (e) {
        console.error("[NotesPanel load]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, endpoint]);

  const saveNow = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON();
    const text = docToPlainText(json);
    setSaving("saving");
    const attempt = async (): Promise<boolean> => {
      try {
        const res = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentJson: json, contentText: text }),
        });
        return res.ok;
      } catch {
        return false;
      }
    };
    let ok = await attempt();
    if (!ok) {
      await new Promise((r) => setTimeout(r, 1200));
      ok = await attempt();
    }
    if (ok) {
      const now = Date.now();
      setLastSavedAt(now);
      setSaving("saved");
      window.setTimeout(() => {
        setSaving((s) => (s === "saved" ? "idle" : s));
      }, 1800);
    } else {
      setSaving("error");
    }
  }, [editor, endpoint]);

  // Autosave: debounce 1500ms after the last update event.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        void saveNow();
      }, 1500);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [editor, saveNow]);

  // Auto-generate toggle: persist immediately via a payload-only PUT.
  const onToggleAutoGenerate = useCallback(
    async (next: boolean) => {
      onAutoGenerateChange(next);
      if (!editor) return;
      const json = editor.getJSON();
      const text = docToPlainText(json);
      try {
        await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentJson: json,
            contentText: text,
            autoGenerate: next,
          }),
        });
      } catch (e) {
        console.error("[NotesPanel autoGenerate toggle]", e);
      }
    },
    [editor, endpoint, onAutoGenerateChange]
  );

  const insertSuggestion = useCallback(
    (s: NoteSuggestion) => {
      if (!editor) return;
      // Insert + briefly flash with a highlight mark so the student
      // sees what just got added. We measure the doc size before /
      // after and mark the new range as `highlight`, then schedule a
      // removal a few seconds later. Keeps the document permanently
      // un-highlighted while still giving the visual cue.
      const before = editor.state.doc.content.size;
      editor
        .chain()
        .focus("end")
        .insertContent({
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [
                    s.heading
                      ? {
                          type: "text",
                          marks: [{ type: "bold" }],
                          text: `${s.heading}: `,
                        }
                      : null,
                    { type: "text", text: s.text },
                  ].filter(Boolean) as { type: "text"; text: string }[],
                },
              ],
            },
          ],
        })
        .run();
      const after = editor.state.doc.content.size;
      if (after > before) {
        editor.chain().setTextSelection({ from: before, to: after }).run();
        editor.chain().setHighlight().run();
        const fromMark = before;
        const toMark = after;
        window.setTimeout(() => {
          if (editor.isDestroyed) return;
          editor
            .chain()
            .setTextSelection({ from: fromMark, to: toMark })
            .unsetHighlight()
            .setTextSelection(toMark)
            .focus()
            .run();
        }, 1400);
      }
      onConsumeSuggestion(s.id);
    },
    [editor, onConsumeSuggestion]
  );

  const savedLabel = useMemo(() => {
    if (saving === "saving") return "Saving…";
    if (saving === "error") return "Save failed — retrying";
    if (saving === "saved") return "Saved";
    if (lastSavedAt) return `Edited ${formatRelativeTime(lastSavedAt)}`;
    return "Not saved yet";
  }, [saving, lastSavedAt]);

  return (
    <aside
      className={`tn-panel relative flex flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 shadow-[0_20px_50px_-25px_rgba(60,60,90,0.18)] backdrop-blur-md ${className ?? ""}`}
    >
      {/* Compact status bar — out of the way but always visible.
          Extra horizontal padding at xl so on the 50/50 desktop
          layout the "Edited just now" stamp and the Auto-generate
          toggle don't sit pinned against the panel edges. */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-2.5 xl:px-7">
        <span
          className={`flex items-center gap-1.5 text-[11px] font-medium transition-opacity ${
            saving === "error"
              ? "text-rose-600"
              : saving === "saving"
                ? "text-zinc-400"
                : "text-zinc-500"
          }`}
          aria-live="polite"
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${
              saving === "error"
                ? "bg-rose-500"
                : saving === "saving"
                  ? "bg-zinc-300 animate-pulse"
                  : saving === "saved"
                    ? "bg-emerald-500"
                    : "bg-zinc-300"
            }`}
          />
          {savedLabel}
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-700">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-700"
            checked={autoGenerate}
            onChange={(e) => void onToggleAutoGenerate(e.target.checked)}
          />
          ✨ Auto-generate
        </label>
      </div>

      {/* Document body — generous padding, max-width centered. */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px] px-6 py-10 sm:px-10 lg:px-14 lg:py-14">
          {/* Document chrome — emoji + course metadata.
              The lesson title used to live here as a permanent H1
              that the user couldn't delete. Now it's gone — users
              own the document from line 1. The first node of the
              editor body acts as the title (TipTap's Placeholder
              extension prompts "Write your notes…" while empty),
              so a user-typed first H1 becomes the de-facto title
              and can be edited / deleted like any other block. */}
          <header className="mb-6">
            <span
              className="mb-2 block text-3xl leading-none select-none"
              aria-hidden
            >
              {docEmoji}
            </span>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
              {courseTitle || lessonTitle || "Notes"}
            </p>
            <p className="mt-0.5 text-[12px] text-zinc-400">
              {lastSavedAt
                ? `Edited ${formatRelativeTime(lastSavedAt)}`
                : "Not saved yet"}
            </p>
            <div className="mt-5 h-px w-full bg-zinc-100" />
          </header>

          {/* Editor */}
          {editor ? (
            <BubbleMenu
              editor={editor}
              className="tn-bubble flex items-center gap-0.5 rounded-xl bg-zinc-900/95 px-1 py-1 shadow-2xl ring-1 ring-black/20 backdrop-blur"
            >
              <BubbleBtn
                aria-label="Bold"
                title="Bold (⌘B)"
                active={editor.isActive("bold")}
                onClick={() => editor.chain().focus().toggleBold().run()}
              >
                <span className="font-bold">B</span>
              </BubbleBtn>
              <BubbleBtn
                aria-label="Italic"
                title="Italic (⌘I)"
                active={editor.isActive("italic")}
                onClick={() => editor.chain().focus().toggleItalic().run()}
              >
                <span className="italic">I</span>
              </BubbleBtn>
              <BubbleBtn
                aria-label="Underline"
                title="Underline (⌘U)"
                active={editor.isActive("underline")}
                onClick={() => editor.chain().focus().toggleUnderline().run()}
              >
                <span className="underline">U</span>
              </BubbleBtn>
              <BubbleBtn
                aria-label="Strikethrough"
                title="Strikethrough"
                active={editor.isActive("strike")}
                onClick={() => editor.chain().focus().toggleStrike().run()}
              >
                <span className="line-through">S</span>
              </BubbleBtn>
              <span aria-hidden className="mx-1 h-4 w-px bg-white/15" />
              <BubbleBtn
                aria-label="Inline code"
                title="Inline code"
                active={editor.isActive("code")}
                onClick={() => editor.chain().focus().toggleCode().run()}
              >
                <span className="font-mono text-[11px]">{"</>"}</span>
              </BubbleBtn>
              <BubbleBtn
                aria-label="Highlight"
                title="Highlight"
                active={editor.isActive("highlight")}
                onClick={() => editor.chain().focus().toggleHighlight().run()}
              >
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ background: "#fde68a" }}
                />
              </BubbleBtn>
              <BubbleBtn
                aria-label="Link"
                title="Link (⌘K)"
                active={editor.isActive("link")}
                onClick={() => {
                  const prev = editor.getAttributes("link").href as
                    | string
                    | undefined;
                  const url = window.prompt("Link URL", prev ?? "");
                  if (url === null) return;
                  if (url === "") {
                    editor.chain().focus().unsetLink().run();
                  } else {
                    editor
                      .chain()
                      .focus()
                      .extendMarkRange("link")
                      .setLink({ href: url })
                      .run();
                  }
                }}
              >
                <span>🔗</span>
              </BubbleBtn>
            </BubbleMenu>
          ) : null}
          <EditorContent editor={editor} />

          {/* Tiny hint pinned below empty docs to teach the slash menu */}
          {editor && editor.isEmpty ? (
            <p className="mt-4 select-none text-[12px] text-zinc-400">
              Press{" "}
              <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                /
              </kbd>{" "}
              for commands, or toggle{" "}
              <span className="text-zinc-500">✨ Auto-generate</span> to let Rose
              fill these in.
            </p>
          ) : null}
        </div>
      </div>

      {/* AI Suggestions — pinned to bottom. Spans the full panel
          width (no max-w cap) so on the 50/50 desktop layout the
          suggestion card has room to breathe and stays readable.
          The document body above keeps the Notion 720px reading
          column; only this section goes full-bleed. */}
      {suggestions.length > 0 ? (
        <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-3 xl:px-7">
          <div className="w-full">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
              <span>✨</span> Rose suggests
            </p>
            <ul className="flex flex-col gap-1.5">
              {suggestions.slice(0, 3).map((s) => (
                <li
                  key={s.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-zinc-200/70 bg-white px-3 py-2 text-[13px] text-zinc-700"
                >
                  <span className="flex-1 leading-snug">
                    {s.heading ? (
                      <span className="font-semibold text-zinc-900">
                        {s.heading}:{" "}
                      </span>
                    ) : null}
                    {s.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => insertSuggestion(s)}
                    className="shrink-0 rounded-full bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-white transition hover:bg-zinc-700"
                  >
                    + Add
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <style jsx global>{`
        /* ===========================================================
           tn-prose — Notion-style document typography
           =========================================================== */
        .tn-prose {
          font-family:
            "Inter",
            "SF Pro Text",
            ui-sans-serif,
            system-ui,
            -apple-system,
            sans-serif;
          font-size: 16px;
          line-height: 1.65;
          color: #37352f;
          font-feature-settings: "ss01", "cv11";
        }
        .tn-prose > * + * {
          margin-top: 1.05rem;
        }
        .tn-prose h1,
        .tn-prose h2,
        .tn-prose h3 {
          letter-spacing: -0.01em;
          color: #1a1a1c;
          line-height: 1.25;
        }
        .tn-prose h1 {
          font-size: 30px;
          font-weight: 700;
          margin-top: 2.25rem;
          margin-bottom: 0.5rem;
        }
        .tn-prose h2 {
          font-size: 24px;
          font-weight: 700;
          margin-top: 2rem;
          margin-bottom: 0.4rem;
        }
        .tn-prose h3 {
          font-size: 19px;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.3rem;
        }
        .tn-prose p {
          margin: 0;
          color: #37352f;
        }
        .tn-prose strong {
          font-weight: 700;
          color: #1a1a1c;
        }
        .tn-prose em {
          font-style: italic;
        }
        .tn-prose s {
          text-decoration-color: rgba(55, 53, 47, 0.5);
        }
        .tn-prose a.tn-link,
        .tn-prose a {
          color: #2563eb;
          text-decoration: underline;
          text-decoration-color: rgba(37, 99, 235, 0.35);
          text-underline-offset: 2px;
        }
        .tn-prose a:hover {
          text-decoration-color: #2563eb;
        }

        /* Lists */
        .tn-prose ul,
        .tn-prose ol {
          padding-left: 1.4rem;
          margin: 0.35rem 0;
        }
        .tn-prose ul {
          list-style: disc;
        }
        .tn-prose ul ul {
          list-style: circle;
        }
        .tn-prose ul ul ul {
          list-style: square;
        }
        .tn-prose ol {
          list-style: decimal;
        }
        .tn-prose li {
          margin: 0.15rem 0;
        }
        .tn-prose li > p {
          margin: 0;
        }
        .tn-prose li > ul,
        .tn-prose li > ol {
          margin-top: 0.15rem;
        }

        /* Task list (checkboxes) */
        .tn-prose ul[data-type="taskList"] {
          list-style: none;
          padding-left: 0.2rem;
        }
        .tn-prose ul[data-type="taskList"] li {
          display: flex;
          align-items: flex-start;
          gap: 0.55rem;
        }
        .tn-prose ul[data-type="taskList"] li > label {
          display: inline-flex;
          align-items: center;
          margin-top: 0.35rem;
        }
        .tn-prose ul[data-type="taskList"] li > label > input[type="checkbox"] {
          width: 16px;
          height: 16px;
          accent-color: #4f46e5;
          border-radius: 4px;
        }
        .tn-prose ul[data-type="taskList"] li > div {
          flex: 1;
          min-width: 0;
        }
        .tn-prose
          ul[data-type="taskList"]
          li[data-checked="true"]
          > div
          p {
          color: #9ca3af;
          text-decoration: line-through;
        }

        /* Inline code */
        .tn-prose code {
          background: rgba(135, 131, 120, 0.15);
          color: #b91c1c;
          padding: 0.1rem 0.35rem;
          border-radius: 0.3rem;
          font-size: 0.88em;
          font-family:
            "JetBrains Mono",
            "SF Mono",
            ui-monospace,
            Menlo,
            Consolas,
            monospace;
        }
        /* Code block */
        .tn-prose pre {
          background: #f7f6f3;
          color: #1f2937;
          padding: 1rem 1.1rem;
          border-radius: 0.75rem;
          font-size: 0.86em;
          line-height: 1.6;
          overflow-x: auto;
          border: 1px solid #ececec;
        }
        .tn-prose pre code {
          background: transparent;
          color: inherit;
          padding: 0;
          font-size: inherit;
          border-radius: 0;
        }

        /* Blockquote */
        .tn-prose blockquote {
          margin: 0.6rem 0;
          padding: 0.4rem 0 0.4rem 1rem;
          border-left: 3px solid #37352f;
          color: #37352f;
          font-style: normal;
        }

        /* Horizontal rule */
        .tn-prose hr {
          border: none;
          margin: 1.6rem 0;
          height: 1px;
          background: #e6e5e1;
        }

        /* Highlight */
        .tn-prose mark {
          background: rgba(253, 224, 71, 0.5);
          padding: 0.05rem 0.2rem;
          border-radius: 0.25rem;
          color: inherit;
        }

        /* Callout */
        .tn-prose .tn-callout {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          background: #f7f6f3;
          border: 1px solid #ececec;
          border-radius: 0.7rem;
          padding: 0.85rem 1rem;
          margin: 0.9rem 0;
        }
        .tn-prose .tn-callout-emoji {
          font-size: 1.15rem;
          line-height: 1.6;
          flex-shrink: 0;
          user-select: none;
        }
        .tn-prose .tn-callout-body {
          flex: 1;
          min-width: 0;
        }
        .tn-prose .tn-callout-body > p {
          margin: 0;
        }

        /* Placeholder for empty doc + empty headings */
        .tn-prose p.is-editor-empty:first-child::before,
        .tn-prose h1.is-empty::before,
        .tn-prose h2.is-empty::before,
        .tn-prose h3.is-empty::before {
          content: attr(data-placeholder);
          color: #c0c0c0;
          float: left;
          height: 0;
          pointer-events: none;
        }

        /* Selection */
        .tn-prose ::selection {
          background: rgba(35, 131, 226, 0.18);
        }

        /* Bubble menu dark theme — icons */
        .tn-bubble button {
          color: #e5e7eb;
        }
        .tn-bubble button[data-active="true"] {
          background: rgba(255, 255, 255, 0.12);
          color: white;
        }
      `}</style>
    </aside>
  );
}

function BubbleBtn({
  children,
  onClick,
  active,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  "aria-label": string;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      {...rest}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md text-[12px] font-medium transition ${
        active
          ? "bg-white/15 text-white"
          : "text-zinc-200 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
