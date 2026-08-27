"use client";

import type { ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function ToolBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition disabled:opacity-40 ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px bg-zinc-200 dark:bg-zinc-700" />;
}

/** Persistent Docs-style formatting bar for the notes editor. */
export function NotesFormatToolbar({
  editor,
  uploadingImage,
  onPickImage,
}: {
  editor: Editor;
  uploadingImage?: boolean;
  onPickImage: () => void;
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      h1: ed.isActive("heading", { level: 1 }),
      h2: ed.isActive("heading", { level: 2 }),
      h3: ed.isActive("heading", { level: 3 }),
      bold: ed.isActive("bold"),
      italic: ed.isActive("italic"),
      underline: ed.isActive("underline"),
      strike: ed.isActive("strike"),
      bullet: ed.isActive("bulletList"),
      ordered: ed.isActive("orderedList"),
      task: ed.isActive("taskList"),
      left: ed.isActive({ textAlign: "left" }),
      center: ed.isActive({ textAlign: "center" }),
      right: ed.isActive({ textAlign: "right" }),
    }),
  });

  return (
    <div className="sticky top-0 z-20 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 rounded-xl border border-zinc-200/90 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/95">
      <ToolBtn
        title="Heading 1"
        active={s.h1}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
      >
        <span className="text-[11px] font-bold leading-none tracking-tight">
          H1
        </span>
      </ToolBtn>
      <ToolBtn
        title="Heading 2"
        active={s.h2}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      >
        <span className="text-[10px] font-bold leading-none tracking-tight">
          H2
        </span>
      </ToolBtn>
      <ToolBtn
        title="Heading 3"
        active={s.h3}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
      >
        <span className="text-[9px] font-semibold leading-none tracking-tight">
          H3
        </span>
      </ToolBtn>
      <Divider />
      <ToolBtn
        title="Bold"
        active={s.bold}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <span className="text-[13px] font-bold leading-none">B</span>
      </ToolBtn>
      <ToolBtn
        title="Italic"
        active={s.italic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <span className="text-[13px] font-serif italic leading-none">I</span>
      </ToolBtn>
      <ToolBtn
        title="Underline"
        active={s.underline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <span className="text-[13px] font-semibold leading-none underline">
          U
        </span>
      </ToolBtn>
      <ToolBtn
        title="Strikethrough"
        active={s.strike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <span className="text-[13px] font-semibold leading-none line-through">
          S
        </span>
      </ToolBtn>
      <Divider />
      <ToolBtn
        title="Bulleted list"
        active={s.bullet}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <Icon>
          <circle cx="3" cy="4" r="1" fill="currentColor" stroke="none" />
          <circle cx="3" cy="8" r="1" fill="currentColor" stroke="none" />
          <circle cx="3" cy="12" r="1" fill="currentColor" stroke="none" />
          <path d="M6 4h8M6 8h8M6 12h8" />
        </Icon>
      </ToolBtn>
      <ToolBtn
        title="Numbered list"
        active={s.ordered}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <Icon>
          <path d="M7 4h7.5M7 8h7.5M7 12h7.5" />
          <path d="M2.4 2.8h1.3V6H2.2" strokeWidth={1.35} />
          <path d="M2.2 9h2l-2 3.4h2.1" strokeWidth={1.35} />
        </Icon>
      </ToolBtn>
      <ToolBtn
        title="To-do list"
        active={s.task}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      >
        <Icon>
          <rect x="1.5" y="2.5" width="4" height="4" rx="0.8" />
          <path d="M2.6 4.6l1.1 1.1 1.8-2" />
          <path d="M8 4.5h6.5M8 11.5h6.5" />
          <rect x="1.5" y="9.5" width="4" height="4" rx="0.8" />
        </Icon>
      </ToolBtn>
      <Divider />
      <ToolBtn
        title="Align left"
        active={s.left}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <Icon>
          <path d="M2 3.5h12M2 6.5h8M2 9.5h12M2 12.5h8" />
        </Icon>
      </ToolBtn>
      <ToolBtn
        title="Align center"
        active={s.center}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <Icon>
          <path d="M2 3.5h12M4 6.5h8M2 9.5h12M4 12.5h8" />
        </Icon>
      </ToolBtn>
      <ToolBtn
        title="Align right"
        active={s.right}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <Icon>
          <path d="M2 3.5h12M6 6.5h8M2 9.5h12M6 12.5h8" />
        </Icon>
      </ToolBtn>
      <Divider />
      <ToolBtn
        title="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      >
        <Icon>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.2" />
          <path d="M1.5 6.5h13M1.5 10.5h13M6 2.5v11M10 2.5v11" />
        </Icon>
      </ToolBtn>
      <ToolBtn
        title="Insert image or screenshot"
        disabled={uploadingImage}
        onClick={onPickImage}
      >
        {uploadingImage ? (
          <span className="text-[11px] font-semibold">…</span>
        ) : (
          <Icon>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <circle cx="5.2" cy="6.2" r="1.1" />
            <path d="M1.8 12.2l3.8-3.6 2.4 2.2 2.6-3.2 3.6 4.6" />
          </Icon>
        )}
      </ToolBtn>
    </div>
  );
}
