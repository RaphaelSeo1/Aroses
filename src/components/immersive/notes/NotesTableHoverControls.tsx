"use client";

import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";

type TableHud = {
  table: HTMLTableElement;
  cell: HTMLTableCellElement;
  left: number;
  top: number;
  width: number;
  height: number;
  rowCount: number;
  colCount: number;
};

const EDGE_PAD = 36;
const ROW_DRAG_STEP = 32;
const COL_DRAG_STEP = 80;
const MAX_DRAG_ADD = 12;

function lastCell(table: HTMLTableElement): HTMLTableCellElement | null {
  const row = table.rows[table.rows.length - 1];
  return row?.cells[row.cells.length - 1] ?? null;
}

function snapshot(table: HTMLTableElement): TableHud | null {
  const cell = lastCell(table);
  if (!cell) return null;
  const rect = table.getBoundingClientRect();
  return {
    table,
    cell,
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    rowCount: table.rows.length,
    colCount: Math.max(0, ...Array.from(table.rows, (r) => r.cells.length)),
  };
}

function runOnCell(
  editor: Editor,
  cell: HTMLTableCellElement,
  command: "addRowAfter" | "deleteRow" | "addColumnAfter" | "deleteColumn" | "deleteTable"
) {
  if (editor.isDestroyed || !editor.isEditable) return;
  try {
    const pos = editor.view.posAtDOM(cell, 0);
    const chain = editor.chain().focus().setTextSelection(pos);
    if (command === "addRowAfter") chain.addRowAfter().run();
    else if (command === "deleteRow") chain.deleteRow().run();
    else if (command === "addColumnAfter") chain.addColumnAfter().run();
    else if (command === "deleteTable") chain.deleteTable().run();
    else chain.deleteColumn().run();
  } catch {
    /* cell unmounted */
  }
}

function HandleBtn({
  label,
  title,
  onClick,
  onDragStart,
}: {
  label: string;
  title: string;
  onClick: () => void;
  onDragStart?: (e: ReactMouseEvent) => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDragStart?.(e);
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDragStart) return;
        onClick();
      }}
      className="flex h-6 min-w-6 items-center justify-center rounded-full border border-zinc-200 bg-white px-1.5 text-[12px] font-semibold leading-none text-zinc-600 shadow-sm hover:border-zinc-400 hover:text-zinc-900"
    >
      {label}
    </button>
  );
}

/**
 * Stationary add/delete handles on the table's outer edges.
 * Drag + downward/right to grow extra rows/columns. Cell borders stay
 * free so TipTap column-resize can run.
 */
