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
import { trailingEmptyParagraphRange } from "@/lib/notes/empty-paragraph";
import {
  classifyNoteLine,
  isGfmTableLine,
  KEY_TERM_HIGHLIGHT_COLOR,
  markdownToNoteNodes,
  mightBecomeNotePrefix,
  noteNodesToMarkdown,
  parseInlineMarkdown,
  sanitizeIncompleteInlineMarkdown,
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
  const trail = trailingEmptyParagraphRange(tr.doc);
  if (trail && trail.to === target.pos) {
    tr.delete(trail.from, trail.to);
    return trail.from;
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
  /** Buffered GFM pipe-table lines until the table ends. */
  tableBuf: string[] | null;
  /** Revision placeholder paragraph awaiting the first real block. */
  pendingPlaceholder: boolean;
  /** Divider deferred until the append produces actual content. */
  pendingDivider: boolean;
  wroteAnything: boolean;
};

export type StreamedSection = {
  sectionId: string;
  markdown: string;
  studentEdited?: boolean;
};

export class StreamingNotesWriter {
  private op: ActiveOp | null = null;
  private scrollPending = false;
  private destroyed = false;
  private editor: Editor;
  /**
   * Snapshot of a section about to be revised. If the revision streams
   * nothing (or only an empty placeholder), we restore this so students
   * never lose a finished section to a truncated/failed revise.
   */
  private revisionBackup: {
    sectionId: string;
    nodes: NoteNodeJson[];
  } | null = null;
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
      const heading = this.editor.schema.nodes.heading?.create(
        { level: 2, provenance: "ai", sectionId: input.sectionId },
        this.inlineToPm(parseInlineMarkdown(input.heading.trim()))
      );
      if (heading) {
        // Replace the default empty doc paragraph (same as openStreamingBlock)
        // so we don't leave a leading blank the CSS used to hide.
        const target = this.blockInsertionPos();
        this.dispatchDoc((tr) => {
          const at = insertionPoint(tr, target);
          tr.insert(at, heading);
        });
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
    this.dispatchDoc((tr) => {
      const trail = trailingEmptyParagraphRange(tr.doc);
      const at = trail ? trail.from : pos;
      if (trail) tr.delete(trail.from, trail.to);
      tr.insert(at, hr);
    });
  }

  /**
   * Start a visible revision of an existing section: fade/strike the old
   * blocks (~350ms), snapshot + delete them, and point the stream at a
   * placeholder so the replacement types into the same spot. If the
   * revision streams nothing useful, `finishOp` restores the snapshot.
   * Returns false when the section doesn't exist. Student-edited sections
   * are skipped unless `evenIfStudentEdited` is set (chat-driven edits).
   */
  async beginRevision(
    sectionId: string,
    opts?: { evenIfStudentEdited?: boolean }
  ): Promise<boolean> {
    if (this.destroyed || this.editor.isDestroyed) return false;
    this.finishOp();

    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    if (
      !opts?.evenIfStudentEdited &&
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
    this.revisionBackup = {
      sectionId,
      nodes: fresh.map((b) => b.node.toJSON() as NoteNodeJson),
    };
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
      const raw = op.buf;
      op.buf = "";
      if (isGfmTableLine(raw) || op.tableBuf) {
        op.tableBuf = op.tableBuf ?? [];
        if (raw.trim().length > 0) op.tableBuf.push(raw);
        this.flushTableBuf();
      } else {
        const line = classifyNoteLine(raw);
        if (line.kind !== "blank") this.insertWholeLine(line);
      }
    } else if (op.buf.length > 0 && op.mode === "text") {
      this.insertText(op.buf);
      op.buf = "";
    }
    if (op.mode === "text") this.finalizeLine();
    this.flushTableBuf();

    if (op.kind === "revision") {
      // Empty / placeholder-only revision → restore the pre-revise snapshot
      // so a truncated or aborted revise never wipes a finished section.
      if (op.pendingPlaceholder || !op.wroteAnything) {
        this.restoreRevisionBackup(op.sectionId);
      } else if (this.revisionLooksLikeWipe(op.sectionId)) {
        this.mergeTruncatedRevision(op.sectionId);
      } else {
        this.revisionBackup = null;
        this.flashRevision(op.sectionId);
      }
    }
    this.op = null;
  }

  /** Put a failed/empty revision's prior content back into the document. */
  private restoreRevisionBackup(sectionId: string): void {
    const backup = this.revisionBackup;
    this.revisionBackup = null;
    if (this.destroyed || this.editor.isDestroyed) return;

    const current = this.sectionBlocks(sectionId);
    const insertPos =
      current.length > 0 ? current[0]!.pos : this.editor.state.doc.content.size;

    this.dispatchDoc((tr) => {
      for (let i = current.length - 1; i >= 0; i--) {
        tr.delete(current[i]!.pos, current[i]!.pos + current[i]!.node.nodeSize);
      }
      if (backup && backup.sectionId === sectionId && backup.nodes.length > 0) {
        const nodes = backup.nodes
          .map((json) => {
            try {
              return this.editor.schema.nodeFromJSON(json);
            } catch {
              return null;
            }
          })
          .filter((n): n is PmNode => Boolean(n));
        if (nodes.length > 0) {
          tr.insert(
            Math.min(insertPos, tr.doc.content.size),
            Fragment.from(nodes)
          );
        }
      }
      tr.setMeta(REVISION_DECO_META, {
        clear: [sectionId],
      } as RevisionDecoMeta);
    });
  }

  /**
   * Haiku often "corrects" a section by replacing a long draft with only the
   * newest slice. Treat a much-shorter rewrite as a wipe, not a real revision.
   */
  private revisionLooksLikeWipe(sectionId: string): boolean {
    const backup = this.revisionBackup;
    if (!backup || backup.sectionId !== sectionId) return false;
    const previous = noteNodesToMarkdown(backup.nodes).trim();
    if (previous.length < 180) return false;
    const next = noteNodesToMarkdown(
      this.sectionBlocks(sectionId).map((b) => b.node.toJSON() as NoteNodeJson)
    ).trim();
    return next.length < previous.length * 0.6;
  }

  /** Restore the pre-revise section, then append the short rewrite as extra detail. */
  private mergeTruncatedRevision(sectionId: string): void {
    const backup = this.revisionBackup;
    if (!backup || backup.sectionId !== sectionId) {
      this.revisionBackup = null;
      return;
    }
    const incoming = this.sectionBlocks(sectionId).map(
      (b) => b.node.toJSON() as NoteNodeJson
    );
    const previousMd = noteNodesToMarkdown(backup.nodes);
    const extraBody = noteNodesToMarkdown(incoming)
      .trim()
      .replace(/^#{1,3}\s.+\n?/, "")
      .trim();
    const alreadyPresent =
      extraBody.length > 0 &&
      previousMd.includes(extraBody.slice(0, Math.min(80, extraBody.length)));

    this.restoreRevisionBackup(sectionId);
    this.flashRevision(sectionId);

    if (alreadyPresent || extraBody.length === 0) return;

    const extraNodes = incoming
      .filter((n) => n.type !== "heading")
      .map((json) => {
        try {
          return this.editor.schema.nodeFromJSON(json);
        } catch {
          return null;
        }
      })
      .filter((n): n is PmNode => Boolean(n));
    if (extraNodes.length === 0) return;

    const blocks = this.sectionBlocks(sectionId);
    const last = blocks[blocks.length - 1];
    const insertPos = last
      ? last.pos + last.node.nodeSize
      : this.editor.state.doc.content.size;
    this.dispatchDoc((tr) => {
      tr.insert(
        Math.min(insertPos, tr.doc.content.size),
        Fragment.from(extraNodes)
      );
    });
  }

  private flashRevision(sectionId: string): void {
    this.dispatchDeco({ set: { [sectionId]: "rose-note-revised" } });
    window.setTimeout(() => {
      if (!this.destroyed && !this.editor.isDestroyed) {
        this.dispatchDeco({ clear: [sectionId] });
      }
    }, REVISION_HIGHLIGHT_MS);
  }

  /**
   * Abort the active op. Revisions restore their pre-revise snapshot.
   * Mentored chunk appends that only got a pre-set heading (no body) are
   * removed so a failed/empty stream never leaves an orphan H2.
   */
  abortOp(): void {
    const op = this.op;
    if (!op) {
      if (this.revisionBackup) {
        this.restoreRevisionBackup(this.revisionBackup.sectionId);
      }
      return;
    }
    if (op.kind === "revision") {
      this.op = null;
      this.restoreRevisionBackup(op.sectionId);
      return;
    }

    const sectionId = op.sectionId;
    this.op = null;
    if (!sectionId.startsWith("chunk:")) return;

    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return;
    const hasBody = blocks.some((b) => {
      if (b.node.type.name === "heading") return false;
      if (b.node.type.name === "paragraph" && b.node.content.size === 0) {
        return false;
      }
      return b.node.textContent.trim().length > 0;
    });
    if (hasBody) return;
    if (
      blocks.some(
        (b) =>
          b.node.attrs?.provenance !== "ai" &&
          b.node.attrs?.provenance !== "ai-context"
      )
    ) {
      return;
    }
    this.dispatchDoc((tr) => {
      for (let i = blocks.length - 1; i >= 0; i--) {
        tr.delete(blocks[i]!.pos, blocks[i]!.pos + blocks[i]!.node.nodeSize);
      }
    });
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

  /**
   * All sections with an id (including student-edited). Chat uses this so
   * "fix the wording" still has a target after the student has typed in a
   * section. Oldest first.
   */
  listAllSections(limit: number): StreamedSection[] {
    if (this.editor.isDestroyed) return [];
    const order: string[] = [];
    const groups = new Map<string, NoteNodeJson[]>();
    const studentEdited = new Set<string>();
    this.editor.state.doc.forEach((node) => {
      const sid = node.attrs?.sectionId;
      if (typeof sid !== "string" || !sid) return;
      const prov = node.attrs?.provenance;
      if (prov !== "ai" && prov !== "ai-context") studentEdited.add(sid);
      if (!groups.has(sid)) {
        groups.set(sid, []);
        order.push(sid);
      }
      groups.get(sid)!.push(node.toJSON() as NoteNodeJson);
    });
    const active = this.op?.sectionId;
    return order
      .filter((id) => id !== active)
      .slice(-limit)
      .map((id) => ({
        sectionId: id,
        markdown: noteNodesToMarkdown(groups.get(id)!),
        studentEdited: studentEdited.has(id),
      }))
      .filter((s) => s.markdown.trim().length > 0);
  }

  /**
   * Section id under the current selection (or caret). Used so chat "this"
   * lands on the section the student is looking at, not always the last one.
   */
  sectionIdAtSelection(): string | null {
    if (this.editor.isDestroyed) return null;
    const { $from, $to } = this.editor.state.selection;
    const fromId = this.sectionIdAtResolved($from);
    if (fromId) return fromId;
    return this.sectionIdAtResolved($to);
  }

  private sectionIdAtResolved($pos: {
    depth: number;
    node: (depth: number) => { attrs?: Record<string, unknown> };
  }): string | null {
    for (let d = $pos.depth; d > 0; d--) {
      const sid = $pos.node(d).attrs?.sectionId;
      if (typeof sid === "string" && sid) return sid;
    }
    return null;
  }

  private pmNodesFromMarkdown(
    markdown: string,
    sectionId: string
  ): PmNode[] {
    const nodes = markdownToNoteNodes(markdown, {
      sectionId,
      provenance: "ai",
    });
    const out: PmNode[] = [];
    for (const json of nodes) {
      try {
        out.push(this.editor.schema.nodeFromJSON(json));
      } catch {
        /* skip malformed node */
      }
    }
    return out;
  }

  /**
   * Instantly replace a section with markdown (chat edits). Avoids the
   * streaming placeholder path, which rolled back empty/truncated revises.
   */
  replaceSectionMarkdown(
    sectionId: string,
    markdown: string,
    opts?: { evenIfStudentEdited?: boolean }
  ): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    const body = markdown.trim();
    if (!body) return false;
    this.finishOp();
    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    if (
      !opts?.evenIfStudentEdited &&
      blocks.some(
        (b) =>
          b.node.attrs?.provenance !== "ai" &&
          b.node.attrs?.provenance !== "ai-context"
      )
    ) {
      return false;
    }
    const pmNodes = this.pmNodesFromMarkdown(body, sectionId);
    if (pmNodes.length === 0) return false;
    const firstPos = blocks[0]!.pos;
    this.dispatchDoc((tr) => {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!;
        tr.delete(b.pos, b.pos + b.node.nodeSize);
      }
      tr.insert(Math.min(firstPos, tr.doc.content.size), Fragment.from(pmNodes));
    });
    this.dispatchDeco({ set: { [sectionId]: "rose-note-revised" } });
    window.setTimeout(() => {
      if (!this.destroyed && !this.editor.isDestroyed) {
        this.dispatchDeco({ clear: [sectionId] });
      }
    }, REVISION_HIGHLIGHT_MS);
    return true;
  }

  /**
   * Insert extra markdown at the end of an existing AI section (no new
   * heading). Used when live speech belongs in a slide-drafted section
   * instead of a duplicate at the bottom of the notes.
   */
  extendSection(
    sectionId: string,
    markdown: string,
    opts?: { evenIfStudentEdited?: boolean }
  ): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    const body = markdown.trim().replace(/^#{1,3}\s.+\n?/, "").trim();
    if (!body) return false;
    this.finishOp();
    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    if (
      !opts?.evenIfStudentEdited &&
      blocks.some(
        (b) =>
          b.node.attrs?.provenance !== "ai" &&
          b.node.attrs?.provenance !== "ai-context"
      )
    ) {
      return false;
    }
    const pmNodes = this.pmNodesFromMarkdown(body, sectionId).filter(
      (n) => n.type.name !== "heading"
    );
    if (pmNodes.length === 0) return false;
    const last = blocks[blocks.length - 1]!;
    const insertPos = last.pos + last.node.nodeSize;
    this.dispatchDoc((tr) => {
      tr.insert(
        Math.min(insertPos, tr.doc.content.size),
        Fragment.from(pmNodes)
      );
    });
    this.dispatchDeco({ set: { [sectionId]: "rose-note-revised" } });
    window.setTimeout(() => {
      if (!this.destroyed && !this.editor.isDestroyed) {
        this.dispatchDeco({ clear: [sectionId] });
      }
    }, REVISION_HIGHLIGHT_MS);
    return true;
  }

  /**
   * Instantly append a new markdown section (chat @@append).
   */
  appendMarkdown(
    sectionId: string,
    markdown: string,
    opts?: { dividerBefore?: boolean }
  ): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    const body = markdown.trim();
    if (!body) return false;
    this.finishOp();
    const pmNodes = this.pmNodesFromMarkdown(body, sectionId);
    if (pmNodes.length === 0) return false;
    this.dispatchDoc((tr) => {
      const trail = trailingEmptyParagraphRange(tr.doc);
      let pos = tr.doc.content.size;
      if (trail) {
        tr.delete(trail.from, trail.to);
        pos = trail.from;
      }
      if (opts?.dividerBefore) {
        const hr = this.editor.schema.nodes.horizontalRule?.create({
          provenance: "ai",
        });
        if (hr) {
          tr.insert(pos, hr);
          pos += hr.nodeSize;
        }
      }
      tr.insert(pos, Fragment.from(pmNodes));
    });
    return true;
  }

  /**
   * Remove a section. Student-edited blocks are skipped unless `force`.
   */
  deleteSection(
    sectionId: string,
    opts?: { evenIfStudentEdited?: boolean }
  ): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    if (this.op?.sectionId === sectionId) this.finishOp();
    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    if (
      !opts?.evenIfStudentEdited &&
      blocks.some(
        (b) =>
          b.node.attrs?.provenance !== "ai" &&
          b.node.attrs?.provenance !== "ai-context"
      )
    ) {
      return false;
    }
    this.dispatchDoc((tr) => {
      for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i]!;
        tr.delete(b.pos, b.pos + b.node.nodeSize);
      }
    });
    return true;
  }

  /**
   * Apply a highlight mark across every text node in an AI section.
   * Only used when the student asks chat to highlight — never as a default.
   */
  highlightSection(sectionId: string, color = KEY_TERM_HIGHLIGHT_COLOR): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    const markType = this.editor.schema.marks.highlight;
    if (!markType) return false;
    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    let marked = false;
    this.dispatchDoc((tr) => {
      for (const b of blocks) {
        const from = b.pos + 1;
        const to = b.pos + b.node.nodeSize - 1;
        if (to <= from) continue;
        tr.addMark(from, to, markType.create({ color }));
        marked = true;
      }
    });
    if (marked) {
      this.dispatchDeco({ set: { [sectionId]: "rose-note-revised" } });
      window.setTimeout(() => {
        if (!this.destroyed && !this.editor.isDestroyed) {
          this.dispatchDeco({ clear: [sectionId] });
        }
      }, REVISION_HIGHLIGHT_MS);
    }
    return marked;
  }

  /**
   * Strip highlight marks from a section. If the student has a selection
   * inside that section, only that range is cleared.
   */
  unhighlightSection(
    sectionId: string,
    opts?: { preferSelection?: boolean }
  ): boolean {
    if (this.destroyed || this.editor.isDestroyed || !sectionId) return false;
    const markType = this.editor.schema.marks.highlight;
    if (!markType) return false;
    const blocks = this.sectionBlocks(sectionId);
    if (blocks.length === 0) return false;
    const sel = this.editor.state.selection;
    const useSel = Boolean(opts?.preferSelection) && sel.from !== sel.to;
    let cleared = false;
    this.dispatchDoc((tr) => {
      for (const b of blocks) {
        const from = b.pos + 1;
        const to = b.pos + b.node.nodeSize - 1;
        if (to <= from) continue;
        let a = from;
        let c = to;
        if (useSel) {
          a = Math.max(from, sel.from);
          c = Math.min(to, sel.to);
          if (c <= a) continue;
        }
        tr.removeMark(a, c, markType);
        cleared = true;
      }
    });
    if (cleared) {
      this.dispatchDeco({ set: { [sectionId]: "rose-note-revised" } });
      window.setTimeout(() => {
        if (!this.destroyed && !this.editor.isDestroyed) {
          this.dispatchDeco({ clear: [sectionId] });
        }
      }, REVISION_HIGHLIGHT_MS);
    }
    return cleared;
  }

  /** Strip every highlight mark in the document. */
  unhighlightAll(): boolean {
    if (this.destroyed || this.editor.isDestroyed) return false;
    const markType = this.editor.schema.marks.highlight;
    if (!markType) return false;
    const from = 0;
    const to = this.editor.state.doc.content.size;
    if (to <= from) return false;
    let cleared = false;
    this.dispatchDoc((tr) => {
      tr.removeMark(from, to, markType);
      cleared = true;
    });
    return cleared;
  }

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
      tableBuf: null,
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
          const rawLine = op.buf.slice(0, nl);
          op.buf = op.buf.slice(nl + 1);

          if (op.tableBuf) {
            if (isGfmTableLine(rawLine)) {
              op.tableBuf.push(rawLine);
              continue;
            }
            this.flushTableBuf();
            // Fall through to handle the non-table line below.
          }

          if (isGfmTableLine(rawLine)) {
            op.tableBuf = [rawLine];
            continue;
          }

          const line = classifyNoteLine(rawLine);
          if (line.kind === "blank") {
            op.breakList = true;
            continue;
          }
          this.insertWholeLine(line);
          continue;
        }
        // Hold pipe-started lines and undecided prefixes until a newline.
        if (op.buf.trimStart().startsWith("|") || mightBecomeNotePrefix(op.buf)) {
          return;
        }
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

  /** Insert a buffered GFM pipe table as a single TipTap table node. */
  private flushTableBuf(): void {
    const op = this.op;
    if (!op?.tableBuf?.length) {
      if (op) op.tableBuf = null;
      return;
    }
    const md = op.tableBuf.join("\n");
    op.tableBuf = null;
    const nodes = markdownToNoteNodes(md, {
      sectionId: op.sectionId,
      provenance: "ai",
    }).filter((n) => n.type === "table");
    if (nodes.length === 0) return;

    this.flushPendingDivider();
    for (const json of nodes) {
      let pm: PmNode | null = null;
      try {
        pm = this.editor.schema.nodeFromJSON(json);
      } catch {
        pm = null;
      }
      if (!pm) continue;
      const target = this.blockInsertionPos();
      let base = target.pos;
      this.dispatchDoc((tr) => {
        base = insertionPoint(tr, target);
        tr.insert(base, pm!);
      });
      op.wroteAnything = true;
      op.pendingPlaceholder = false;
    }
    op.breakList = true;
    op.mode = "prefix";
    op.textPos = null;
    op.lineStart = null;
    op.lineRaw = "";
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
    const inline = parseInlineMarkdown(
      sanitizeIncompleteInlineMarkdown(line.text.trim())
    );
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
      const trail = trailingEmptyParagraphRange(this.editor.state.doc);
      const pos = this.editor.state.doc.content.size;
      if (trail) {
        return { pos, deletePlaceholder: trail };
      }
      return { pos, deletePlaceholder: null };
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
   * Line completed — sanitize truncated emphasis markers, re-parse
   * `**bold**` / `*italic*` spans, and replace the raw text with marked
   * nodes in one transaction (no flicker), then return to prefix mode.
   */
  private finalizeLine(): void {
    const op = this.op;
    if (!op) return;
    if (
      op.lineStart != null &&
      op.textPos != null &&
      op.textPos > op.lineStart &&
      op.lineRaw.includes("*")
    ) {
      const from = op.lineStart;
      const to = op.textPos;
      const cleaned = sanitizeIncompleteInlineMarkdown(op.lineRaw);
      const pmNodes = this.inlineToPm(parseInlineMarkdown(cleaned));
      this.dispatchDoc((tr) => {
        if (pmNodes.length === 0) {
          tr.delete(from, to);
        } else {
          tr.replaceWith(from, to, Fragment.from(pmNodes));
        }
      });
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
          (t.marks ?? []).flatMap((m) => {
            const markType = schema.marks[m.type];
            if (!markType) return [];
            return [markType.create(m.attrs ?? undefined)];
          })
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
