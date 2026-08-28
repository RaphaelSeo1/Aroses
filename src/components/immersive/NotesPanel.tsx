"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Typography from "@tiptap/extension-typography";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { SlashCommand } from "./notes/SlashCommand";
import { Callout } from "./notes/Callout";
import { NotesFormatToolbar } from "./notes/NotesFormatToolbar";
import { NotesTableHoverControls } from "./notes/NotesTableHoverControls";
import { LectureSummaryButton } from "./notes/LectureSummaryButton";
import { AI_APPEND_META, Provenance, REVISION_DECO_META } from "./notes/Provenance";
import { trailingEmptyParagraphRange } from "@/lib/notes/empty-paragraph";
import { StreamingNotesWriter } from "@/lib/notes/streaming-notes-writer";
import { promptDialog, alertDialog } from "@/components/AppDialogs";
import { EmojiPickerButton } from "@/components/EmojiPickerButton";
import {
  readRoseAppendedChunkIds,
  readRoseDocAttrs,
  RoseDocument,
} from "./notes/RoseDocument";
import { autoGenLog, autoGenLogError } from "@/lib/mentored/auto-generate-log";
import { NOTE_INSTRUCTION_MAX } from "@/lib/ai/note-instruction";
import { useT } from "@/lib/i18n/LocaleProvider";
import {
  parseInlineMarkdown,
  sanitizeIncompleteInlineMarkdown,
  keyTermMarks,
  KEY_TERM_HIGHLIGHT_COLOR,
} from "@/lib/notes/notes-markdown";
import {
  applyKeyTermHighlight,
  clearKeyTermEmphasis,
  KeyTermEmphasis,
  toggleKeyTermEmphasis,
} from "@/lib/notes/key-term-emphasis";
import {
  imageFilesFromDataTransfer,
  NOTE_IMAGE_MIME_TYPES,
  uploadNoteImage,
} from "@/lib/notes/upload-note-image";

/** Highlighter palette offered in the selection bubble menu. */
const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
  { label: "Yellow", value: KEY_TERM_HIGHLIGHT_COLOR },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Purple", value: "#e9d5ff" },
  { label: "Orange", value: "#fed7aa" },
];

/**
 * Premium Notion-style notes panel docked to the right side of
 * Mentored Learning.
 *
 * Surface goals (per spec):
 *   - Feels like opening a Notion page — generous whitespace, clean
 *     typography hierarchy, document title up top.
 *   - Rich formatting: H1/H2/H3, bold/italic/underline/strike,
 *     bullet / numbered / task lists with nesting, code blocks,
 *     blockquotes, dividers, links, highlights, callouts,
 *     images/screenshots (paste, drop, or upload), tables, text align.
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
  /** H2 heading — typically the chunk concept. Omit when `skipHeading`. */
  heading?: string;
  /** When true, only intro/bullets/callout are inserted (no fixed title line). */
  skipHeading?: boolean;
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
  /** Optional vocabulary list (rendered as H3 + bullets with bold terms). */
  vocabulary?: Array<{ term: string; definition?: string }>;
  /** Worked examples, journal entries, or formulas (monospace blocks). */
  examples?: Array<{ label?: string; content: string }>;
  /** Short review questions appended as an ordered list. */
  selfCheck?: string[];
  /** Insert a divider before this block (separates major sections). */
  dividerBefore?: boolean;
  /** When true, skip intro-fingerprint dedupe (explicit user toggle). */
  skipDedupe?: boolean;
  /** Mentored chunk id — persisted on the doc to dedupe across refreshes. */
  chunkId?: string;
  /**
   * Live Notes: append at the doc end WITHOUT stealing focus or moving the
   * student's cursor (they may be typing mid-document while the AI appends).
   * Auto-scrolls only when the reader was already near the bottom.
   */
  preserveSelection?: boolean;
};

export type StreamedNotesOptions = {
  chunkId: string;
  /** Optional H2 — typically the chunk concept. */
  heading?: string;
  dividerBefore?: boolean;
  skipDedupe?: boolean;
};

export type NotesPanelHandle = {
  /** Append a structured block (heading + optional intro + bullets + optional callout). */
  appendBlock: (input: AutoGenerateBlock) => boolean;
  /** Start a streaming AI notes block (tokens type into the editor live). */
  beginStreamedNotes: (input: StreamedNotesOptions) => boolean;
  /** Append streamed text deltas from the notes API. */
  appendStreamedNotesDelta: (delta: string) => void;
  /** Mark streaming complete and persist chunk dedupe metadata. */
  finishStreamedNotes: (chunkId: string) => void;
  /** Cancel an in-progress stream (e.g. chunk changed). */
  abortStreamedNotes: () => void;
  /**
   * The shared token-streaming renderer (Live Notes drives it directly for
   * op-marker streams with self-revision; mentored streaming delegates to
   * it under the legacy method names above).
   */
  getStreamWriter: () => StreamingNotesWriter | null;
  /** Toggle the "Rose is writing notes…" status line. */
  setStreamingIndicator: (on: boolean) => void;
  /** Plain text of the current editor selection, or "" if nothing selected. */
  getSelectedText: () => string;
  /** Section id under the caret / selection, or "" if none. */
  getSelectedSectionId: () => string;
  /** Scroll a live-notes section into view and flash it. */
  revealSection: (sectionId: string) => boolean;
  /** True when the editor has any saved note content. */
  hasContent: () => boolean;
  /** True when this chunk was already auto-appended (in doc metadata or heading). */
  isChunkAppended: (chunkId: string, heading?: string) => boolean;
};