export function NotesTableHoverControls({ editor }: { editor: Editor }) {
  const [hud, setHud] = useState<TableHud | null>(null);
  const hudRef = useRef<TableHud | null>(null);
  hudRef.current = hud;
  const overControls = useRef(false);
  const dragging = useRef(false);

  useEffect(() => {
    const root = editor.view.dom;

    const hide = () => {
      if (overControls.current || dragging.current) return;
      setHud(null);
    };

    const onMove = (e: MouseEvent) => {
      if (dragging.current) return;
      if (!editor.isEditable) {
        setHud(null);
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) {
        hide();
        return;
      }
      const table = target.closest("table");
      if (table && root.contains(table)) {
        const next = snapshot(table);
        if (next) setHud(next);
        return;
      }
      if (overControls.current) return;
      const current = hudRef.current;
      if (current) {
        const { left, top, width, height } = current;
        const insidePad =
          e.clientX >= left - EDGE_PAD &&
          e.clientX <= left + width + EDGE_PAD &&
          e.clientY >= top - EDGE_PAD &&
          e.clientY <= top + height + EDGE_PAD;
        if (insidePad) {
          const fresh = snapshot(current.table);
          if (fresh) setHud(fresh);
          return;
        }
      }
      setHud(null);
    };

    const onScroll = () => {
      const current = hudRef.current;
      if (!current || dragging.current) return;
      const fresh = snapshot(current.table);
      if (fresh) setHud(fresh);
      else setHud(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", hide);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", hide);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor]);

  const extendByDrag = (kind: "row" | "col", startEvent: ReactMouseEvent) => {
    dragging.current = true;
    let added = 0;
    let moved = false;
    const origin = kind === "row" ? startEvent.clientY : startEvent.clientX;

    const step = kind === "row" ? ROW_DRAG_STEP : COL_DRAG_STEP;
    const command = kind === "row" ? "addRowAfter" : "addColumnAfter";

    const onMove = (e: MouseEvent) => {
      const delta = (kind === "row" ? e.clientY : e.clientX) - origin;
      if (Math.abs(delta) > 6) moved = true;
      const want = Math.min(MAX_DRAG_ADD, Math.max(0, Math.floor(delta / step)));
      const table = hudRef.current?.table;
      if (!table) return;
      while (added < want) {
        const cell = lastCell(table);
        if (!cell) break;
        runOnCell(editor, cell, command);
        added += 1;
      }
      const fresh = snapshot(table);
      if (fresh) setHud(fresh);
    };

    const finish = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", finish);
      dragging.current = false;
      const table = hudRef.current?.table;
      if (!moved) {
        const cell = table ? lastCell(table) : hudRef.current?.cell;
        if (cell) runOnCell(editor, cell, command);
      }
      if (table) {
        const fresh = snapshot(table);
        if (fresh) setHud(fresh);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", finish);
  };

  if (!hud || typeof document === "undefined") return null;

  const cx = hud.left + hud.width / 2;
  const cy = hud.top + hud.height / 2;

  return createPortal(
    <>
      <div
        className="pointer-events-auto fixed z-[80] flex flex-row gap-0.5"
        style={{
          left: cx,
          top: hud.top + hud.height + 10,
          transform: "translate(-50%, 0)",
        }}
        onMouseEnter={() => {
          overControls.current = true;
        }}
        onMouseLeave={() => {
          overControls.current = false;
        }}
      >
        <HandleBtn
          label="+"
          title="Add row (drag down to add more)"
          onClick={() => {}}
          onDragStart={(e) => extendByDrag("row", e)}
        />
        {hud.rowCount > 1 ? (
          <HandleBtn
            label="−"
            title="Delete last row"
            onClick={() => {
              const cell = lastCell(hud.table);
              if (cell) runOnCell(editor, cell, "deleteRow");
              const fresh = snapshot(hud.table);
              if (fresh) setHud(fresh);
              else setHud(null);
            }}
          />
        ) : null}
      </div>
      <div
        className="pointer-events-auto fixed z-[80] flex flex-col gap-0.5"
        style={{
          left: hud.left + hud.width + 10,
          top: cy,
          transform: "translate(0, -50%)",
        }}
        onMouseEnter={() => {
          overControls.current = true;
        }}
        onMouseLeave={() => {
          overControls.current = false;
        }}
      >
        <HandleBtn
          label="+"
          title="Add column (drag right to add more)"
          onClick={() => {}}
          onDragStart={(e) => extendByDrag("col", e)}
        />
        {hud.colCount > 1 ? (
          <HandleBtn
            label="−"
            title="Delete last column"
            onClick={() => {
              const cell = lastCell(hud.table);
              if (cell) runOnCell(editor, cell, "deleteColumn");
              const fresh = snapshot(hud.table);
              if (fresh) setHud(fresh);
              else setHud(null);
            }}
          />
        ) : null}
      </div>
      <div
        className="pointer-events-auto fixed z-[80]"
        style={{
          left: hud.left + hud.width + 10,
          top: hud.top,
          transform: "translate(0, -50%)",
        }}
        onMouseEnter={() => {
          overControls.current = true;
        }}
        onMouseLeave={() => {
          overControls.current = false;
        }}
      >
        <HandleBtn
          label="×"
          title="Delete table"
          onClick={() => {
            const cell = lastCell(hud.table) ?? hud.cell;
            runOnCell(editor, cell, "deleteTable");
            setHud(null);
          }}
        />
      </div>
    </>,
    document.body
  );
}
