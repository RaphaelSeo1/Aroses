"use client";

import type { Editor } from "@tiptap/react";

function ToolBtn({
  label,
  title,
  active,
  disabled,
  onClick,
}: {
  label: string;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-[12px] font-semibold transition disabled:opacity-40 ${
        active
          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
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
  return (
    <div className="sticky top-0 z-20 -mx-1 mb-3 flex flex-wrap items-center gap-0.5 rounded-xl border border-zinc-200/90 bg-white/95 px-1.5 py-1 shadow-sm backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/95">
      <ToolBtn
        label="H1"
        title="Heading 1"
        active={editor.isActive("heading", { level: 1 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 1 }).run()
        }
      />
      <ToolBtn
        label="H2"
        title="Heading 2"
        active={editor.isActive("heading", { level: 2 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        }
      />
      <ToolBtn
        label="H3"
        title="Heading 3"
        active={editor.isActive("heading", { level: 3 })}
        onClick={() =>
          editor.chain().focus().toggleHeading({ level: 3 }).run()
        }
      />
      <Divider />
      <ToolBtn
        label="B"
        title="Bold"
        active={editor.isActive("bold")}
        onClick={() => editor.chain().focus().toggleBold().run()}
      />
      <ToolBtn
        label="I"
        title="Italic"
        active={editor.isActive("italic")}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      />
      <ToolBtn
        label="U"
        title="Underline"
        active={editor.isActive("underline")}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      />
      <ToolBtn
        label="S"
        title="Strikethrough"
        active={editor.isActive("strike")}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      />
      <Divider />
      <ToolBtn
        label="•"
        title="Bulleted list"
        active={editor.isActive("bulletList")}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolBtn
        label="1."
        title="Numbered list"
        active={editor.isActive("orderedList")}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolBtn
        label="☐"
        title="To-do list"
        active={editor.isActive("taskList")}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />
      <Divider />
      <ToolBtn
        label="⟸"
        title="Align left"
        active={editor.isActive({ textAlign: "left" })}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      />
      <ToolBtn
        label="⇔"
        title="Align center"
        active={editor.isActive({ textAlign: "center" })}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      />
      <ToolBtn
        label="⟹"
        title="Align right"
        active={editor.isActive({ textAlign: "right" })}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      />
      <Divider />
      <ToolBtn
        label="⧉"
        title="Insert table"
        onClick={() =>
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run()
        }
      />
      <ToolBtn
        label={uploadingImage ? "…" : "🖼"}
        title="Insert image or screenshot"
        disabled={uploadingImage}
        onClick={onPickImage}
      />
      {editor.isActive("table") ? (
        <>
          <Divider />
          <ToolBtn
            label="+R"
            title="Add row"
            onClick={() => editor.chain().focus().addRowAfter().run()}
          />
          <ToolBtn
            label="+C"
            title="Add column"
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          />
          <ToolBtn
            label="⌫T"
            title="Delete table"
            onClick={() => editor.chain().focus().deleteTable().run()}
          />
        </>
      ) : null}
    </div>
  );
}
