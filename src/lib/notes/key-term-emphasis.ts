import { Extension, type Editor } from "@tiptap/core";
import { KEY_TERM_HIGHLIGHT_COLOR } from "@/lib/notes/notes-markdown";

export function toggleKeyTermEmphasis(editor: Editor): void {
  const chain = editor.chain().focus();
  if (editor.isActive("bold")) {
    chain.unsetBold().unsetHighlight().run();
    return;
  }
  chain.setBold().setHighlight({ color: KEY_TERM_HIGHLIGHT_COLOR }).run();
}

export function applyKeyTermHighlight(editor: Editor, color: string): void {
  editor.chain().focus().setHighlight({ color }).setBold().run();
}

export function clearKeyTermEmphasis(editor: Editor): void {
  editor.chain().focus().unsetHighlight().unsetBold().run();
}

/** Overrides StarterKit's Cmd+B so bold and highlight stay paired. */
export const KeyTermEmphasis = Extension.create({
  name: "keyTermEmphasis",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      "Mod-b": () => {
        toggleKeyTermEmphasis(this.editor);
        return true;
      },
    };
  },
});