function nodePlainText(
  node: { content?: Array<{ text?: string; content?: unknown[] }> } | undefined
): string {
  if (!node?.content) return "";
  return node.content
    .map((child) => {
      if (typeof child.text === "string") return child.text;
      return nodePlainText(child as { content?: Array<{ text?: string; content?: unknown[] }> });
    })
    .join("");
}

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
  onAutoGenerateUserToggle,
  autoGenerateBackfillOnlyWhenEmpty = false,
  hideAutoGenerate = false,
  className,
  editorRef,
  onEditorReady,
  pinToolbar = true,
  fillHeight = false,
  /** Live Notes: pin-to-bottom scroll follow; user can scroll away freely. */
  scrollFollowMode = false,
  onDocTitleChange,
  initialContentJson,
  initialUpdatedAt = null,
  noteInstruction = "",
  onNoteInstructionChange,
  onNoteInstructionSave,
  lectureRecapEndpoint = null,
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
  /** Fired when the student clicks the toggle (not on initial load sync). */
  onAutoGenerateUserToggle?: (next: boolean) => void;
  /** When true, turning auto-generate on only triggers backfill if notes are empty. */
  autoGenerateBackfillOnlyWhenEmpty?: boolean;
  /** Hide the auto-generate toggle (read/reference surfaces like the Notes hub). */
  hideAutoGenerate?: boolean;
  className?: string;
  /** Optional imperative handle so the parent can append notes. */
  editorRef?: React.RefObject<NotesPanelHandle | null>;
  /** When false, the status bar scrolls with the page instead of sticking. */
  pinToolbar?: boolean;
  /** Fill the parent height and scroll note content inside the panel. */
  fillHeight?: boolean;
  /** Live Notes: only auto-scroll when the reader is pinned to the bottom. */
  scrollFollowMode?: boolean;
  /** When set, doc title is controlled by the parent (live sync with external chrome). */
  onDocTitleChange?: (title: string) => void;
  /** Fired once the TipTap editor is mounted and the imperative handle is wired. */
  onEditorReady?: () => void;
  /** Server-provided TipTap JSON — seeds the editor and skips the blank flash. */
  initialContentJson?: unknown;
  initialUpdatedAt?: string | null;
  /**
   * Per-session "tell the AI how to write these notes" free text.
   * The parent owns the live value (for the next synthesize call). Persist
   * is auto-saved as they type; Save is an immediate persist.
   */
  noteInstruction?: string;
  onNoteInstructionChange?: (v: string) => void;
  /** Persist the current note-style instruction. Required for the Save button. */
  onNoteInstructionSave?: (v: string) => Promise<void>;
  /**
   * Live lecture sessions: POST endpoint to generate/regenerate the tutor-style
   * lecture recap. When set, the Lecture recap control stays visible even before
   * Finish has written one.
   */
  lectureRecapEndpoint?: string | null;
}) {
  const t = useT();
  const endpoint = notesEndpoint ?? `/api/mentored/notes/${materialId}`;
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  // Collapsed by default; expand to edit. Empty stays the default style.
  const [noteStyleOpen, setNoteStyleOpen] = useState(false);
  const [noteStyleDraft, setNoteStyleDraft] = useState(noteInstruction);
  const [noteStyleSaved, setNoteStyleSaved] = useState(noteInstruction);
  const [noteStyleSaveState, setNoteStyleSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const noteStyleDirty = noteStyleDraft !== noteStyleSaved;
  const noteStyleDraftRef = useRef(noteStyleDraft);
  noteStyleDraftRef.current = noteStyleDraft;
  const noteStyleSaveGenRef = useRef(0);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(() => {
    if (!initialUpdatedAt) return null;
    const t = Date.parse(initialUpdatedAt);
    return Number.isNaN(t) ? null : t;
  });
  /** Bumped after setContent so LectureSummaryButton re-reads doc attrs. */
  const [contentRevision, setContentRevision] = useState(0);
  const [lectureRecapSeed, setLectureRecapSeed] = useState<string | null>(() => {
    if (!initialContentJson) return null;
    const raw = readRoseDocAttrs(initialContentJson).roseLectureRecap;
    return typeof raw === "string" && raw.trim() ? raw.trim() : null;
  });

  // Reset note-style draft when switching notes endpoints / materials.
  useEffect(() => {
    noteStyleSaveGenRef.current += 1;
    setNoteStyleDraft(noteInstruction);
    setNoteStyleSaved(noteInstruction);
    setNoteStyleSaveState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on endpoint change
  }, [endpoint]);

  const persistNoteStyle = useCallback(
    async (value: string) => {
      if (!onNoteInstructionSave) return;
      const gen = ++noteStyleSaveGenRef.current;
      setNoteStyleSaveState("saving");
      try {
        await onNoteInstructionSave(value);
        if (gen !== noteStyleSaveGenRef.current) return;
        setNoteStyleSaved(value);
        setNoteStyleSaveState("saved");
        window.setTimeout(() => {
          if (gen !== noteStyleSaveGenRef.current) return;
          setNoteStyleSaveState((s) => (s === "saved" ? "idle" : s));
        }, 1600);
      } catch {
        if (gen !== noteStyleSaveGenRef.current) return;
        setNoteStyleSaveState("error");
      }
    },
    [onNoteInstructionSave]
  );

  const saveNoteStyle = useCallback(() => {
    void persistNoteStyle(noteStyleDraftRef.current);
  }, [persistNoteStyle]);

  useEffect(() => {
    if (!onNoteInstructionSave) return;
    if (noteStyleDraft === noteStyleSaved) return;
    const id = window.setTimeout(() => {
      void persistNoteStyle(noteStyleDraftRef.current);
    }, 700);
    return () => window.clearTimeout(id);
  }, [
    noteStyleDraft,
    noteStyleSaved,
    onNoteInstructionSave,
    persistNoteStyle,
  ]);

  const saveTimerRef = useRef<number | null>(null);
  const titleSaveTimerRef = useRef<number | null>(null);
  const initialDocRef = useRef<unknown | null>(initialContentJson ?? null);
  const notesHydratedRef = useRef(Boolean(initialContentJson));
  const [notesHydrated, setNotesHydrated] = useState(
    Boolean(initialContentJson)
  );
  const docChromeDirtyRef = useRef(false);
  const editorDirtyRef = useRef(false);
  const defaultTitle = courseTitle || lessonTitle || "Notes";
  const [docTitleInternal, setDocTitleInternal] = useState(defaultTitle);
  const docTitleControlled = Boolean(onDocTitleChange);
  const docTitle = docTitleControlled ? lessonTitle : docTitleInternal;
  const setDocTitle = useCallback(
    (next: string) => {
      docChromeDirtyRef.current = true;
      if (onDocTitleChange) onDocTitleChange(next);
      else setDocTitleInternal(next);
    },
    [onDocTitleChange]
  );
  const [docEmoji, setDocEmoji] = useState(() => {
    if (initialContentJson) {
      const attrs = readRoseDocAttrs(initialContentJson);
      if (attrs.roseDocEmoji) return attrs.roseDocEmoji;
    }
    return pickDocEmoji(`${lessonTitle} ${courseTitle}`);
  });

  // Live handle to the editor so the (synchronously-defined) key handler can
  // reach commands without a use-before-define on `editor`.
  const editorInstanceRef = useRef<Editor | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pickImageRef = useRef<() => void>(() => {});
  const insertNoteImageRef = useRef<(file: File) => Promise<void>>(async () => {});
  const [uploadingImage, setUploadingImage] = useState(false);

  // Scrollable document-body wrapper — used by `preserveSelection` appends to
  // decide whether to follow new content (only when already near the bottom).
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollPinnedRef = useRef(true);
  const lastScrollTopRef = useRef(0);

  const isScrollPinned = useCallback(() => {
    const el = scrollBodyRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  }, []);

  useEffect(() => {
    if (!scrollFollowMode) return;
    const el = scrollBodyRef.current;
    if (!el) return;
    scrollPinnedRef.current = isScrollPinned();
    lastScrollTopRef.current = el.scrollTop;
    const onScroll = () => {
      if (el.scrollTop < lastScrollTopRef.current - 4) {
        scrollPinnedRef.current = false;
      } else if (isScrollPinned()) {
        scrollPinnedRef.current = true;
      }
      lastScrollTopRef.current = el.scrollTop;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollFollowMode, isScrollPinned]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        document: false,
      }),
      RoseDocument,
      Underline,
      Highlight.configure({ multicolor: true }),
      KeyTermEmphasis,
      Typography,
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          class: "tn-link",
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: false,
        HTMLAttributes: { class: "tn-img" },
      }),
      Table.configure({
        resizable: true,
        lastColumnResizable: true,
        handleWidth: 10,
        cellMinWidth: 96,
        HTMLAttributes: { class: "tn-table" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      Callout,
      Provenance,
      SlashCommand.configure({
        onPickImage: () => pickImageRef.current(),
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") return "Heading";
          return "";
        },
        includeChildren: false,
      }),
    ],
    editorProps: {
      handleScrollToSelection: scrollFollowMode ? () => true : undefined,
      attributes: {
        class:
          "tn-prose max-w-none focus:outline-none min-h-[6rem] caret-zinc-700",
      },
      handlePaste: (_view, event) => {
        const files = imageFilesFromDataTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertNoteImageRef.current(files[0]!);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = imageFilesFromDataTransfer(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        void insertNoteImageRef.current(files[0]!);
        return true;
      },
      handleKeyDown: (view, event) => {
        // Tab / Shift-Tab nest & un-nest list items (bulleted, numbered, and
        // to-do). This lets a student indent an item under another — e.g. a
        // sub-point beneath a numbered step — and then change its type with
        // the slash menu. We handle it explicitly (rather than relying solely
        // on the list keymap) so nesting is reliable regardless of focus.
        if (event.key === "Tab" && !event.metaKey && !event.ctrlKey && !event.altKey) {
          const ed = editorInstanceRef.current;
          if (ed) {
            const itemType = ed.isActive("taskItem")
              ? "taskItem"
              : ed.isActive("listItem")
                ? "listItem"
                : null;
            if (itemType) {
              event.preventDefault();
              if (event.shiftKey) {
                ed.chain().focus().liftListItem(itemType).run();
              } else {
                ed.chain().focus().sinkListItem(itemType).run();
              }
              return true;
            }
          }
        }
        // Cmd+K for link insertion — match Notion's default.
        if ((event.metaKey || event.ctrlKey) && event.key === "k") {
          event.preventDefault();
          // Async dialog: capture the selection now, apply the link when the
          // user confirms (the EditorView ref stays live across the await).
          const { from, to } = view.state.selection;
          const hadSelection =
            view.state.doc.textBetween(from, to, "").length > 0;
          void promptDialog({
            title: "Insert link",
            label: "Link URL",
            placeholder: "https://example.com",
          }).then((url) => {
            if (!url) return;
            const { state, dispatch } = view;
            if (!hadSelection) {
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
          });
          return true;
        }
        return false;
      },
    },
    content: (initialContentJson as object | undefined) ?? undefined,
  });
  editorInstanceRef.current = editor;

  const insertNoteImage = useCallback(async (file: File) => {
    const ed = editorInstanceRef.current;
    if (!ed || ed.isDestroyed) return;
    setUploadingImage(true);
    try {
      const result = await uploadNoteImage(file);
      if (!result.ok) {
        await alertDialog({
          title: "Couldn’t add image",
          body: result.error,
        });
        return;
      }
      ed.chain().focus().setImage({ src: result.url }).run();
    } finally {
      setUploadingImage(false);
    }
  }, []);

  insertNoteImageRef.current = insertNoteImage;
  pickImageRef.current = () => imageInputRef.current?.click();

  const [streamingNotes, setStreamingNotes] = useState(false);
  const streamingChunkIdRef = useRef<string | null>(null);

  // One shared token-streaming renderer per editor instance. Live Notes
  // drives it directly (op-marker protocol with self-revision); mentored
  // streaming reaches it through the legacy begin/append/finish methods.
  const streamWriterRef = useRef<StreamingNotesWriter | null>(null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const writer = new StreamingNotesWriter(editor, {
      getScrollElement: () => scrollBodyRef.current,
      shouldFollowContent: scrollFollowMode
        ? () => scrollPinnedRef.current
        : undefined,
    });
    streamWriterRef.current = writer;
    return () => {
      writer.destroy();
      if (streamWriterRef.current === writer) {
        streamWriterRef.current = null;
      }
    };
  }, [editor, scrollFollowMode]);

  // Imperative handle for the parent — auto-generate uses this to
  // append structured "Rose just covered X" blocks directly into the
  // doc. Layout is now Notion-style: H2 heading, optional intro,
  // bullets with optional bold key terms + nested children, optional
  // callout.
  useEffect(() => {
    if (!editorRef) return;

    const isChunkAppended = (chunkId: string, heading?: string) => {
      if (!editor || editor.isDestroyed) return false;
      const doc = editor.getJSON();
      const appendedIds = readRoseAppendedChunkIds(doc);
      if (appendedIds.includes(chunkId)) return true;
      if (!heading?.trim()) return false;
      const nodes =
        (
          doc as {
            content?: Array<{
              type?: string;
              content?: Array<{ text?: string; content?: unknown[] }>;
            }>;
          }
        ).content ?? [];
      const target = heading.trim();
      return nodes.some(
        (n) =>
          n.type === "heading" && nodePlainText(n).trim() === target
      );
    };

    const handle = {
      isChunkAppended,
      appendBlock: ({
        heading,
        intro,
        bullets,
        callout,
        vocabulary,
        examples,
        selfCheck,
        dividerBefore,
        skipHeading,
        skipDedupe,
        chunkId,
        preserveSelection,
      }: AutoGenerateBlock) => {
        autoGenLog("inserting notes into editor", {
          hasEditor: !!editor,
          editorDestroyed: editor?.isDestroyed ?? null,
          skipHeading,
          skipDedupe,
          introPreview: intro?.slice(0, 80),
          bulletCount: bullets.length,
        });
        if (!editor) {
          autoGenLog("insertion aborted — editor not ready");
          return false;
        }

        if (
          chunkId &&
          !skipDedupe &&
          isChunkAppended(chunkId, skipHeading ? undefined : heading)
        ) {
          autoGenLog("insertion skipped — chunk already in doc metadata", {
            chunkId,
          });
          return true;
        }

        const doc = editor.getJSON();
        const nodes =
          (
            doc as {
              content?: Array<{
                type?: string;
                content?: Array<{ text?: string; content?: unknown[] }>;
              }>;
            }
          ).content ?? [];

        // Skip if this exact heading block was already appended (prevents
        // duplicate stacks when auto-generate re-fires on the same chunk).
        if (heading && !skipHeading && !skipDedupe) {
          const target = heading.trim();
          const already = nodes.some(
            (n) => n.type === "heading" && nodePlainText(n).trim() === target
          );
          if (already) {
            autoGenLog("insertion skipped — heading already present", {
              heading: target,
            });
            if (chunkId) {
              const existing = readRoseAppendedChunkIds(doc);
              if (!existing.includes(chunkId)) {
                editor.commands.updateAttributes("doc", {
                  roseAppendedChunkIds: [...existing, chunkId],
                });
              }
            }
            return true;
          }
        }

        // skipHeading path: dedupe by intro fingerprint (same chunk re-mounted).
        if (!skipDedupe && skipHeading && intro && intro.trim().length > 0) {
          const fingerprint = intro.trim().slice(0, 96);
          const already = nodes.some((n) => {
            if (n.type !== "paragraph") return false;
            const t = nodePlainText(n).trim();
            return t.startsWith(fingerprint) || fingerprint.startsWith(t.slice(0, 96));
          });
          if (already) {
            autoGenLog("insertion skipped — dedupe matched existing intro", {
              fingerprint,
            });
            return true;
          }
        }

        // Build the block as a node array so it can be inserted either at the
        // (focused) end — legacy behavior — or at the doc end WITHOUT touching
        // focus/selection (`preserveSelection`, Live Notes).
        const blockNodes: Array<Record<string, unknown>> = [];

        if (dividerBefore) {
          blockNodes.push({ type: "horizontalRule" });
        }

        const inlineFromMarkdown = (raw: string) =>
          parseInlineMarkdown(sanitizeIncompleteInlineMarkdown(raw));

        if (heading && !skipHeading) {
          blockNodes.push({
            type: "heading",
            attrs: { level: 2 },
            content: inlineFromMarkdown(heading),
          });
        }

        if (intro && intro.trim().length > 0) {
          blockNodes.push({
            type: "paragraph",
            content: inlineFromMarkdown(intro.trim()),
          });
        }

        if (bullets.length > 0) {
          blockNodes.push({
            type: "bulletList",
            content: bullets.map((b) => {
              const text = typeof b === "string" ? b : b.text;
              const bold = typeof b === "string" ? undefined : b.bold;
              const children =
                typeof b === "string" ? undefined : b.children ?? undefined;

              type RichText = {
                type: "text";
                text: string;
                marks?: { type: string; attrs?: Record<string, string> }[];
              };
              let inlineContent: RichText[];
              if (bold && text.toLowerCase().startsWith(bold.toLowerCase())) {
                inlineContent = [
                  {
                    type: "text",
                    text: text.slice(0, bold.length),
                    marks: keyTermMarks(),
                  },
                  {
                    type: "text",
                    text: text.slice(bold.length),
                  },
                ];
              } else {
                inlineContent = inlineFromMarkdown(text);
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
                        content: inlineFromMarkdown(c),
                      },
                    ],
                  })),
                });
              }
              return { type: "listItem", content: itemContent };
            }),
          });
        }

        if (vocabulary && vocabulary.length > 0) {
          blockNodes.push({
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Key vocabulary" }],
          });
          blockNodes.push({
            type: "bulletList",
            content: vocabulary.map(({ term, definition }) => ({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: definition
                    ? [
                        {
                          type: "text",
                          text: term,
                          marks: keyTermMarks(),
                        },
                        { type: "text", text: ` — ${definition}` },
                      ]
                    : [{ type: "text", text: term, marks: keyTermMarks() }],
                },
              ],
            })),
          });
        }

        if (callout && callout.text.trim().length > 0) {
          blockNodes.push({
            type: "callout",
            attrs: { emoji: callout.emoji ?? "💡" },
            content: [
              {
                type: "paragraph",
                content: inlineFromMarkdown(callout.text.trim()),
              },
            ],
          });
        }

        if (selfCheck && selfCheck.length > 0) {
          blockNodes.push({
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Self-check" }],
          });
          blockNodes.push({
            type: "orderedList",
            content: selfCheck.map((q) => ({
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: inlineFromMarkdown(q.trim()),
                },
              ],
            })),
          });
        }

        // Replace the default empty doc paragraph when appending at the end
        // so AI blocks don't leave a leading blank (the CSS that used to
        // hide those empties also hid student Enter-splits).
        const trail = trailingEmptyParagraphRange(editor.state.doc);
        const insertPos = trail ? trail.from : editor.state.doc.content.size;

        if (preserveSelection) {
          // Insert at the doc end without focusing — the student's cursor and
          // scroll position stay untouched (ProseMirror maps the selection
          // through the transaction). Auto-scroll only when the reader was
          // already following along at the bottom.
          const scrollEl = scrollBodyRef.current;
          const wasNearBottom = scrollFollowMode
            ? scrollPinnedRef.current
            : scrollEl
              ? scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight <
                160
              : false;
          // Stamp provenance so wrap-up can tell AI blocks from student
          // writing; the tx meta stops the provenance tracker from treating
          // this append as a student edit.
          const stamped = blockNodes.map((n) => ({
            ...n,
            attrs: {
              ...(n.attrs as Record<string, unknown> | undefined),
              provenance: "ai",
            },
          }));
          editor
            .chain()
            .command(({ tr }) => {
              tr.setMeta(AI_APPEND_META, true);
              if (trail) tr.delete(trail.from, trail.to);
              return true;
            })
            .insertContentAt(insertPos, stamped)
            .run();
          if (scrollEl && wasNearBottom) {
            requestAnimationFrame(() => {
              scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
            });
          }
        } else {
          editor
            .chain()
            .command(({ tr }) => {
              if (trail) tr.delete(trail.from, trail.to);
              return true;
            })
            .focus("end")
            .insertContent(blockNodes)
            .run();
        }

        if (chunkId) {
          const existing = readRoseAppendedChunkIds(editor.getJSON());
          if (!existing.includes(chunkId)) {
            editor.commands.updateAttributes("doc", {
              roseAppendedChunkIds: [...existing, chunkId],
            });
          }
        }

        autoGenLog("insertion complete", {
          docSizeAfter: editor.state.doc.content.size,
        });
        return true;
      },
      beginStreamedNotes: ({
        chunkId,
        heading,
        dividerBefore,
        skipDedupe,
      }: StreamedNotesOptions) => {
        if (!editor || editor.isDestroyed) return false;

        if (
          chunkId &&
          !skipDedupe &&
          isChunkAppended(chunkId, heading)
        ) {
          autoGenLog("stream skipped — chunk already in doc", { chunkId });
          return false;
        }

        if (heading && !skipDedupe) {
          const doc = editor.getJSON();
          const nodes =
            (
              doc as {
                content?: Array<{
                  type?: string;
                  content?: Array<{ text?: string; content?: unknown[] }>;
                }>;
              }
            ).content ?? [];
          const target = heading.trim();
          if (
            nodes.some(
              (n) => n.type === "heading" && nodePlainText(n).trim() === target
            )
          ) {
            autoGenLog("stream skipped — heading already present", { heading: target });
            if (chunkId) {
              const existing = readRoseAppendedChunkIds(doc);
              if (!existing.includes(chunkId)) {
                editor.commands.updateAttributes("doc", {
                  roseAppendedChunkIds: [...existing, chunkId],
                });
              }
            }
            return false;
          }
        }

        // Delegate to the shared streaming writer: cursor-safe anchor
        // placement, incremental markdown rendering, provenance stamping.
        const writer = streamWriterRef.current;
        if (!writer) {
          autoGenLog("stream skipped — writer not ready");
          return false;
        }
        writer.beginAppend({
          sectionId: `chunk:${chunkId}`,
          dividerBefore,
          heading: heading?.trim() || undefined,
        });

        streamingChunkIdRef.current = chunkId;
        setStreamingNotes(true);
        autoGenLog("stream started", { chunkId, heading });
        return true;
      },
      appendStreamedNotesDelta: (delta: string) => {
        streamWriterRef.current?.write(delta);
      },
      finishStreamedNotes: (chunkId: string) => {
        streamWriterRef.current?.finishOp();
        if (editor && !editor.isDestroyed && chunkId) {
          const existing = readRoseAppendedChunkIds(editor.getJSON());
          if (!existing.includes(chunkId)) {
            editor.commands.updateAttributes("doc", {
              roseAppendedChunkIds: [...existing, chunkId],
            });
          }
        }
        streamingChunkIdRef.current = null;
        setStreamingNotes(false);
        autoGenLog("stream finished", { chunkId });
      },
      abortStreamedNotes: () => {
        // Discard orphan heading-only sections / restore failed revisions.
        streamWriterRef.current?.abortOp();
        streamingChunkIdRef.current = null;
        setStreamingNotes(false);
        autoGenLog("stream aborted");
      },
      getStreamWriter: () => streamWriterRef.current,
      setStreamingIndicator: (on: boolean) => setStreamingNotes(on),
      getSelectedText: () => {
        if (!editor || editor.isDestroyed) return "";
        const { from, to } = editor.state.selection;
        if (from === to) return "";
        return editor.state.doc.textBetween(from, to, "\n").trim();
      },
      getSelectedSectionId: () => {
        if (!editor || editor.isDestroyed) return "";
        return streamWriterRef.current?.sectionIdAtSelection() ?? "";
      },
      revealSection: (sectionId: string) => {
        if (!editor || editor.isDestroyed || !sectionId) return false;
        const root = editor.view.dom;
        let el: Element | null = null;
        try {
          el = root.querySelector(
            `[data-section-id="${CSS.escape(sectionId)}"]`
          );
        } catch {
          el = root.querySelector(`[data-section-id="${sectionId}"]`);
        }
        if (!el) return false;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const tr = editor.state.tr;
        tr.setMeta(REVISION_DECO_META, {
          set: { [sectionId]: "rose-note-jump" },
        });
        tr.setMeta(AI_APPEND_META, true);
        editor.view.dispatch(tr);
        window.setTimeout(() => {
          if (editor.isDestroyed) return;
          const clear = editor.state.tr;
          clear.setMeta(REVISION_DECO_META, { clear: [sectionId] });
          clear.setMeta(AI_APPEND_META, true);
          editor.view.dispatch(clear);
        }, 2_200);
        return true;
      },
      hasContent: () => {
        if (!editor || editor.isDestroyed) return false;
        return docToPlainText(editor.getJSON()).trim().length > 0;
      },
    };
    editorRef.current = handle;
    autoGenLog("editor imperative handle wired");
    return () => {
      if (editorRef.current === handle) {
        editorRef.current = null;
        autoGenLog("editor imperative handle cleared (this instance unmounted)");
      }
    };
  }, [editor, editorRef]);

  const editorReadyFiredRef = useRef(false);
  const notesLoadedForRef = useRef<string | null>(
    initialContentJson ? endpoint : null
  );

  // When content was server-seeded, mark ready once the editor mounts.
  useEffect(() => {
    if (!editor || !initialContentJson) return;
    if (editorReadyFiredRef.current) return;
    editorReadyFiredRef.current = true;
    notesHydratedRef.current = true;
    setNotesHydrated(true);
    onEditorReady?.();
  }, [editor, initialContentJson, onEditorReady]);

  // Initial load — hydrate the editor with the saved doc once per endpoint.
  useEffect(() => {
    if (!editor) return;
    if (initialContentJson) return;
    if (notesLoadedForRef.current === endpoint) return;
    notesLoadedForRef.current = endpoint;
    editorReadyFiredRef.current = false;
    const fallbackTitle = courseTitle || lessonTitle || "Notes";
    let cancelled = false;
    void (async () => {
      autoGenLog("loading saved notes from server", { endpoint });
      try {
        const res = await fetch(endpoint);
        autoGenLog("load response received", {
          ok: res.ok,
          status: res.status,
          endpoint,
        });
        if (!res.ok) return;
        const body = (await res.json()) as {
          notes?: {
            title?: string;
            contentJson: unknown;
            autoGenerate: boolean;
            updatedAt?: string;
          };
        };
        autoGenLog("load response body parsed", {
          autoGenerate: body.notes?.autoGenerate,
          hasContent: !!body.notes?.contentJson,
        });
        if (cancelled) return;
        const doc = body.notes?.contentJson;
        const attrs = readRoseDocAttrs(doc);
        const isStandaloneNote = endpoint.includes("/api/notes/");
        const apiTitle =
          typeof body.notes?.title === "string" ? body.notes.title.trim() : "";
        const loadedTitle = isStandaloneNote
          ? apiTitle || attrs.roseDocTitle?.trim() || fallbackTitle
          : attrs.roseDocTitle?.trim() || fallbackTitle;
        if (!docTitleControlled) {
          setDocTitle(loadedTitle);
        }
        if (attrs.roseDocEmoji) {
          setDocEmoji(attrs.roseDocEmoji);
        }
        if (doc && editor && !editor.isDestroyed) {
          initialDocRef.current = doc;
          editor.commands.setContent(doc as never, { emitUpdate: false });
          const recap = attrs.roseLectureRecap?.trim();
          setLectureRecapSeed(recap ? recap : null);
          setContentRevision((n) => n + 1);
          autoGenLog("editor hydrated from saved doc");
        }
        if (typeof body.notes?.autoGenerate === "boolean") {
          autoGenLog("syncing autoGenerate preference from server (no append)", {
            autoGenerate: body.notes.autoGenerate,
          });
          onAutoGenerateChange(body.notes.autoGenerate);
        }
        if (body.notes?.updatedAt) {
          const t = Date.parse(body.notes.updatedAt);
          if (!Number.isNaN(t)) setLastSavedAt(t);
        }
        if (!cancelled && !editorReadyFiredRef.current) {
          editorReadyFiredRef.current = true;
          autoGenLog("notes panel ready — firing onEditorReady");
          notesHydratedRef.current = true;
          setNotesHydrated(true);
          onEditorReady?.();
        }
      } catch (e) {
        autoGenLogError("load failed", e, { endpoint });
        if (!cancelled) {
          notesHydratedRef.current = true;
          setNotesHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    courseTitle,
    docTitleControlled,
    editor,
    endpoint,
    initialContentJson,
    lessonTitle,
    onAutoGenerateChange,
    onEditorReady,
    setDocTitle,
  ]);

  const buildSavePayload = useCallback((): {
    contentJson: unknown;
    contentText: string;
  } | null => {
    if (!editor || editor.isDestroyed) return null;
    const prevAttrs = readRoseDocAttrs(editor.getJSON());
    editor.commands.updateAttributes("doc", {
      roseDocTitle: docTitle.trim(),
      roseDocEmoji: docEmoji,
      // Explicitly keep recap / chunk tracking — some TipTap paths drop
      // unspecified custom attrs when only title/emoji are patched.
      roseLectureRecap: prevAttrs.roseLectureRecap ?? "",
      roseAppendedChunkIds: Array.isArray(prevAttrs.roseAppendedChunkIds)
        ? prevAttrs.roseAppendedChunkIds
        : [],
    });
    const contentJson = editor.getJSON();
    return {
      contentJson,
      contentText: docToPlainText(contentJson),
    };
  }, [docEmoji, docTitle, editor]);

  const saveNow = useCallback(async () => {
    const payload = buildSavePayload();
    if (!payload) return;
    setSaving("saving");
    const isStandaloneNote = endpoint.includes("/api/notes/");
    const attempt = async (): Promise<boolean> => {
      try {
        const res = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentJson: payload.contentJson,
            contentText: payload.contentText,
            ...(isStandaloneNote && docTitle.trim()
              ? { title: docTitle.trim().slice(0, 200) }
              : {}),
          }),
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
      docChromeDirtyRef.current = false;
      editorDirtyRef.current = false;
      const now = Date.now();
      setLastSavedAt(now);
      setSaving("saved");
      window.setTimeout(() => {
        setSaving((s) => (s === "saved" ? "idle" : s));
      }, 1800);
    } else {
      setSaving("error");
    }
  }, [buildSavePayload, endpoint, docTitle]);

  const flushPendingSaveKeepalive = useCallback(() => {
    if (saveTimerRef.current != null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (titleSaveTimerRef.current != null) {
      window.clearTimeout(titleSaveTimerRef.current);
      titleSaveTimerRef.current = null;
    }
    if (!editorDirtyRef.current && !docChromeDirtyRef.current) return;
    const payload = buildSavePayload();
    if (!payload) return;
    const isStandaloneNote = endpoint.includes("/api/notes/");
    try {
      void fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contentJson: payload.contentJson,
          contentText: payload.contentText,
          ...(isStandaloneNote && docTitle.trim()
            ? { title: docTitle.trim().slice(0, 200) }
            : {}),
        }),
        keepalive: true,
      });
      editorDirtyRef.current = false;
      docChromeDirtyRef.current = false;
    } catch {
      /* ignore */
    }
  }, [buildSavePayload, endpoint, docTitle]);

  const persistDocChrome = useCallback(() => {
    void saveNow();
  }, [saveNow]);

  // Autosave: debounce 1500ms after the last update event.
  useEffect(() => {
    if (!editor) return;
    const handler = () => {
      editorDirtyRef.current = true;
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void saveNow();
      }, 1500);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (saveTimerRef.current != null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [editor, saveNow]);

  // Title + emoji live outside the TipTap doc — debounce-save when they change.
  useEffect(() => {
    if (!notesHydratedRef.current || !docChromeDirtyRef.current) return;
    if (!editor || editor.isDestroyed) return;
    if (titleSaveTimerRef.current) {
      window.clearTimeout(titleSaveTimerRef.current);
    }
    titleSaveTimerRef.current = window.setTimeout(() => {
      void saveNow();
    }, 600);
    return () => {
      if (titleSaveTimerRef.current) {
        window.clearTimeout(titleSaveTimerRef.current);
      }
    };
  }, [docEmoji, docTitle, editor, saveNow]);

  // Flush pending edits before tab close or client-side navigation (unmount).
  useEffect(() => {
    const onHide = () => flushPendingSaveKeepalive();
    window.addEventListener("pagehide", onHide);
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      flushPendingSaveKeepalive();
    };
  }, [flushPendingSaveKeepalive]);

  // Auto-generate toggle: persist immediately via a payload-only PUT.
  const onToggleAutoGenerate = useCallback(
    async (next: boolean) => {
      autoGenLog("button clicked");
      const notesExist =
        !!editor &&
        !editor.isDestroyed &&
        docToPlainText(editor.getJSON()).trim().length > 0;
      autoGenLog("current state", {
        isGenerating: false,
        hasGenerated: autoGenerate,
        notesExist,
        autoGenerate,
        hasEditor: !!editor,
      });
      // Only backfill when turning ON with an empty notes doc (tutor sessions).
      if (next && (!autoGenerateBackfillOnlyWhenEmpty || !notesExist)) {
        onAutoGenerateUserToggle?.(next);
      }
      onAutoGenerateChange(next);
      if (!editor) {
        autoGenLog("persist skipped — no editor for PUT");
        return;
      }
      const payload = buildSavePayload();
      if (!payload) return;
      const body = {
        contentJson: payload.contentJson,
        contentText: payload.contentText,
        autoGenerate: next,
      };
      autoGenLog("sending request to persist toggle", {
        endpoint,
        payload: { autoGenerate: next, contentTextLength: payload.contentText.length },
      });
      try {
        const res = await fetch(endpoint, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const bodyText = await res.text();
        autoGenLog("persist toggle response received", {
          ok: res.ok,
          status: res.status,
          bodyPreview: bodyText.slice(0, 200),
        });
        if (!res.ok) {
          autoGenLogError("persist toggle failed", new Error(`HTTP ${res.status}`), {
            body: bodyText,
          });
        }
      } catch (e) {
        autoGenLogError("persist toggle error", e, { endpoint });
      }
    },
    [
      autoGenerate,
      autoGenerateBackfillOnlyWhenEmpty,
      buildSavePayload,
      editor,
      endpoint,
      onAutoGenerateChange,
      onAutoGenerateUserToggle,
    ]
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
      className={`tn-panel relative flex flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/95 shadow-[0_20px_50px_-25px_rgba(60,60,90,0.18)] backdrop-blur-md ${fillHeight ? "h-full min-h-0" : ""} ${className ?? ""}`}
    >
      {/* Sticky chrome: save status + (optional) note-style instruction box. */}
      <div
        className={`${pinToolbar ? "sticky top-0 z-10" : ""} shrink-0 border-b border-zinc-100 bg-white/95 backdrop-blur-sm`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 xl:px-7">
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
            {streamingNotes ? "Rose is writing notes…" : savedLabel}
          </span>
          <div className="flex items-center gap-3">
            {hideAutoGenerate ? null : (
              <button
                type="button"
                role="switch"
                aria-checked={autoGenerate}
                aria-label="Auto-generate notes"
                onClick={() => void onToggleAutoGenerate(!autoGenerate)}
                className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-700"
              >
                <span aria-hidden>✨</span>
                <span>Auto-generate</span>
                <span
                  aria-hidden
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${
                    autoGenerate ? "bg-zinc-800" : "bg-zinc-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                      autoGenerate ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </span>
              </button>
            )}
          </div>
        </div>

        {onNoteInstructionChange ? (
          <div className="border-t border-zinc-100 bg-zinc-50/90 px-5 py-2.5 xl:px-7">
            <button
              type="button"
              onClick={() => setNoteStyleOpen((v) => !v)}
              aria-expanded={noteStyleOpen}
              className="flex w-full cursor-pointer items-center justify-between gap-2 text-left"
            >
              <span className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-zinc-700">
                <span aria-hidden>✎</span>
                {t.immersive.noteStyleButton}
                {noteStyleDraft.trim() ? (
                  <span className="truncate font-normal text-zinc-500">
                    — {noteStyleDraft.trim()}
                  </span>
                ) : (
                  <span className="truncate font-normal text-zinc-400">
                    — {t.immersive.noteStyleTitle}
                  </span>
                )}
                {noteStyleSaveState === "error" ? (
                  <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/50 dark:text-red-200">
                    {t.immersive.noteStyleSaveFailed}
                  </span>
                ) : noteStyleDirty || noteStyleSaveState === "saving" ? (
                  <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                    {noteStyleSaveState === "saving"
                      ? t.immersive.noteStyleSaving
                      : t.immersive.noteStyleUpdating}
                  </span>
                ) : noteStyleSaveState === "saved" ? (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                    {t.immersive.noteStyleLive}
                  </span>
                ) : null}
              </span>
              <span className="shrink-0 text-[11px] text-zinc-400">
                {noteStyleOpen ? "▴" : "▾"}
              </span>
            </button>
            {noteStyleOpen ? (
              <div className="mt-2">
                <textarea
                  value={noteStyleDraft}
                  onChange={(e) => {
                    const next = e.target.value.slice(0, NOTE_INSTRUCTION_MAX);
                    setNoteStyleDraft(next);
                    onNoteInstructionChange(next);
                    if (
                      noteStyleSaveState === "saved" ||
                      noteStyleSaveState === "error"
                    ) {
                      setNoteStyleSaveState("idle");
                    }
                  }}
                  maxLength={NOTE_INSTRUCTION_MAX}
                  rows={3}
                  autoFocus
                  placeholder={t.immersive.noteStylePlaceholder}
                  className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="min-w-0 text-[10.5px] leading-snug text-zinc-400">
                    {t.immersive.noteStyleHint}
                  </p>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10.5px] tabular-nums text-zinc-400">
                      {noteStyleDraft.length}/{NOTE_INSTRUCTION_MAX}
                    </span>
                    {onNoteInstructionSave ? (
                      <button
                        type="button"
                        disabled={
                          !noteStyleDirty || noteStyleSaveState === "saving"
                        }
                        onClick={() => saveNoteStyle()}
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:cursor-default disabled:opacity-50 ${
                          noteStyleSaveState === "error"
                            ? "bg-red-600 text-white"
                            : noteStyleSaveState === "saved"
                              ? "bg-emerald-600 text-white"
                              : "bg-zinc-900 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                        }`}
                      >
                        {noteStyleSaveState === "saving"
                          ? t.immersive.noteStyleSaving
                          : noteStyleSaveState === "saved"
                            ? t.immersive.noteStyleSaved
                            : noteStyleSaveState === "error"
                              ? t.immersive.noteStyleSaveFailed
                              : t.immersive.noteStyleSave}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Document body — generous padding, max-width centered. */}
      <div ref={scrollBodyRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto w-full max-w-[720px] ${
            fillHeight
              ? "px-5 py-5 sm:px-6 sm:py-6"
              : "px-6 py-10 sm:px-10 lg:px-14 lg:py-14"
          }`}
        >
          {/* Document chrome — emoji + course metadata.
              The lesson title used to live here as a permanent H1
              that the user couldn't delete. Now it's gone — users
              own the document from line 1. The first node of the
              editor body acts as the title (TipTap's Placeholder
              extension prompts "Write your notes…" while empty),
              so a user-typed first H1 becomes the de-facto title
              and can be edited / deleted like any other block. */}
          <header className="mb-6">
            <div className="mb-3">
              <EmojiPickerButton
                value={docEmoji}
                ariaLabel="Choose document emoji"
                onChange={(emoji) => {
                  docChromeDirtyRef.current = true;
                  setDocEmoji(emoji);
                }}
              />
            </div>
            <input
              type="text"
              value={docTitle}
              onChange={(e) => {
                docChromeDirtyRef.current = true;
                setDocTitle(e.target.value);
              }}
              onBlur={() => persistDocChrome()}
              placeholder="Untitled notes"
              className="w-full border-none bg-transparent text-2xl font-semibold tracking-tight text-zinc-900 placeholder:text-zinc-300 focus:outline-none focus:ring-0"
              aria-label="Notes title"
            />
            <p className="mt-0.5 text-[12px] text-zinc-400">
              {lastSavedAt
                ? `Edited ${formatRelativeTime(lastSavedAt)}`
                : "Not saved yet"}
            </p>
            <LectureSummaryButton
              editor={editor}
              contentRevision={contentRevision}
              seedMarkdown={lectureRecapSeed}
              generateEndpoint={lectureRecapEndpoint}
            />
            <div className="mt-5 h-px w-full bg-zinc-100" />
          </header>

          {editor ? (
            <NotesFormatToolbar
              editor={editor}
              uploadingImage={uploadingImage}
              onPickImage={() => imageInputRef.current?.click()}
            />
          ) : null}

          <input
            ref={imageInputRef}
            type="file"
            accept={NOTE_IMAGE_MIME_TYPES.join(",")}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void insertNoteImage(file);
              e.target.value = "";
            }}
          />

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
                onClick={() => toggleKeyTermEmphasis(editor)}
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
              {HIGHLIGHT_COLORS.map((c) => (
                <BubbleBtn
                  key={c.value}
                  aria-label={`Highlight ${c.label.toLowerCase()}`}
                  title={`Highlight ${c.label.toLowerCase()}`}
                  active={editor.isActive("highlight", { color: c.value })}
                  onClick={() => applyKeyTermHighlight(editor, c.value)}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-sm ring-1 ring-black/15"
                    style={{ background: c.value }}
                  />
                </BubbleBtn>
              ))}
              <BubbleBtn
                aria-label="Remove highlight"
                title="Remove highlight"
                active={false}
                onClick={() => clearKeyTermEmphasis(editor)}
              >
                <span className="text-[12px] leading-none">⌫</span>
              </BubbleBtn>
              <BubbleBtn
                aria-label="Link"
                title="Link (⌘K)"
                active={editor.isActive("link")}
                onClick={() => {
                  const prev = editor.getAttributes("link").href as
                    | string
                    | undefined;
                  void promptDialog({
                    title: "Edit link",
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
                }}
              >
                <span>🔗</span>
              </BubbleBtn>
            </BubbleMenu>
          ) : null}
          {editor ? (
            <>
              <EditorContent editor={editor} />
              <NotesTableHoverControls editor={editor} />
            </>
          ) : initialContentJson ? (
            <div
              className="tn-prose max-w-none min-h-[6rem] whitespace-pre-wrap text-zinc-700"
              aria-busy="true"
            >
              {docToPlainText(initialContentJson) || "\u00a0"}
            </div>
          ) : (
            <div className="min-h-[6rem] animate-pulse space-y-2" aria-busy="true">
              <div className="h-3 w-2/3 rounded bg-zinc-100" />
              <div className="h-3 w-full rounded bg-zinc-100" />
              <div className="h-3 w-[90%] rounded bg-zinc-100" />
              <div className="h-3 w-[80%] rounded bg-zinc-100" />
            </div>
          )}
        </div>
      </div>

      {/* Slash / auto-generate hint — pinned to panel bottom (not mid-page). */}
      {editor && notesHydrated && editor.isEmpty ? (
        <div className="shrink-0 border-t border-zinc-100 bg-zinc-50/40 px-5 py-3 xl:px-7">
          <p className="select-none text-[12px] text-zinc-400">
            Press{" "}
            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
              /
            </kbd>{" "}
            for headings, lists, images, and tables — or paste a screenshot. Toggle{" "}
            <span className="text-zinc-500">✨ Auto-generate</span> to ask Rose
            to write in-depth notes as she teaches.
          </p>
        </div>
      ) : null}

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
          margin-top: 0.85rem;
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
          margin-top: 1.15rem !important;
          margin-bottom: 0.35rem !important;
        }
        .tn-prose h2 {
          font-size: 24px;
          font-weight: 700;
          margin-top: 0.9rem !important;
          margin-bottom: 0.3rem !important;
        }
        .tn-prose h3 {
          font-size: 19px;
          font-weight: 600;
          margin-top: 0.7rem !important;
          margin-bottom: 0.2rem !important;
        }
        .tn-prose > :first-child,
        .tn-prose hr + h1,
        .tn-prose hr + h2,
        .tn-prose hr + h3,
        .tn-prose p.is-empty + h1,
        .tn-prose p.is-empty + h2,
        .tn-prose p.is-empty + h3,
        .tn-prose p.is-editor-empty + h1,
        .tn-prose p.is-editor-empty + h2,
        .tn-prose p.is-editor-empty + h3 {
          margin-top: 0 !important;
        }
        .tn-prose h1 + p,
        .tn-prose h2 + p,
        .tn-prose h3 + p,
        .tn-prose h1 + ul,
        .tn-prose h2 + ul,
        .tn-prose h3 + ul,
        .tn-prose h1 + ol,
        .tn-prose h2 + ol,
        .tn-prose h3 + ol {
          margin-top: 0.35rem !important;
        }
        .tn-prose p {
          margin: 0;
          color: #37352f;
        }
        .tn-prose strong {
          font-weight: 700;
          color: inherit;
          background: ${KEY_TERM_HIGHLIGHT_COLOR};
          padding: 0.05rem 0.18rem;
          border-radius: 0.2rem;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
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

        /* Horizontal rule — section boundaries between AI note blocks */
        .tn-prose hr {
          border: none;
          margin: 0.55rem 0 0.15rem;
          height: 0;
          border-top: 1px solid #d4d3cf;
          background: transparent;
        }
        .tn-prose hr + h1,
        .tn-prose hr + h2,
        .tn-prose hr + h3 {
          margin-top: 0 !important;
        }
        /* Empty paragraphs are the gap Enter creates so the student can
           type between existing blocks. Do not collapse is-empty nodes
           to height 0 — that hid the caret and made the following words
           look glued to the new line. Generation leftover empties are
           removed at insert time (trailingEmptyParagraphRange). */

        /* Lecture summary jump highlight */
        .tn-prose .tn-summary-flash {
          animation: tnSummaryFlash 1.4s ease;
          border-radius: 0.5rem;
        }
        @keyframes tnSummaryFlash {
          0% {
            background: rgba(196, 181, 253, 0.55);
          }
          100% {
            background: transparent;
          }
        }

        /* Images / screenshots */
        .tn-prose img.tn-img,
        .tn-prose img {
          display: block;
          max-width: 100%;
          height: auto;
          margin: 0.85rem 0;
          border-radius: 0.65rem;
          border: 1px solid #ececec;
          background: #fafafa;
        }

        /* Tables — extra columns scroll instead of being crushed to 3-wide. */
        .tn-prose .tableWrapper {
          overflow-x: auto;
          overflow-y: visible;
          max-width: 100%;
          margin: 0.9rem 0;
          padding: 0.35rem 0.15rem 0.55rem;
        }
        .tn-prose table.tn-table,
        .tn-prose table {
          width: max-content;
          min-width: 100%;
          border-collapse: collapse;
          margin: 0;
          table-layout: auto;
          overflow: visible;
          border-radius: 0.5rem;
          border: 1px solid #e4e4e7;
        }
        .tn-prose th,
        .tn-prose td {
          border: 1px solid #e4e4e7;
          padding: 0.45rem 0.65rem;
          vertical-align: top;
          min-width: 6rem;
          position: relative;
        }
        .tn-prose th {
          background: #f4f4f5;
          font-weight: 600;
          text-align: left;
        }
        .tn-prose .selectedCell::after {
          content: "";
          position: absolute;
          inset: 0;
          background: rgba(139, 92, 246, 0.12);
          pointer-events: none;
        }
        .tn-prose.resize-cursor,
        .tn-prose.resize-cursor * {
          cursor: col-resize !important;
        }
        .tn-prose .column-resize-handle {
          position: absolute;
          right: -2px;
          top: 0;
          bottom: 0;
          width: 5px;
          background: #a78bfa;
          pointer-events: none;
          z-index: 4;
        }

        /* Text align */
        .tn-prose [style*="text-align: center"],
        .tn-prose [data-text-align="center"] {
          text-align: center;
        }
        .tn-prose [style*="text-align: right"],
        .tn-prose [data-text-align="right"] {
          text-align: right;
        }
        .tn-prose [style*="text-align: left"],
        .tn-prose [data-text-align="left"] {
          text-align: left;
        }

        /* Highlight — same wash as bold key terms; nested pair is one pill */
        .tn-prose mark {
          background: ${KEY_TERM_HIGHLIGHT_COLOR};
          padding: 0.05rem 0.18rem;
          border-radius: 0.2rem;
          color: inherit;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
        .tn-prose mark strong,
        .tn-prose strong mark {
          background: transparent;
          padding: 0;
          font-weight: 700;
        }

        /* AI self-revision transitions (StreamingNotesWriter decorations).
           The class arrives via a ProseMirror node decoration; the
           transition declared on the class animates entry into the
           faded/struck state before the section is rewritten. */
        .tn-prose .rose-note-revising,
        .tn-prose .rose-note-revising * {
          text-decoration: line-through;
          text-decoration-color: rgba(190, 18, 60, 0.4);
        }
        .tn-prose .rose-note-revising {
          opacity: 0.35;
          transition: opacity 0.3s ease;
        }
        .tn-prose .rose-note-revised {
          animation: roseNoteRevised 1.1s ease;
          border-radius: 0.35rem;
        }
        .tn-prose .rose-note-jump {
          animation: roseNoteJump 2.2s ease;
          border-radius: 0.4rem;
          outline: 2px solid rgba(139, 92, 246, 0.7);
          outline-offset: 3px;
        }
        @keyframes roseNoteRevised {
          0% {
            background: rgba(199, 210, 254, 0.55);
          }
          100% {
            background: transparent;
          }
        }
        @keyframes roseNoteJump {
          0% {
            background: rgba(167, 139, 250, 0.45);
          }
          100% {
            background: transparent;
          }
        }

        /* AI-added context (lecturer did NOT say this) — visually distinct
           so it can never be confused with lecture content. */
        .tn-prose .tn-callout[data-provenance="ai-context"] {
          position: relative;
          background: #eef2ff;
          border-color: #c7d2fe;
        }
        .tn-prose .tn-callout[data-provenance="ai-context"]::after {
          content: "AI context";
          position: absolute;
          top: 0.4rem;
          right: 0.7rem;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: #6366f1;
          pointer-events: none;
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
