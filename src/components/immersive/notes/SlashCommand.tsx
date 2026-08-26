"use client";

import { Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import tippy, { Instance } from "tippy.js";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import type { Editor, Range } from "@tiptap/core";

/**
 * Notion-style slash command extension.
 *
 * Typing `/` opens a popover of block insertion options. Filter narrows as
 * the user types — Enter / click inserts the selected block.
 */

type Command = {
  title: string;
  description: string;
  icon: string;
  keywords: string[];
  run: (props: { editor: Editor; range: Range }) => void;
};

type SlashOptions = {
  onPickImage?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  suggestion?: Record<string, any>;
};

function buildCommands(options: SlashOptions): Command[] {
  return [
    {
      title: "Heading 1",
      description: "Big section title",
      icon: "H1",
      keywords: ["h1", "title", "heading"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 1 })
          .run(),
    },
    {
      title: "Heading 2",
      description: "Medium section heading",
      icon: "H2",
      keywords: ["h2", "subheading", "section"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 2 })
          .run(),
    },
    {
      title: "Heading 3",
      description: "Small subsection heading",
      icon: "H3",
      keywords: ["h3", "subsection"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setNode("heading", { level: 3 })
          .run(),
    },
    {
      title: "Bulleted list",
      description: "Simple bulleted list",
      icon: "•",
      keywords: ["bullet", "list", "ul"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: "Numbered list",
      description: "1. 2. 3. ordered list",
      icon: "1.",
      keywords: ["number", "ordered", "ol"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: "To-do list",
      description: "Tick-box checklist",
      icon: "☐",
      keywords: ["todo", "task", "checkbox"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleTaskList().run(),
    },
    {
      title: "Image",
      description: "Upload a photo or paste a screenshot",
      icon: "🖼",
      keywords: ["image", "photo", "picture", "screenshot", "png", "jpg"],
      run: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        options.onPickImage?.();
      },
    },
    {
      title: "Table",
      description: "Insert a table — add more rows and columns from the toolbar",
      icon: "▦",
      keywords: ["table", "grid", "spreadsheet"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: "Callout",
      description: "Highlighted box with an emoji",
      icon: "💡",
      keywords: ["callout", "note", "warning", "info"],
      run: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertContent({
            type: "callout",
            attrs: { emoji: "💡" },
            content: [{ type: "paragraph" }],
          })
          .run(),
    },
    {
      title: "Quote",
      description: "Block quote",
      icon: "❝",
      keywords: ["quote", "blockquote"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: "Code block",
      description: "Monospace code block",
      icon: "</>",
      keywords: ["code", "pre"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
    {
      title: "Divider",
      description: "Horizontal rule",
      icon: "—",
      keywords: ["hr", "divider", "rule", "line"],
      run: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
    },
  ];
}

type SlashMenuProps = {
  items: Command[];
  command: (item: Command) => void;
};

type SlashMenuHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const SlashMenu = forwardRef<SlashMenuHandle, SlashMenuProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event) => {
        if (event.key === "ArrowUp") {
          setSelectedIndex((i) => (i + items.length - 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "ArrowDown") {
          setSelectedIndex((i) => (i + 1) % Math.max(items.length, 1));
          return true;
        }
        if (event.key === "Enter") {
          const item = items[selectedIndex];
          if (item) command(item);
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 shadow-xl">
          No matches
        </div>
      );
    }

    return (
      <div className="max-h-80 w-72 overflow-y-auto rounded-xl border border-zinc-200/80 bg-white p-1.5 shadow-2xl ring-1 ring-black/5">
        {items.map((item, i) => (
          <button
            key={item.title}
            type="button"
            onMouseEnter={() => setSelectedIndex(i)}
            onClick={() => command(item)}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition ${
              i === selectedIndex
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-700 hover:bg-zinc-50"
            }`}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-[13px] font-medium text-zinc-700">
              {item.icon}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-tight">
                {item.title}
              </span>
              <span className="block truncate text-[11px] text-zinc-500">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>
    );
  }
);
SlashMenu.displayName = "SlashMenu";

export const SlashCommand = Extension.create<SlashOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onPickImage: undefined,
      suggestion: {
        char: "/",
        startOfLine: false,
        allowSpaces: false,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: Command;
        }) => {
          props.run({ editor, range });
        },
      },
    };
  },

  addProseMirrorPlugins() {
    const commands = buildCommands({
      onPickImage: this.options.onPickImage,
    });
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase().trim();
          if (!q) return commands;
          return commands.filter(
            (cmd) =>
              cmd.title.toLowerCase().includes(q) ||
              cmd.keywords.some((k) => k.includes(q))
          );
        },
        render: () => {
          let component: ReactRenderer<SlashMenuHandle, SlashMenuProps> | null =
            null;
          let popup: Instance | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(SlashMenu, {
                props: {
                  items: props.items as Command[],
                  command: (item: Command) => props.command(item),
                },
                editor: props.editor,
              });
              if (!props.clientRect) return;
              const ref = props.clientRect();
              if (!ref) return;
              popup = tippy(document.body, {
                getReferenceClientRect: () => ref,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                arrow: false,
                offset: [0, 6],
                duration: [120, 80],
              });
            },
            onUpdate: (props) => {
              if (!component) return;
              component.updateProps({
                items: props.items as Command[],
                command: (item: Command) => props.command(item),
              });
              if (!popup || !props.clientRect) return;
              const ref = props.clientRect();
              if (!ref) return;
              popup.setProps({ getReferenceClientRect: () => ref });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              return component?.ref?.onKeyDown(props.event) ?? false;
            },
            onExit: () => {
              popup?.destroy();
              popup = null;
              component?.destroy();
              component = null;
            },
          };
        },
      }),
    ];
  },
});

export default SlashCommand;
