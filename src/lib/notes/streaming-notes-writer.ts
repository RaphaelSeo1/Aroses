"use client";

import type { Editor } from "@tiptap/core";
import type { Node as PmNode } from "@tiptap/pm/model";
import { Fragment } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import {
  AI_APPEND_META,
  REVISION_DECO_META,
  type RevisionDecoMeta,
} from "@/components/immersive/notes/Provenance";
import {
  classifyNoteLine,
  mightBecomeNotePrefix,
  noteNodesToMarkdown,
  parseInlineMarkdown,
  type NoteInlineJson,
  type NoteLineKind,
  type NoteNodeJson,
} from "@/lib/notes/notes-markdown";

/**
 * StreamingNotesWriter — the ONE token-streaming renderer for AI notes,
 * shared by Live Notes and mentored-learning note generation.
 *
 * Responsibilities:
 *   - ANCHOR TRACKING: holds integer ProseMirror positions for the active
 *     insertion point and remaps them through every external transaction,
 *     so the student can type anywhere while tokens land at the AI anchor
 *     without stealing focus or moving their cursor.
 *   - LINE-BUFFERED MARKDOWN: tokens append into the current text node as
 *     they arrive (visible typing). A handful of chars at each line start
 *     are held back until the block prefix ("## ", "- ", "> (AI) ", …) is
 *     decided, so markdown syntax never flashes as literal text. `**bold**`
 *     is re-marked in place when the line completes — one transaction, no
 *     flicker.
 *   - PROVENANCE + SECTION STAMPING: every top-level node gets
 *     `provenance: "ai"` (or "ai-context" for `> (AI)` callouts) and a
 *     `sectionId` shared by all nodes of one synthesis call — the
 *     addressing unit for bounded self-revision.
 *   - VISIBLE REVISION: `beginRevision(id)` fades/strikes the old section
 *     via node decorations, then deletes it and streams the replacement
 *     into place, ending with a brief highlight.
 *
 * All writer transactions carry `AI_APPEND_META` (Provenance never flips
 * our own writes to "ai-edited") and `addToHistory: false` (student undo
 * never swallows AI output). Block placement is recomputed from the live
 * doc by sectionId on every block open — never from stale positions — so
 * concurrent edits cannot desync it.
 */

/** Meta marking our own transactions so the remap listener skips them. */
const WRITER_TX = "streamingNotesWriterTx";

const REVISION_FADE_MS = 350;
const REVISION_HIGHLIGHT_MS = 1_100;

type BlockTarget = {
  pos: number;
  deletePlaceholder: { from: number; to: number } | null;
};

/**
 * Resolve a block target inside a transaction: remove the revision
 * placeholder FIRST (deleting after inserting at its boundary would swallow
 * the new node in the position mapping), then return the insertion point.
 */
function insertionPoint(tr: Transaction, target: BlockTarget): number {
  if (target.deletePlaceholder) {
    tr.delete(target.deletePlaceholder.from, target.deletePlaceholder.to);
    return target.deletePlaceholder.from;
  }
  return target.pos;
}

type ActiveOp = {
  kind: "append" | "revision";
  sectionId: string;
  /** Raw incoming chars not yet committed to the doc. */
  buf: string;
  /** "prefix": deciding the next block; "text": streaming into a block. */
  mode: "prefix" | "text";
  /** Insertion point for the next text chunk (remapped through edits). */
  textPos: number | null;
  /** Where the current line's text began (for **bold** re-marking). */
  lineStart: number | null;
  /** Raw text of the current line streamed so far (after the prefix). */
  lineRaw: string;
  /** A blank line was seen — the next bullet starts a NEW list. */
  breakList: boolean;
  /** Revision placeholder paragraph awaiting the first real block. */
  pendingPlaceholder: boolean;
  /** Divider deferred until the append produces actual content. */
  pendingDivider: boolean;
  wroteAnything: boolean;
};

export type StreamedSection = { sectionId: string; markdown: string };

export class StreamingNotesWriter {
  private op: ActiveOp | null = null;
  private scrollPending = false;
  private destroyed = false;
  private editor: Editor;
  private opts: {
    getScrollElement?: () => HTMLElement | null;
    /** When false, new content is written without moving the scroll position. */
    shouldFollowContent?: () => boolean;
  };

  constructor(
    editor: Editor,
    opts: {
      getScrollElement?: () => HTMLElement | null;
      shouldFollowContent?: () => boolean;
    } = {}
  ) {
    this.editor = editor;
    this.opts = opts;
    this.editor.on("transaction", this.onExternalTransaction);
  }

