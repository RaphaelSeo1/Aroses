"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { buildForumExtensions } from "@/components/forum/forum-extensions";
import { ForumProseStyles } from "@/components/forum/ForumProseStyles";
import { FORUM_HIGHLIGHT_COLORS, forumDocToPlainText } from "@/lib/forum/rich-text";
import { promptDialog } from "@/components/AppDialogs";
import { createClient } from "@/lib/supabase/client";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/**
 * Notion-style rich-text editor for forum posts: bold/italic/underline/strike,
 * highlight (palette), inline code, links, bullet/numbered lists, and inline
 * images (uploaded to the public `forum-images` bucket).
 *
 * Reports changes via `onChange(json, plainText)`. The parent owns the value.
 */
export function RichTextEditor({
  placeholder = "Write your post… use the toolbar for formatting and images.",
  onChange,
  className,
}: {
  placeholder?: string;
  onChange: (json: unknown, plainText: string) => void;
  className?: string;
}) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      ...buildForumExtensions(),
      Placeholder.configure({ placeholder }),
    ],
    editorProps: {
      attributes: {
        class: "forum-rich min-h-[10rem] px-3.5 py-2.5",
      },
    },
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON();
      onChangeRef.current(json, forumDocToPlainText(json));
    },
  });

  const insertImage = useCallback(
    async (file: File) => {
      if (!editor) return;
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        setUploadError("Please choose a JPG, PNG, WebP, or GIF image.");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setUploadError("Image is too large (max 10 MB).");
        return;
      }
      setUploadError(null);
      setUploading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          setUploadError("Sign in to add images.");
          return;
        }
        const ext = file.name.split(".").pop()?.toLowerCase() || "png";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("forum-images")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (upErr) {
          setUploadError(upErr.message || "Could not upload image.");
          return;
        }
        const { data: pub } = supabase.storage
          .from("forum-images")
          .getPublicUrl(path);
        editor.chain().focus().setImage({ src: pub.publicUrl }).run();
      } catch (e) {
        setUploadError(e instanceof Error ? e.message : "Could not upload image.");
      } finally {
        setUploading(false);
      }
    },
    [editor]
  );

  return (
    <div className={className}>
      <ForumProseStyles />
      <div className="rounded-xl border border-zinc-200 bg-white focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-900">
        {editor ? (
          <Toolbar
            editor={editor}
            uploading={uploading}
            onPickImage={() => fileInputRef.current?.click()}
          />
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void insertImage(file);
          e.target.value = "";
        }}
      />
      {uploadError ? (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {uploadError}
        </p>
      ) : null}
    </div>
  );
}

function Toolbar({
  editor,
  uploading,
  onPickImage,
}: {
  editor: Editor;
  uploading: boolean;
  onPickImage: () => void;
}) {
  const [, force] = useState(0);
  // Re-render the toolbar on selection / transaction so active states track.
  useEffect(() => {
    const update = () => force((n) => n + 1);
    editor.on("selectionUpdate", update);
    editor.on("transaction", update);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("transaction", update);
    };
  }, [editor]);

  const setLink = useCallback(() => {
    const prev = editor.getAttributes("link").href as string | undefined;
    void promptDialog({
      title: "Insert link",
      label: "Link URL",
      placeholder: "https://example.com",
      body: "Leave blank to remove the link.",
      defaultValue: prev ?? "",
    }).then((url) => {
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
    });
  }, [editor]);

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-zinc-200 px-1.5 py-1.5 dark:border-zinc-700">
      <Btn label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
        <span className="font-bold">B</span>
      </Btn>
      <Btn label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <span className="italic">I</span>
      </Btn>
      <Btn label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <span className="underline">U</span>
      </Btn>
      <Btn label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <span className="line-through">S</span>
      </Btn>
      <Btn label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
        <span className="font-mono text-[11px]">{"</>"}</span>
      </Btn>

      <Divider />

      {FORUM_HIGHLIGHT_COLORS.map((c) => (
        <Btn
          key={c.value}
          label={`Highlight ${c.label.toLowerCase()}`}
          active={editor.isActive("highlight", { color: c.value })}
          onClick={() => editor.chain().focus().setHighlight({ color: c.value }).run()}
        >
          <span
            className="inline-block h-3.5 w-3.5 rounded-sm ring-1 ring-black/15"
            style={{ background: c.value }}
          />
        </Btn>
      ))}
      <Btn label="Remove highlight" onClick={() => editor.chain().focus().unsetHighlight().run()}>
        <span className="text-[12px] leading-none">⌫</span>
      </Btn>

      <Divider />

      <Btn label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <span className="text-[14px] leading-none">•</span>
      </Btn>
      <Btn label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <span className="text-[11px] font-semibold">1.</span>
      </Btn>
      <Btn label="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <span className="text-[14px] leading-none">&ldquo;</span>
      </Btn>

      <Divider />

      <Btn label="Link" active={editor.isActive("link")} onClick={setLink}>
        <span>🔗</span>
      </Btn>
      <Btn label="Add image" onClick={onPickImage} disabled={uploading}>
        {uploading ? (
          <span className="text-[10px] font-semibold">…</span>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
          </svg>
        )}
      </Btn>
    </div>
  );
}

function Btn({
  children,
  onClick,
  active,
  label,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md text-[13px] transition disabled:opacity-50 ${
        active
          ? "bg-brand/10 text-brand dark:bg-brand-soft/15 dark:text-brand-soft"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" />;
}
