"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { confirmDialog } from "@/components/AppDialogs";
import { NotesDocGrid } from "@/components/notes-hub/NotesDocCard";
import type { NoteDocCardData, NoteHubRef, NoteHubSection } from "@/lib/notes/hub-types";

export function NotesHubClient({
  sections: initialSections,
  empty,
}: {
  sections: NoteHubSection[];
  empty: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [manageMode, setManageMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const allCards = useMemo(
    () => sections.flatMap((s) => s.cards),
    [sections]
  );

  const deletableCards = useMemo(
    () => allCards.filter((c) => c.deletable !== false && c.ref),
    [allCards]
  );

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedKeys(new Set(deletableCards.map((c) => c.key)));
  }, [deletableCards]);

  const clearSelection = useCallback(() => {
    setSelectedKeys(new Set());
  }, []);

  const exitManage = useCallback(() => {
    setManageMode(false);
    setSelectedKeys(new Set());
  }, []);

  const createNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as {
        noteId?: string;
      };
      if (data.noteId) {
        router.push(`/notes/doc/${data.noteId}`);
      }
    } finally {
      setCreating(false);
    }
  };

  const deleteSelected = async () => {
    if (busy || selectedKeys.size === 0) return;
    const ok = await confirmDialog({
      title: `Delete ${selectedKeys.size} note${selectedKeys.size === 1 ? "" : "s"}?`,
      body:
        "This cannot be undone. Tutor sessions and live lectures are removed entirely; course and lesson notes are cleared.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;

    const items: NoteHubRef[] = [];
    for (const key of selectedKeys) {
      const card = allCards.find((c) => c.key === key);
      if (card?.ref) items.push(card.ref);
    }
    if (items.length === 0) return;

    setBusy(true);
    try {
      const res = await fetch("/api/notes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", items }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        skippedLive?: number;
      };
      if (res.ok) {
        const removed = new Set(selectedKeys);
        setSections((prev) =>
          prev
            .map((s) => ({
              ...s,
              cards: s.cards.filter((c) => !removed.has(c.key)),
            }))
            .filter((s) => s.cards.length > 0)
        );
        exitManage();
        if ((data.skippedLive ?? 0) > 0) {
          void confirmDialog({
            title: "Some items were skipped",
            body:
              "Active live recordings cannot be deleted while still recording. End the session first.",
            confirmLabel: "OK",
          });
        }
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
        {manageMode ? (
          <>
            <button
              type="button"
              onClick={selectAll}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => void deleteSelected()}
              disabled={selectedKeys.size === 0 || busy}
              className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy
                ? "Deleting…"
                : `Delete${selectedKeys.size > 0 ? ` (${selectedKeys.size})` : ""}`}
            </button>
            <button
              type="button"
              onClick={exitManage}
              className="rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              Done
            </button>
          </>
        ) : (
          <>
            {!empty && deletableCards.length > 0 ? (
              <button
                type="button"
                onClick={() => setManageMode(true)}
                className="rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Select
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void createNote()}
              disabled={creating}
              className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
            >
              {creating ? "Creating…" : "+ New note"}
            </button>
          </>
        )}
      </div>

      {empty ? (
        <div className="mt-12 rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            No notes yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Start a blank note, or notes from live lectures, tutor sessions, and
            courses will show up here automatically.
          </p>
          <button
            type="button"
            onClick={() => void createNote()}
            disabled={creating}
            className="mt-6 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {creating ? "Creating…" : "Create your first note"}
          </button>
        </div>
      ) : (
        <div className="mt-8 space-y-12">
          {sections.map((section) => (
            <section key={section.id}>
              <header className="mb-4">
                <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                  {section.title}
                </h2>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
                  {section.hint}
                </p>
              </header>
              <NotesDocGrid
                cards={section.cards}
                manageMode={manageMode}
                selectedKeys={selectedKeys}
                onToggleSelect={toggleSelect}
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