  destroy() {
    this.destroyed = true;
    this.editor.off("transaction", this.onExternalTransaction);
    this.op = null;
  }

  get activeSectionId(): string | null {
    return this.op?.sectionId ?? null;
  }

  // ── Public op lifecycle ──────────────────────────────────────────────────

  /** Start streaming a NEW section appended after existing section content. */
  beginAppend(input: {
    sectionId: string;
    dividerBefore?: boolean;
    /** Optional pre-set H2 (mentored chunk concept) inserted immediately. */
    heading?: string;
  }): void {
    if (this.destroyed || this.editor.isDestroyed) return;
    this.finishOp();
    this.op = this.freshOp("append", input.sectionId);
    // Defer the divider until real content arrives — an append that turns
    // out empty (no new teaching in the slice) must leave the doc untouched.
    this.op.pendingDivider = Boolean(input.dividerBefore);

    if (input.heading?.trim()) {
      this.flushPendingDivider();
      const end = this.editor.state.doc.content.size;
      const heading = this.editor.schema.nodes.heading?.create(
        { level: 2, provenance: "ai", sectionId: input.sectionId },
        this.inlineToPm(parseInlineMarkdown(input.heading.trim()))
      );
      if (heading) {
        this.dispatchDoc((tr) => tr.insert(end, heading));
        this.op.wroteAnything = true;
        this.maybeScroll();
      }
    }
  }

  /**
   * Divider carries NO sectionId — a later revision of the section must not
   * eat the visual separator between sections.
   */
  private flushPendingDivider(): void {
    const op = this.op;
    if (!op || !op.pendingDivider) return;
    op.pendingDivider = false;
    const hr = this.editor.schema.nodes.horizontalRule?.create({
      provenance: "ai",
    });
    if (!hr) return;
    const pos = this.editor.state.doc.content.size;
    this.dispatchDoc((tr) => tr.insert(pos, hr));
  }

  /**
   * Start a visible revision of an existing section: fade/strike the old
   * blocks (~350ms), delete them, and point the stream at a placeholder so
   * the replacement types into the same spot. Returns false when the
   * section doesn't exist or was student-edited (edits are final).
   */
  async beginRevision(sectionId: string): Promise<boolean> {
    if (this.destroyed || this.editor.isDestroyed) return false;
    this.finishOp();

    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    if (
      blocks.some(
        (b) =>
          b.node.attrs?.provenance !== "ai" &&
          b.node.attrs?.provenance !== "ai-context"
      )
    ) {
      return false;
    }

    this.dispatchDeco({ set: { [sectionId]: "rose-note-revising" } });
    await new Promise((r) => window.setTimeout(r, REVISION_FADE_MS));
    if (this.destroyed || this.editor.isDestroyed) return false;

    // Recompute fresh — the doc may have changed during the fade.
    const fresh = this.sectionBlocks(sectionId);
    if (fresh.length === 0) {
      this.dispatchDeco({ clear: [sectionId] });
      return false;
    }
    const firstPos = fresh[0].pos;
    this.dispatchDoc((tr) => {
      for (let i = fresh.length - 1; i >= 0; i--) {
        tr.delete(fresh[i].pos, fresh[i].pos + fresh[i].node.nodeSize);
      }
      const placeholder = this.editor.schema.nodes.paragraph.create({
        provenance: "ai",
        sectionId,
      });
      tr.insert(Math.min(firstPos, tr.doc.content.size), placeholder);
      tr.setMeta(REVISION_DECO_META, { clear: [sectionId] } as RevisionDecoMeta);
    });

    this.op = this.freshOp("revision", sectionId);
    this.op.pendingPlaceholder = true;
    return true;
  }

  /** Feed streamed characters into the active op. */
  write(delta: string): void {
    if (!this.op || this.destroyed || this.editor.isDestroyed || !delta) return;
    this.op.buf += delta;
    this.drain();
  }

  /** Finalize the active op (flush the pending line, end-of-revision flash). */
  finishOp(): void {
    const op = this.op;
    if (!op) return;
    // A trailing line without a newline is still real content.
    if (op.buf.length > 0 && op.mode === "prefix") {
      const line = classifyNoteLine(op.buf);
      if (line.kind !== "blank") this.insertWholeLine(line);
      op.buf = "";
    } else if (op.buf.length > 0 && op.mode === "text") {
      this.insertText(op.buf);
      op.buf = "";
    }
    if (op.mode === "text") this.finalizeLine();

    if (op.kind === "revision") {
      if (op.pendingPlaceholder) {
        // Nothing streamed — drop the empty placeholder rather than leaving
        // a stray blank paragraph where the section used to be.
        const blocks = this.sectionBlocks(op.sectionId);
        const empty = blocks.find(
          (b) => b.node.type.name === "paragraph" && b.node.content.size === 0
        );
        if (empty && blocks.length === 1) {
          this.dispatchDoc((tr) =>
            tr.delete(empty.pos, empty.pos + empty.node.nodeSize)
          );
        }
      } else {
        const id = op.sectionId;
        this.dispatchDeco({ set: { [id]: "rose-note-revised" } });
        window.setTimeout(() => {
          if (!this.destroyed && !this.editor.isDestroyed) {
            this.dispatchDeco({ clear: [id] });
          }
        }, REVISION_HIGHLIGHT_MS);
      }
    }
    this.op = null;
  }

