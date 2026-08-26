"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/react";

type EdgeHover = {
  cell: HTMLTableCellElement;
  kind: "row" | "col";
  insertAfter: boolean;
  x: number;
  y: number;
  canDelete: boolean;
};

type TableCorner = {
  cell: HTMLTableCellElement;
  x: number;
  y: number;
};

const EDGE_PX = 12;

function cellMeta(cell: HTMLTableCellElement) {
  const row = cell.parentElement as HTMLTableRowElement | null;
  const table = cell.closest("table");
  if (!row || !table) return null;
  const colCount = Math.max(
    ...Array.from(table.rows, (r) => r.cells.length),
    0
  );
  return {
    table,
    rowCount: table.rows.length,
    colCount,
  };
}

function runOnCell(
  editor: Editor,
  cell: HTMLTableCellElement,
  command:
    | "addRowAfter"
    | "addRowBefore"
    | "deleteRow"
    | "addColumnAfter"
    | "addColumnBefore"
    | "deleteColumn"
    | "deleteTable"
) {
  if (editor.isDestroyed || !editor.isEditable) return;
  try {
    const pos = editor.view.posAtDOM(cell, 0);
    const chain = editor.chain().focus().setTextSelection(pos);
    if (command === "addRowAfter") chain.addRowAfter().run();
    else if (command === "addRowBefore") chain.addRowBefore().run();
    else if (command === "deleteRow") chain.deleteRow().run();
    else if (command === "addColumnAfter") chain.addColumnAfter().run();
    else if (command === "addColumnBefore") chain.addColumnBefore().run();
    else if (command === "deleteTable") chain.deleteTable().run();
    else chain.deleteColumn().run();
  } catch {
    /* cell unmounted during hover */
  }
}

function EdgeBtn({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-5 min-w-5 items-center justify-center rounded-full border border-zinc-200 bg-white px-1 text-[11px] font-semibold leading-none text-zinc-600 shadow-sm hover:border-zinc-400 hover:text-zinc-900"
    >
      {label}
    </button>
  );
}

/**
 * Row/column add+delete on table borders (not the notes format toolbar).
 * Hover a horizontal edge to change rows; a vertical edge to change columns.
 */
export function NotesTableHoverControls({ editor }: { editor: Editor }) {
  const [hover, setHover] = useState<EdgeHover | null>(null);
  const [corner, setCorner] = useState<TableCorner | null>(null);
  const hoverRef = useRef<EdgeHover | null>(null);
  const cornerRef = useRef<TableCorner | null>(null);
  hoverRef.current = hover;
  cornerRef.current = corner;
  const overControls = useRef(false);

  useEffect(() => {
    const root = editor.view.dom;

    const clear = () => {
      if (overControls.current) return;
      setHover(null);
      setCorner(null);
    };

    const onMove = (e: MouseEvent) => {
      if (!editor.isEditable) {
        setHover(null);
        setCorner(null);
        return;
      }
      const target = e.target;
      if (!(target instanceof Element)) {
        setHover(null);
        setCorner(null);
        return;
      }
      const cell = target.closest("th, td") as HTMLTableCellElement | null;
      const table = cell?.closest("table");
      if (!cell || !table || !root.contains(table)) {
        if (!overControls.current) {
          setHover(null);
          setCorner(null);
        }
        return;
      }
      const meta = cellMeta(cell);
      if (!meta) {
        setHover(null);
        setCorner(null);
        return;
      }
      const rect = cell.getBoundingClientRect();
      const tableRect = meta.table.getBoundingClientRect();
      const { clientX: x, clientY: y } = e;
      setCorner({
        cell,
        x: tableRect.right,
        y: tableRect.top,
      });
      const distBottom = Math.abs(rect.bottom - y);
      const distTop = Math.abs(rect.top - y);
      const distRight = Math.abs(rect.right - x);
      const distLeft = Math.abs(rect.left - x);
      const minH = Math.min(distBottom, distTop);
      const minV = Math.min(distRight, distLeft);
      if (minH > EDGE_PX && minV > EDGE_PX) {
        setHover(null);
        return;
      }
      const clampX = Math.min(
        Math.max(x, tableRect.left + 20),
        tableRect.right - 20
      );
      const clampY = Math.min(
        Math.max(y, tableRect.top + 20),
        tableRect.bottom - 20
      );
      if (minH <= minV) {
        const insertAfter = distBottom <= distTop;
        setHover({
          cell,
          kind: "row",
          insertAfter,
          x: clampX,
          y: insertAfter ? rect.bottom : rect.top,
          canDelete: meta.rowCount > 1,
        });
      } else {
        const insertAfter = distRight <= distLeft;
        setHover({
          cell,
          kind: "col",
          insertAfter,
          x: insertAfter ? rect.right : rect.left,
          y: clampY,
          canDelete: meta.colCount > 1,
        });
      }
    };

    const onScroll = () => {
      setHover(null);
      setCorner(null);
    };

    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", clear);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", clear);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [editor]);

  if ((!hover && !corner) || typeof document === "undefined") return null;

  const addTitle =
    hover?.kind === "row"
      ? hover.insertAfter
        ? "Add row below"
        : "Add row above"
      : hover?.insertAfter
        ? "Add column to the right"
        : "Add column to the left";
  const delTitle = hover?.kind === "row" ? "Delete this row" : "Delete this column";

  return createPortal(
    <>
      {hover ? (
        <div
          className={`pointer-events-auto fixed z-[80] flex ${
            hover.kind === "row" ? "flex-row gap-0.5" : "flex-col gap-0.5"
          }`}
          style={{
            left: hover.x,
            top: hover.y,
            transform: "translate(-50%, -50%)",
          }}
          onMouseEnter={() => {
            overControls.current = true;
          }}
          onMouseLeave={() => {
            overControls.current = false;
            setHover(null);
          }}
        >
          <EdgeBtn
            label="+"
            title={addTitle}
            onClick={() => {
              const h = hoverRef.current;
              if (!h) return;
              if (h.kind === "row") {
                runOnCell(
                  editor,
                  h.cell,
                  h.insertAfter ? "addRowAfter" : "addRowBefore"
                );
              } else {
                runOnCell(
                  editor,
                  h.cell,
                  h.insertAfter ? "addColumnAfter" : "addColumnBefore"
                );
              }
              setHover(null);
            }}
          />
          {hover.canDelete ? (
            <EdgeBtn
              label="−"
              title={delTitle}
              onClick={() => {
                const h = hoverRef.current;
                if (!h) return;
                runOnCell(
                  editor,
                  h.cell,
                  h.kind === "row" ? "deleteRow" : "deleteColumn"
                );
                setHover(null);
              }}
            />
          ) : null}
        </div>
      ) : null}
      {corner ? (
        <div
          className="pointer-events-auto fixed z-[80]"
          style={{
            left: corner.x,
            top: corner.y,
            transform: "translate(40%, -50%)",
          }}
          onMouseEnter={() => {
            overControls.current = true;
          }}
          onMouseLeave={() => {
            overControls.current = false;
            setCorner(null);
          }}
        >
          <EdgeBtn
            label="×"
            title="Delete table"
            onClick={() => {
              const c = cornerRef.current;
              if (!c) return;
              runOnCell(editor, c.cell, "deleteTable");
              setHover(null);
              setCorner(null);
            }}
          />
        </div>
      ) : null}
    </>,
    document.body
  );
}
