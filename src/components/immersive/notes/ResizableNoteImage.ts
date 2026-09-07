"use client";

import Image from "@tiptap/extension-image";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

const MIN_WIDTH = 64;
const HANDLES = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const ALIGNMENTS = ["left", "center", "right"] as const;

type ImageAlignment = (typeof ALIGNMENTS)[number];

function editorMaxWidth(editor: Editor): number {
  const el = editor.view.dom as HTMLElement;
  return Math.max(MIN_WIDTH, el.clientWidth - 8);
}

function imageAlignment(value: unknown): ImageAlignment {
  return ALIGNMENTS.includes(value as ImageAlignment)
    ? (value as ImageAlignment)
    : "left";
}

function applyAlignment(container: HTMLDivElement, value: unknown) {
  container.dataset.align = imageAlignment(value);
}

function applyImgSize(img: HTMLImageElement, node: ProseMirrorNode, maxWidth: number) {
  const raw = node.attrs.width;
  const width =
    typeof raw === "number" && raw > 0
      ? Math.min(maxWidth, Math.max(MIN_WIDTH, raw))
      : null;
  img.style.width = width ? `${width}px` : "";
  img.style.height = "auto";
}

function createHandle(direction: (typeof HANDLES)[number]): HTMLDivElement {
  const handle = document.createElement("div");
  handle.dataset.resizeHandle = direction;
  handle.contentEditable = "false";
  handle.setAttribute("aria-hidden", "true");
  return handle;
}

function createMoveHandle(): HTMLDivElement {
  const handle = document.createElement("div");
  handle.dataset.dragHandle = "";
  handle.dataset.imageMoveHandle = "";
  handle.contentEditable = "false";
  handle.draggable = true;
  handle.setAttribute("role", "button");
  handle.setAttribute("aria-label", "Move image");
  handle.setAttribute("title", "Drag to move image");
  handle.textContent = "⠿";
  return handle;
}

/**
 * Notes image with corner-drag resize. Width is stored on the node and
 * restored when the doc loads; height stays auto so screenshots don't squash.
 */
export const ResizableNoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      align: {
        default: "left",
        parseHTML: (element) => imageAlignment(element.dataset.align),
        renderHTML: (attributes) => ({
          "data-align": imageAlignment(attributes.align),
        }),
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const container = document.createElement("div");
      container.dataset.resizeContainer = "";
      container.dataset.node = "image";
      container.contentEditable = "false";
      container.draggable = true;
      applyAlignment(container, node.attrs.align);

      const wrapper = document.createElement("div");
      wrapper.dataset.resizeWrapper = "";

      const img = document.createElement("img");
      img.className = "tn-img";
      img.draggable = true;
      img.alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
      img.src = typeof node.attrs.src === "string" ? node.attrs.src : "";
      applyImgSize(img, node, editorMaxWidth(editor));

      wrapper.appendChild(img);
      if (editor.isEditable) {
        wrapper.appendChild(createMoveHandle());
        for (const direction of HANDLES) {
          wrapper.appendChild(createHandle(direction));
        }
      }
      container.appendChild(wrapper);

      let dragging: {
        startX: number;
        startWidth: number;
        fromLeft: boolean;
      } | null = null;

      const onMove = (event: MouseEvent | Touch) => {
        if (!dragging) return;
        const max = editorMaxWidth(editor);
        const delta = dragging.fromLeft
          ? dragging.startX - event.clientX
          : event.clientX - dragging.startX;
        const next = Math.round(
          Math.min(max, Math.max(MIN_WIDTH, dragging.startWidth + delta))
        );
        img.style.width = `${next}px`;
        img.style.height = "auto";
        container.dataset.resizeState = "true";
      };

      const onMouseMove = (event: MouseEvent) => onMove(event);
      const onTouchMove = (event: TouchEvent) => {
        const t = event.touches[0];
        if (t) onMove(t);
      };

      const commit = () => {
        if (!dragging) return;
        const width = Math.round(img.getBoundingClientRect().width);
        dragging = null;
        container.dataset.resizeState = "false";
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", commit);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", commit);
        const pos = getPos();
        if (typeof pos !== "number" || editor.isDestroyed) return;
        editor
          .chain()
          .setNodeSelection(pos)
          .updateAttributes("image", { width, height: null })
          .run();
      };

      const startDrag = (event: MouseEvent | TouchEvent, direction: string) => {
        if (!editor.isEditable) return;
        event.preventDefault();
        event.stopPropagation();
        const point = "touches" in event ? event.touches[0] : event;
        if (!point) return;
        dragging = {
          startX: point.clientX,
          startWidth: img.getBoundingClientRect().width,
          fromLeft: direction.includes("left"),
        };
        container.dataset.resizeState = "true";
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", commit);
        document.addEventListener("touchmove", onTouchMove, { passive: true });
        document.addEventListener("touchend", commit);
      };

      wrapper.addEventListener("dragstart", (event) => {
        if (!editor.isEditable) {
          event.preventDefault();
          return;
        }
        const pos = getPos();
        if (typeof pos !== "number" || editor.isDestroyed) return;
        editor.commands.setNodeSelection(pos);
      });

      wrapper.addEventListener("mousedown", (event) => {
        const handle = (event.target as HTMLElement | null)?.closest(
          "[data-resize-handle]"
        );
        if (!handle) return;
        startDrag(event, handle.getAttribute("data-resize-handle") ?? "");
      });
      wrapper.addEventListener(
        "touchstart",
        (event) => {
          const handle = (event.target as HTMLElement | null)?.closest(
            "[data-resize-handle]"
          );
          if (!handle) return;
          startDrag(event, handle.getAttribute("data-resize-handle") ?? "");
        },
        { passive: false }
      );

      return {
        dom: container,
        update(updated: ProseMirrorNode) {
          if (updated.type.name !== "image") return false;
          const src = typeof updated.attrs.src === "string" ? updated.attrs.src : "";
          if (img.getAttribute("src") !== src) img.src = src;
          img.alt = typeof updated.attrs.alt === "string" ? updated.attrs.alt : "";
          applyImgSize(img, updated, editorMaxWidth(editor));
          applyAlignment(container, updated.attrs.align);
          return true;
        },
        destroy() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", commit);
          document.removeEventListener("touchmove", onTouchMove);
          document.removeEventListener("touchend", commit);
        },
      };
    };
  },
});