  // ── Section introspection (for self-revision context) ───────────────────

  /**
   * The last `limit` fully-AI sections (markdown + id), oldest first.
   * Sections containing ANY student-edited or student-authored block are
   * excluded — student edits are final and never offered for revision.
   */
  listRevisableSections(limit: number): StreamedSection[] {
    if (this.editor.isDestroyed) return [];
    const order: string[] = [];
    const groups = new Map<string, NoteNodeJson[]>();
    const excluded = new Set<string>();
    this.editor.state.doc.forEach((node) => {
      const sid = node.attrs?.sectionId;
      if (typeof sid !== "string" || !sid) return;
      const prov = node.attrs?.provenance;
      if (prov !== "ai" && prov !== "ai-context") excluded.add(sid);
      if (!groups.has(sid)) {
        groups.set(sid, []);
        order.push(sid);
      }
      groups.get(sid)!.push(node.toJSON() as NoteNodeJson);
    });
    const active = this.op?.sectionId;
    return order
      .filter((id) => !excluded.has(id) && id !== active)
      .slice(-limit)
      .map((id) => ({
        sectionId: id,
        markdown: noteNodesToMarkdown(groups.get(id)!),
      }))
      .filter((s) => s.markdown.trim().length > 0);
  }

  // ── Streaming core ───────────────────────────────────────────────────────

  private freshOp(kind: ActiveOp["kind"], sectionId: string): ActiveOp {
    return {
      kind,
      sectionId,
      buf: "",
      mode: "prefix",
      textPos: null,
      lineStart: null,
      lineRaw: "",
      breakList: false,
      pendingPlaceholder: false,
      pendingDivider: false,
      wroteAnything: false,
    };
  }

  private drain(): void {
    const op = this.op;
    if (!op) return;
    // Bounded loop: each pass either consumes buffer or returns.
    for (let guard = 0; guard < 10_000; guard++) {
      if (op.buf.length === 0) return;

      if (op.mode === "prefix") {
        const nl = op.buf.indexOf("\n");
        if (nl >= 0) {
          // A full line is available — insert it as one finished block.
          const line = classifyNoteLine(op.buf.slice(0, nl));
          op.buf = op.buf.slice(nl + 1);
          if (line.kind === "blank") {
            op.breakList = true;
            continue;
          }
          this.insertWholeLine(line);
          continue;
        }
        if (mightBecomeNotePrefix(op.buf)) return; // hold until decided
        // Prefix decided — open a streaming block and seed the text so far.
        const line = classifyNoteLine(op.buf);
        op.buf = "";
        if (line.kind === "blank" || line.kind === "hr") {
          // Can't be: blank/hr require a full line; treat as hold.
          return;
        }
        this.openStreamingBlock(line);
        if ("text" in line && line.text) this.insertText(line.text);
        continue;
      }

      // mode === "text": stream into the open block until the line ends.
      const nl = op.buf.indexOf("\n");
      if (nl === -1) {
        this.insertText(op.buf);
        op.buf = "";
        return;
      }
      const chunk = op.buf.slice(0, nl);
      op.buf = op.buf.slice(nl + 1);
      if (chunk) this.insertText(chunk);
      this.finalizeLine();
    }
  }

  /** Insert one complete line as a finished block (fast path). */
  private insertWholeLine(line: NoteLineKind): void {
    const op = this.op;
    if (!op) return;
    if (line.kind === "blank") {
      op.breakList = true;
      return;
    }
    if (line.kind === "hr") {
      // Section ## headings already separate live notes — skip markdown
      // "---" lines so we don't get a rule plus huge vertical gaps.
      op.pendingDivider = false;
      return;
    }
    const inline = parseInlineMarkdown(line.text.trim());
    this.openStreamingBlock(line, inline);
    // Block content arrived complete — close the line immediately.
    op.mode = "prefix";
    op.textPos = null;
    op.lineStart = null;
    op.lineRaw = "";
  }

