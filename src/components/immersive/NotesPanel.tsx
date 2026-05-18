"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";

/**
 * Notes panel docked to the right side of Mentored Learning.
 *
 * Architecture:
 *   - TipTap editor (ProseMirror under the hood) with the
 *     formatting extensions the spec calls out: headings (H1-H3),
 *     bold, italic, underline, bullet/ordered lists, code blocks,
 *     inline highlights, plus placeholders.
 *   - Autosave: debounced 1500ms after the last keystroke. Saves
 *     fire as PUTs to /api/mentored/notes/[materialId].
 *   - AI suggestions feed (driven by the parent runner): a small
 *     bottom panel listing one-tap "+ Add to notes" entries.
 *   - Auto-generate toggle: when on, the parent appends notes
 *     automatically via `appendBlock()` exposed through the
 *     `editorRef`. When off, suggestions show up as cards.
 *
 * Initial load:
 *   - GET the existing doc on mount; pour into the editor.
 *   - If the request fails the editor still works locally so the
 *     student isn't blocked, and we retry the save on next change.
 */

export type NoteSuggestion = {
  id: string;
  text: string;
  /** Optional heading shown above the text in the suggestion card. */
  heading?: string;
};

export type NotesPanelHandle = {
  /** Append a fully-formed block (heading + bullet list) to the doc. */
  appendBlock: (input: { heading: string; bullets: string[] }) => void;
};

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
  suggestions,
  onConsumeSuggestion,
  autoGenerate,
  onAutoGenerateChange,
  className,
  editorRef,
}: {
  materialId: string;
  suggestions: NoteSuggestion[];
  /** Called when the student adds a suggestion (used to dismiss it). */
  onConsumeSuggestion: (id: string) => void;
  autoGenerate: boolean;
  onAutoGenerateChange: (next: boolean) => void;
  className?: string;
  /** Optional imperative handle so the parent can append notes. */
  editorRef?: React.RefObject<NotesPanelHandle | null>;
}) {
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const lastSavedAtRef = useRef<number>(0);
  const saveTimerRef = useRef<number | null>(null);
  const initialDocRef = useRef<unknown | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      Highlight.configure({ multicolor: false }),
      Placeholder.configure({
        placeholder:
          "Take notes as Rose teaches — formatting works inline (Cmd/Ctrl-B, -I, -U) and slash commands.",
      }),
    ],
    editorProps: {
      attributes: {
        class:
          "tiptap-notes prose prose-sm max-w-none focus:outline-none text-zinc-800 min-h-[18rem]",
      },
    },
    content: undefined,
  });

  // Imperative handle for the parent — auto-generate uses this to
  // append "Rose just covered X" blocks directly into the doc.
  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = {
      appendBlock: ({ heading, bullets }) => {
        if (!editor) return;
        const chain = editor.chain().focus("end");
        chain
          .insertContent({
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: heading }],
          })
          .insertContent({
            type: "bulletList",
            content: bullets.map((b) => ({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: b }],
                },
              ],
            })),
          })
          .run();
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
        const res = await fetch(`/api/mentored/notes/${materialId}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          notes?: {
            contentJson: unknown;
            autoGenerate: boolean;
          };
        };
        if (cancelled) return;
        const doc = body.notes?.contentJson;
        if (doc && editor && !editor.isDestroyed) {
          initialDocRef.current = doc;
          // Use a tiny delay so TipTap has fully mounted before we
          // set content — avoids the first paint flashing the
          // placeholder.
          editor.commands.setContent(doc as never, { emitUpdate: false });
        }
        if (typeof body.notes?.autoGenerate === "boolean") {
          onAutoGenerateChange(body.notes.autoGenerate);
        }
      } catch (e) {
        console.error("[NotesPanel load]", e);
      }
    })();
    return () => {
      cancelled = true;
    };
    // We intentionally don't depend on `onAutoGenerateChange`
    // identity — re-running this on every parent re-render would
    // wipe local edits with the server doc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, materialId]);

  const saveNow = useCallback(async () => {
    if (!editor || editor.isDestroyed) return;
    const json = editor.getJSON();
    const text = docToPlainText(json);
    setSaving("saving");
    // Single retry with backoff — autosave should never spam errors.
    const attempt = async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/mentored/notes/${materialId}`, {
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
      lastSavedAtRef.current = Date.now();
      setSaving("saved");
      // After 2s the "saved" pill fades back to idle.
      window.setTimeout(() => {
        setSaving((s) => (s === "saved" ? "idle" : s));
      }, 2000);
    } else {
      setSaving("error");
    }
  }, [editor, materialId]);

  // Autosave: debounce 1500ms after the last update event. Declared
  // AFTER `saveNow` so the closure binding is to the latest version.
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
        await fetch(`/api/mentored/notes/${materialId}`, {
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
    [editor, materialId, onAutoGenerateChange]
  );

  const insertSuggestion = useCallback(
    (s: NoteSuggestion) => {
      if (!editor) return;
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
                      ? { type: "text", marks: [{ type: "bold" }], text: `${s.heading}: ` }
                      : null,
                    { type: "text", text: s.text },
                  ].filter(Boolean) as { type: "text"; text: string }[],
                },
              ],
            },
          ],
        })
        .run();
      onConsumeSuggestion(s.id);
    },
    [editor, onConsumeSuggestion]
  );

  const savingPill = useMemo(() => {
    if (saving === "saving") return "Saving…";
    if (saving === "saved") return "Saved";
    if (saving === "error") return "Save failed — retrying";
    return null;
  }, [saving]);

  return (
    <aside
      className={`notes-panel flex flex-col rounded-3xl border border-white/50 bg-white/60 shadow-[0_20px_50px_-25px_rgba(60,60,90,0.2)] ring-1 ring-white/40 backdrop-blur-md ${className ?? ""}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-800">Your notes</h2>
          {savingPill ? (
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                saving === "error"
                  ? "bg-rose-100 text-rose-700"
                  : saving === "saving"
                    ? "bg-zinc-100 text-zinc-600"
                    : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {savingPill}
            </span>
          ) : null}
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-medium text-zinc-600">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 rounded border-zinc-300 accent-fuchsia-500"
            checked={autoGenerate}
            onChange={(e) => void onToggleAutoGenerate(e.target.checked)}
          />
          Auto-generate
        </label>
      </div>

      {/* Toolbar */}
      {editor ? (
        <div className="flex flex-wrap items-center gap-1 border-b border-white/40 px-3 py-2">
          <ToolbarBtn
            label="H1"
            active={editor.isActive("heading", { level: 1 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
          />
          <ToolbarBtn
            label="H2"
            active={editor.isActive("heading", { level: 2 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
          />
          <ToolbarBtn
            label="H3"
            active={editor.isActive("heading", { level: 3 })}
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
          />
          <span className="mx-1 h-4 w-px bg-zinc-200" />
          <ToolbarBtn
            label="B"
            bold
            active={editor.isActive("bold")}
            onClick={() => editor.chain().focus().toggleBold().run()}
          />
          <ToolbarBtn
            label="I"
            italic
            active={editor.isActive("italic")}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          />
          <ToolbarBtn
            label="U"
            underline
            active={editor.isActive("underline")}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
          />
          <ToolbarBtn
            label="HL"
            active={editor.isActive("highlight")}
            onClick={() => editor.chain().focus().toggleHighlight().run()}
          />
          <span className="mx-1 h-4 w-px bg-zinc-200" />
          <ToolbarBtn
            label="• List"
            active={editor.isActive("bulletList")}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
          />
          <ToolbarBtn
            label="1. List"
            active={editor.isActive("orderedList")}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
          />
          <ToolbarBtn
            label="</>"
            active={editor.isActive("codeBlock")}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
          />
        </div>
      ) : null}

      {/* Editor */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <EditorContent editor={editor} />
      </div>

      {/* AI Suggestions */}
      {suggestions.length > 0 ? (
        <div className="border-t border-white/40 bg-white/40 px-3 py-2">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Suggested notes
          </p>
          <ul className="flex flex-col gap-1.5">
            {suggestions.slice(0, 3).map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-2 rounded-xl bg-white/70 px-2.5 py-1.5 text-xs text-zinc-700"
              >
                <span className="flex-1 leading-snug">
                  {s.heading ? (
                    <span className="font-semibold text-zinc-800">
                      {s.heading}:{" "}
                    </span>
                  ) : null}
                  {s.text}
                </span>
                <button
                  type="button"
                  onClick={() => insertSuggestion(s)}
                  className="shrink-0 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 transition hover:bg-fuchsia-100"
                >
                  + Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <style jsx global>{`
        .tiptap-notes h1 {
          font-size: 1.15rem;
          font-weight: 700;
          margin: 0.5rem 0 0.25rem;
        }
        .tiptap-notes h2 {
          font-size: 1.05rem;
          font-weight: 600;
          margin: 0.5rem 0 0.25rem;
        }
        .tiptap-notes h3 {
          font-size: 0.95rem;
          font-weight: 600;
          margin: 0.4rem 0 0.2rem;
        }
        .tiptap-notes ul,
        .tiptap-notes ol {
          padding-left: 1.25rem;
          margin: 0.25rem 0;
        }
        .tiptap-notes ul {
          list-style: disc;
        }
        .tiptap-notes ol {
          list-style: decimal;
        }
        .tiptap-notes code {
          background: rgba(244, 244, 245, 0.85);
          padding: 0.05rem 0.3rem;
          border-radius: 0.3rem;
          font-size: 0.85em;
        }
        .tiptap-notes pre {
          background: rgba(244, 244, 245, 0.85);
          padding: 0.6rem 0.8rem;
          border-radius: 0.6rem;
          font-size: 0.82em;
          overflow-x: auto;
        }
        .tiptap-notes mark {
          background: rgba(254, 240, 138, 0.55);
          padding: 0.05rem 0.2rem;
          border-radius: 0.3rem;
        }
        .tiptap-notes p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #a1a1aa;
          float: left;
          height: 0;
          pointer-events: none;
        }
      `}</style>
    </aside>
  );
}

function ToolbarBtn({
  label,
  active,
  bold,
  italic,
  underline,
  onClick,
}: {
  label: string;
  active?: boolean;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-1.5 py-0.5 text-[11px] transition ${
        active
          ? "bg-fuchsia-100 text-fuchsia-800"
          : "text-zinc-600 hover:bg-zinc-100"
      } ${bold ? "font-bold" : ""} ${italic ? "italic" : ""} ${underline ? "underline" : ""}`}
    >
      {label}
    </button>
  );
}