  /**
   * Where the next top-level block goes: after the last node carrying this
   * op's sectionId, else at the doc end (append) — plus, for revisions, the
   * pending placeholder to remove once real content lands.
   */
  private blockInsertionPos(): {
    pos: number;
    deletePlaceholder: { from: number; to: number } | null;
  } {
    const op = this.op!;
    const blocks = this.sectionBlocks(op.sectionId);
    if (blocks.length === 0) {
      return { pos: this.editor.state.doc.content.size, deletePlaceholder: null };
    }
    const last = blocks[blocks.length - 1];
    const pos = last.pos + last.node.nodeSize;
    if (
      op.pendingPlaceholder &&
      blocks.length === 1 &&
      last.node.type.name === "paragraph" &&
      last.node.content.size === 0
    ) {
      return {
        pos,
        deletePlaceholder: { from: last.pos, to: last.pos + last.node.nodeSize },
      };
    }
    return { pos, deletePlaceholder: null };
  }

  /**
   * Open the block for a classified line. When `inline` is given the whole
   * line is inserted finished; otherwise an empty block is created and
   * `textPos` points inside it for token streaming.
   */
  private openStreamingBlock(
    line: Exclude<NoteLineKind, { kind: "hr" } | { kind: "blank" }>,
    inline?: NoteInlineJson[]
  ): void {
    this.flushPendingDivider();
    const op = this.op!;
    const { schema } = this.editor;
    const content = inline ? Fragment.from(this.inlineToPm(inline)) : undefined;
    const streaming = !inline;

    const sectionAttrs = { provenance: "ai", sectionId: op.sectionId };

    // List continuation: append into an existing trailing list of the same
    // type unless a blank line asked for a fresh list.
    if (line.kind === "bullet" || line.kind === "ordered") {
      const listName = line.kind === "ordered" ? "orderedList" : "bulletList";
      const blocks = this.sectionBlocks(op.sectionId);
      const last = blocks[blocks.length - 1];
      const paragraph = schema.nodes.paragraph.create(undefined, content);
      const listItem = schema.nodes.listItem.create(undefined, paragraph);

      if (
        line.kind === "bullet" &&
        line.depth === 1 &&
        last &&
        last.node.type.name === "bulletList" &&
        !op.breakList
      ) {
        // Nest under the last item of the open bullet list.
        let itemPos = -1;
        let itemNode: PmNode | null = null;
        last.node.forEach((child, off) => {
          if (child.type.name === "listItem") {
            itemPos = last.pos + 1 + off;
            itemNode = child;
          }
        });
        if (itemNode && itemPos >= 0) {
          const item: PmNode = itemNode;
          let nestedPos = -1;
          let nestedNode: PmNode | null = null;
          item.forEach((child: PmNode, off: number) => {
            if (child.type.name === "bulletList") {
              nestedPos = itemPos + 1 + off;
              nestedNode = child;
            }
          });
          if (nestedNode !== null && nestedPos >= 0) {
            const nested: PmNode = nestedNode;
            const insertAt = nestedPos + nested.nodeSize - 1;
            this.dispatchDoc((tr) => tr.insert(insertAt, listItem));
            this.enterTextMode(insertAt + 2, streaming);
            return;
          }
          const insertAt = itemPos + item.nodeSize - 1;
          const nestedList = schema.nodes.bulletList.create(undefined, listItem);
          this.dispatchDoc((tr) => tr.insert(insertAt, nestedList));
          this.enterTextMode(insertAt + 3, streaming);
          return;
        }
      }

      if (last && last.node.type.name === listName && !op.breakList) {
        const insertAt = last.pos + last.node.nodeSize - 1;
        this.dispatchDoc((tr) => tr.insert(insertAt, listItem));
        this.enterTextMode(insertAt + 2, streaming);
        return;
      }

      const list = schema.nodes[listName].create(sectionAttrs, listItem);
      const target = this.blockInsertionPos();
      let base = target.pos;
      this.dispatchDoc((tr) => {
        base = insertionPoint(tr, target);
        tr.insert(base, list);
      });
      this.enterTextMode(base + 3, streaming);
      return;
    }

    // Non-list blocks.
    let node: PmNode | null = null;
    let textDepth = 1;
    if (line.kind === "heading") {
      node = schema.nodes.heading.create(
        { ...sectionAttrs, level: line.level },
        content
      );
    } else if (line.kind === "aiContext") {
      const para = schema.nodes.paragraph.create(undefined, content);
      const calloutType = schema.nodes.callout;
      if (calloutType) {
        node = calloutType.create(
          { emoji: "✨", provenance: "ai-context", sectionId: op.sectionId },
          para
        );
        textDepth = 2;
      } else {
        node = schema.nodes.blockquote?.create(
          { provenance: "ai-context", sectionId: op.sectionId },
          para
        );
        textDepth = 2;
      }
    } else {
      node = schema.nodes.paragraph.create(sectionAttrs, content);
    }
    if (!node) return;

    const target = this.blockInsertionPos();
    const inserted = node;
    let base = target.pos;
    this.dispatchDoc((tr) => {
      base = insertionPoint(tr, target);
      tr.insert(base, inserted);
    });
    this.enterTextMode(base + textDepth, streaming);
  }

  private enterTextMode(textPos: number, streaming: boolean): void {
    const op = this.op!;
    op.pendingPlaceholder = false;
    op.breakList = false;
    op.wroteAnything = true;
    if (streaming) {
      op.mode = "text";
      op.textPos = textPos;
      op.lineStart = textPos;
      op.lineRaw = "";
    }
    this.maybeScroll();
  }

  private insertText(text: string): void {
    const op = this.op;
    if (!op || op.textPos == null || !text) return;
    const pos = op.textPos;
    this.dispatchDoc((tr) => tr.insertText(text, pos));
    op.textPos = pos + text.length;
    op.lineRaw += text;
    op.wroteAnything = true;
    this.maybeScroll();
  }

  /**
   * Line completed — re-parse `**bold**` spans and replace the raw text
   * with marked nodes in one transaction (no flicker), then return to
   * prefix mode for the next line.
   */
  private finalizeLine(): void {
    const op = this.op;
    if (!op) return;
    if (
      op.lineStart != null &&
      op.textPos != null &&
      op.textPos > op.lineStart &&
      op.lineRaw.includes("**")
    ) {
      const from = op.lineStart;
      const to = op.textPos;
      const pmNodes = this.inlineToPm(parseInlineMarkdown(op.lineRaw));
      this.dispatchDoc((tr) => tr.replaceWith(from, to, Fragment.from(pmNodes)));
    }
    op.mode = "prefix";
    op.textPos = null;
    op.lineStart = null;
    op.lineRaw = "";
  }

  // ── Editor plumbing ──────────────────────────────────────────────────────

  private sectionBlocks(sectionId: string): Array<{ node: PmNode; pos: number }> {
    const out: Array<{ node: PmNode; pos: number }> = [];
    this.editor.state.doc.forEach((node, offset) => {
      if (node.attrs?.sectionId === sectionId) out.push({ node, pos: offset });
    });
    return out;
  }

  private inlineToPm(inline: NoteInlineJson[]): PmNode[] {
    const { schema } = this.editor;
    return inline
      .filter((t) => t.text.length > 0)
      .map((t) =>
        schema.text(
          t.text,
          (t.marks ?? []).flatMap((m) =>
            schema.marks[m.type] ? [schema.marks[m.type].create()] : []
          )
        )
      );
  }

  private dispatchDoc(mutate: (tr: Transaction) => void): void {
    if (this.editor.isDestroyed) return;
    const { state, view } = this.editor;
    const tr = state.tr;
    mutate(tr);
    tr.setMeta(AI_APPEND_META, true);
    tr.setMeta(WRITER_TX, true);
    tr.setMeta("addToHistory", false);
    view.dispatch(tr);
  }

  private dispatchDeco(meta: RevisionDecoMeta): void {
    if (this.editor.isDestroyed) return;
    const { state, view } = this.editor;
    const tr = state.tr;
    tr.setMeta(REVISION_DECO_META, meta);
    tr.setMeta(WRITER_TX, true);
    tr.setMeta(AI_APPEND_META, true);
    view.dispatch(tr);
  }

  /** Remap live anchors through transactions we did not produce. */
  private onExternalTransaction = ({
    transaction,
  }: {
    transaction: Transaction;
  }): void => {
    const op = this.op;
    if (!op || transaction.getMeta(WRITER_TX) || !transaction.docChanged) return;
    if (op.textPos != null) {
      op.textPos = transaction.mapping.map(op.textPos, -1);
    }
    if (op.lineStart != null) {
      op.lineStart = transaction.mapping.map(op.lineStart, -1);
    }
  };

  /** Follow new content only when the reader opted in (pinned to bottom). */
  private maybeScroll(): void {
    if (this.opts.shouldFollowContent && !this.opts.shouldFollowContent()) {
      return;
    }
    const el = this.opts.getScrollElement?.();
    if (!el || this.scrollPending) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (!nearBottom) return;
    this.scrollPending = true;
    requestAnimationFrame(() => {
      this.scrollPending = false;
      el.scrollTop = el.scrollHeight;
    });
  }
}
