"use client";

import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { alertDialog, confirmDialog, promptDialog } from "@/components/AppDialogs";
import { NotesDocGrid } from "@/components/notes-hub/NotesDocCard";
import {
  NotesHubSidebar,
  SectionMoreMenu,
} from "@/components/notes-hub/NotesHubSidebar";
import { reorderSectionsByIds } from "@/lib/notes/hub-layout";
import { searchNoteCards } from "@/lib/notes/note-search";
import {
  customSectionId,
  dropSectionToMoveTarget,
  isCustomSection,
  NOTE_DRAG_PREFIX,
  parseCustomSectionId,
  parseNoteDragCardKey,
  resolveDropSectionId,
  resolveSectionSortTarget,
  sectionAcceptsNoteDrop,
  SECTION_DRAG_PREFIX,
  type NoteDocCardData,
  type NoteHubRef,
  type NoteHubSection,
} from "@/lib/notes/hub-types";
import Link from "next/link";

function defaultActiveSection(sections: NoteHubSection[]): string {
  return sections.find((s) => s.cards.length > 0)?.id ?? sections[0]?.id ?? "standalone";
}

function sectionIdForCreate(activeSectionId: string): string | null {
  const uuid = parseCustomSectionId(activeSectionId);
  return uuid ?? null;
}

function applyMoveToSections(
  sections: NoteHubSection[],
  movedKeys: Set<string>,
  targetSectionId: string | null
): NoteHubSection[] {
  const targetId =
    targetSectionId === null ? "standalone" : customSectionId(targetSectionId);
  const folderLabel =
    targetSectionId === null
      ? null
      : sections.find((s) => s.id === targetId)?.title ?? null;

  const moving: NoteHubSection["cards"] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const card of section.cards) {
      if (!movedKeys.has(card.key) || seen.has(card.key)) continue;
      moving.push(card);
      seen.add(card.key);
    }
  }

  return sections.map((section) => {
    // My notes is an all-notes view — keep moved cards there, but update
    // the folder subtitle so the move is visible.
    if (section.id === "standalone") {
      const byKey = new Map(section.cards.map((c) => [c.key, c]));
      for (const card of moving) {
        const keepCourseSub =
          card.chip?.label === "Course" ||
          card.subtitle === "Course build started";
        byKey.set(card.key, {
          ...card,
          folderSectionId: targetSectionId,
          subtitle: keepCourseSub ? card.subtitle : folderLabel,
        });
      }
      return { ...section, cards: Array.from(byKey.values()) };
    }

    if (isCustomSection(section)) {
      const remaining = section.cards.filter((c) => !movedKeys.has(c.key));
      if (section.id === targetId) {
        const labeled = moving.map((card) => {
          const keepCourseSub =
            card.chip?.label === "Course" ||
            card.subtitle === "Course build started";
          return {
            ...card,
            folderSectionId: targetSectionId,
            subtitle: keepCourseSub ? card.subtitle : null,
          };
        });
        return { ...section, cards: [...labeled, ...remaining] };
      }
      return { ...section, cards: remaining };
    }

    return section;
  });
}

export function NotesHubClient({
  sections: initialSections,
  empty,
}: {
  sections: NoteHubSection[];
  empty: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [activeSectionId, setActiveSectionId] = useState(() =>
    defaultActiveSection(initialSections)
  );
  const [creating, setCreating] = useState(false);
  const [addingSection, setAddingSection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dndMounted, setDndMounted] = useState(false);
  const [dragLabel, setDragLabel] = useState<string | null>(null);
  const [dragKind, setDragKind] = useState<"note" | "section" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const dndContextId = useId();

  useEffect(() => {
    setDndMounted(true);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeSectionId) ?? sections[0],
    [sections, activeSectionId]
  );

  const allCards = useMemo(() => {
    const seen = new Set<string>();
    const out: NoteHubSection["cards"] = [];
    for (const section of sections) {
      for (const card of section.cards) {
        if (seen.has(card.key)) continue;
        seen.add(card.key);
        out.push(card);
      }
    }
    return out;
  }, [sections]);

  const searchableItems = useMemo(() => {
    const byKey = new Map<
      string,
      { card: NoteHubSection["cards"][number]; sectionTitle: string }
    >();
    for (const section of sections) {
      for (const card of section.cards) {
        const existing = byKey.get(card.key);
        if (!existing || section.id !== "standalone") {
          byKey.set(card.key, { card, sectionTitle: section.title });
        }
      }
    }
    return Array.from(byKey.values());
  }, [sections]);

  const searchHits = useMemo(
    () => searchNoteCards(searchableItems, searchQuery),
    [searchableItems, searchQuery]
  );

  const isSearching = searchQuery.trim().length > 0;

  const moveTargets = useMemo(() => {
    const targets: { id: string | null; label: string }[] = [
      { id: null, label: "My notes" },
    ];
    for (const s of sections) {
      if (isCustomSection(s)) {
        targets.push({
          id: parseCustomSectionId(s.id),
          label: s.title,
        });
      }
    }
    return targets.filter((t): t is { id: string | null; label: string } =>
      t.id === null ? true : Boolean(t.id)
    );
  }, [sections]);





  const createNote = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const sectionId = sectionIdForCreate(activeSectionId);
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          sectionId ? { sectionId } : {}
        ),
      });
      const data = (await res.json().catch(() => ({}))) as {
        noteId?: string;
      };
      if (!data.noteId) return;
      // Open the Live Notes surface (transcript + editor) — not the old
      // NotesDocView page.
      const recordRes = await fetch(`/api/notes/${data.noteId}/record`, {
        method: "POST",
      });
      const recordData = (await recordRes.json().catch(() => ({}))) as {
        redirect?: string;
      };
      router.push(
        recordData.redirect || `/notes/doc/${data.noteId}`
      );
    } finally {
      setCreating(false);
    }
  };

  const persistHubLayout = useCallback(async (orderedIds: string[]) => {
    try {
      await fetch("/api/notes/hub-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderedIds }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const addSection = async () => {
    if (addingSection) return;
    const title = await promptDialog({
      title: "New section",
      label: "Section name",
      placeholder: "e.g. Midterm prep, Biology",
      defaultValue: "",
    });
    if (!title?.trim()) return;

    setAddingSection(true);
    try {
      const res = await fetch("/api/notes/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        section?: { id: string; title: string };
        error?: string;
      };
      if (!res.ok || !data.section) return;

      const newSection: NoteHubSection = {
        id: customSectionId(data.section.id),
        title: data.section.title,
        hint: "⋮ on a note in the sidebar → Move to.",
        cards: [],
        custom: true,
      };

      setSections((prev) => {
        const activeIdx = prev.findIndex((s) => s.id === activeSectionId);
        const insertAt = activeIdx >= 0 ? activeIdx + 1 : prev.length;
        const next = [
          ...prev.slice(0, insertAt),
          newSection,
          ...prev.slice(insertAt),
        ];
        void persistHubLayout(next.map((s) => s.id));
        return next;
      });
      setActiveSectionId(newSection.id);
    } finally {
      setAddingSection(false);
    }
  };

  const renameSection = async (section: NoteHubSection) => {
    const uuid = parseCustomSectionId(section.id);
    if (!uuid) return;

    const title = await promptDialog({
      title: "Rename section",
      label: "Section name",
      defaultValue: section.title,
    });
    if (!title?.trim() || title.trim() === section.title) return;

    const res = await fetch(`/api/notes/sections/${uuid}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim() }),
    });
    if (!res.ok) return;

    setSections((prev) =>
      prev.map((s) =>
        s.id === section.id ? { ...s, title: title.trim() } : s
      )
    );
  };

  const changeSectionEmoji = async (section: NoteHubSection, emoji: string) => {
    const next = emoji.trim().slice(0, 16);
    if (!next || next === section.emoji) return;
    const previous = section.emoji ?? null;

    setSections((prev) =>
      prev.map((s) => (s.id === section.id ? { ...s, emoji: next } : s))
    );

    const uuid = parseCustomSectionId(section.id);
    if (uuid) {
      const res = await fetch(`/api/notes/sections/${uuid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji: next }),
      });
      if (!res.ok) {
        setSections((prev) =>
          prev.map((s) =>
            s.id === section.id ? { ...s, emoji: previous } : s
          )
        );
        await alertDialog({
          title: "Couldn’t update emoji",
          body:
            "Apply migration 086_user_note_sections_emoji.sql in Supabase, then try again.",
        });
      }
      return;
    }

    const res = await fetch("/api/notes/hub-layout", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emojiUpdate: { id: section.id, emoji: next },
      }),
    });
    if (!res.ok) {
      setSections((prev) =>
        prev.map((s) =>
          s.id === section.id ? { ...s, emoji: previous } : s
        )
      );
      await alertDialog({
        title: "Couldn’t update emoji",
        body:
          "Apply migration 087_user_notes_hub_layout_emojis.sql in Supabase, then try again.",
      });
    }
  };

  const deleteSection = async (section: NoteHubSection) => {
    const uuid = parseCustomSectionId(section.id);
    if (!uuid) return;

    const ok = await confirmDialog({
      title: `Delete “${section.title}”?`,
      body:
        section.cards.length > 0
          ? "Notes in this section will move back to My notes. The notes themselves are not deleted."
          : "This empty section will be removed.",
      confirmLabel: "Delete section",
      tone: "danger",
    });
    if (!ok) return;

    const res = await fetch(`/api/notes/sections/${uuid}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      await alertDialog({
        title: "Could not delete section",
        body: "Make sure migration 082_user_note_sections.sql is applied in Supabase, then try again.",
      });
      return;
    }

    setSections((prev) => {
      const next = prev.filter((s) => s.id !== section.id);
      // My notes already lists every note — no need to re-add folder cards.
      void persistHubLayout(next.map((s) => s.id));
      if (activeSectionId === section.id) {
        setActiveSectionId("standalone");
      }
      return next;
    });
    router.refresh();
  };

  const moveCardsToSection = useCallback(
    async (cardKeys: string[], targetSectionId: string | null) => {
      if (cardKeys.length === 0) return;

      const cards = allCards.filter((c) => cardKeys.includes(c.key));
      const items: NoteHubRef[] = cards
        .map((c) => c.ref)
        .filter((r): r is NoteHubRef => Boolean(r));

      if (items.length === 0) return;

      setBusy(true);
      try {
        const res = await fetch("/api/notes/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "move",
            items,
            sectionId: targetSectionId,
          }),
        });
        if (res.ok) {
          const movedKeys = new Set(cardKeys);
          setSections((prev) =>
            applyMoveToSections(prev, movedKeys, targetSectionId)
          );
          if (targetSectionId) {
            setActiveSectionId(customSectionId(targetSectionId));
          } else {
            setActiveSectionId("standalone");
          }
          router.refresh();
        }
      } finally {
        setBusy(false);
      }
    },
    [allCards, router]
  );

  const moveSingleNote = useCallback(
    (card: NoteDocCardData, sectionId: string | null) => {
      void moveCardsToSection([card.key], sectionId);
    },
    [moveCardsToSection]
  );

  const moveNoteToNewSection = useCallback(
    async (card: NoteDocCardData) => {
      if (busy || !card.ref) return;
      const title = await promptDialog({
        title: "New section",
        label: "Section name",
        placeholder: "e.g. Midterm prep, Biology",
        defaultValue: "",
      });
      if (!title?.trim()) return;

      setBusy(true);
      try {
        const res = await fetch("/api/notes/sections", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: title.trim() }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          section?: { id: string; title: string };
        };
        if (!res.ok || !data.section) return;

        const newSection: NoteHubSection = {
          id: customSectionId(data.section.id),
          title: data.section.title,
          hint: "⋮ on a note in the sidebar → Move to.",
          cards: [],
          custom: true,
        };

        setSections((prev) => {
          const standaloneIdx = prev.findIndex((s) => s.id === "standalone");
          const insertAt = standaloneIdx >= 0 ? standaloneIdx + 1 : 0;
          const next = [...prev];
          next.splice(insertAt, 0, newSection);
          void persistHubLayout(next.map((s) => s.id));
          return next;
        });

        await moveCardsToSection([card.key], data.section.id);
      } finally {
        setBusy(false);
      }
    },
    [busy, moveCardsToSection, persistHubLayout]
  );

  const reorderSections = async (orderedIds: string[]) => {
    if (orderedIds.length < 2) return;

    const previous = sections;
    setSections(reorderSectionsByIds(sections, orderedIds));

    try {
      const res = await fetch("/api/notes/hub-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order: orderedIds }),
      });
      if (!res.ok) {
        setSections(previous);
        await alertDialog({
          title: "Could not reorder sections",
          body: "Apply migration 083_user_notes_hub_layout.sql in Supabase, then try again.",
        });
        return;
      }
      router.refresh();
    } catch {
      setSections(previous);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const activeType = event.active.data.current?.type as string | undefined;
    if (activeType === "note" || id.startsWith(NOTE_DRAG_PREFIX)) {
      setDragKind("note");
      const cardKey =
        (event.active.data.current?.cardKey as string | undefined) ??
        parseNoteDragCardKey(id);
      const card = cardKey
        ? allCards.find((c) => c.key === cardKey)
        : undefined;
      setDragLabel(card?.title ?? "Note");
      return;
    }
    if (activeType === "section" || id.startsWith(SECTION_DRAG_PREFIX)) {
      setDragKind("section");
      const sectionId = id.slice(SECTION_DRAG_PREFIX.length);
      const section = sections.find((s) => s.id === sectionId);
      setDragLabel(section?.title ?? "Section");
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDragLabel(null);
    setDragKind(null);
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const activeType = active.data.current?.type as string | undefined;

    if (activeType === "note" && activeId.startsWith(NOTE_DRAG_PREFIX)) {
      const cardKey =
        (active.data.current?.cardKey as string | undefined) ??
        parseNoteDragCardKey(activeId);
      if (!cardKey) return;

      const dropSectionId = resolveDropSectionId(overId);
      if (!dropSectionId || !sectionAcceptsNoteDrop(dropSectionId)) return;
      const target = dropSectionToMoveTarget(dropSectionId);
      if (target === undefined) return;

      // Home folder is the custom section that owns the note (not My notes).
      const homeSection = sections.find(
        (s) =>
          isCustomSection(s) && s.cards.some((c) => c.key === cardKey)
      );
      const currentTarget = homeSection
        ? parseCustomSectionId(homeSection.id)
        : null;
      if (currentTarget === target) return;

      void moveCardsToSection([cardKey], target);
      return;
    }

    if (activeType === "section" && activeId.startsWith(SECTION_DRAG_PREFIX)) {
      const activeSectionKey = activeId.slice(SECTION_DRAG_PREFIX.length);
      const overSectionKey = resolveSectionSortTarget(overId);
      if (!overSectionKey) return;

      const sectionIds = sections.map((s) => s.id);
      const oldIndex = sectionIds.indexOf(activeSectionKey);
      const newIndex = sectionIds.indexOf(overSectionKey);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
      void reorderSections(arrayMove(sectionIds, oldIndex, newIndex));
    }
  };

  const handleDragCancel = () => {
    setDragLabel(null);
    setDragKind(null);
  };

  const renameNote = async (card: NoteDocCardData) => {
    const ref = card.ref;
    if (!ref || ref.kind === "course") return;

    const title = await promptDialog({
      title: "Rename note",
      label: "Title",
      defaultValue: card.title,
    });
    if (!title?.trim() || title.trim() === card.title) return;
    const next = title.trim().slice(0, 200);

    let url: string | null = null;
    if (ref.kind === "standalone") url = `/api/notes/${ref.id}`;
    else if (ref.kind === "live") url = `/api/live-notes/${ref.id}`;
    else if (ref.kind === "tutor") url = `/api/tutor-session/${ref.id}`;
    if (!url) return;

    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    if (!res.ok) {
      await alertDialog({
        title: "Couldn’t rename",
        body: "Something went wrong. Try again.",
      });
      return;
    }

    setSections((prev) =>
      prev.map((s) => ({
        ...s,
        cards: s.cards.map((c) =>
          c.key === card.key ? { ...c, title: next } : c
        ),
      }))
    );
    router.refresh();
  };

  const deleteNote = async (card: NoteDocCardData) => {
    if (busy || !card.ref || card.deletable === false) return;
    const ok = await confirmDialog({
      title: `Delete “${card.title}”?`,
      body: "It will move to Recently deleted. You can restore it later, or delete it forever from there.",
      confirmLabel: "Move to Recently deleted",
      tone: "danger",
    });
    if (!ok) return;

    setBusy(true);
    try {
      const res = await fetch("/api/notes/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", items: [card.ref] }),
      });
      if (!res.ok) {
        await alertDialog({
          title: "Couldn’t delete",
          body: "Something went wrong. Try again.",
        });
        return;
      }
      const payload = (await res.json().catch(() => ({}))) as {
        permanent?: boolean;
      };
      setSections((prev) => {
        let next = prev.map((s) => ({
          ...s,
          cards: s.cards.filter((c) => c.key !== card.key),
        }));
        // Hard-delete fallback (migration missing) — don't show in trash.
        if (!payload.permanent) {
          const trashedCard: NoteDocCardData = {
            ...card,
            trashed: true,
            folderSectionId: null,
            subtitle: "In Recently deleted",
            chip: { label: "Deleted", tone: "failed" },
            dateLabel: new Date().toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            }),
          };
          next = next.map((s) =>
            s.id === "trash"
              ? { ...s, cards: [trashedCard, ...s.cards] }
              : s
          );
        }
        return next;
      });
      if (!payload.permanent) {
        setActiveSectionId("trash");
      } else {
        const stillHasActive = sections.some(
          (s) => s.id === activeSectionId && s.cards.some((c) => c.key !== card.key)
        );
        if (!stillHasActive) {
          setActiveSectionId(defaultActiveSection(sections));
        }
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const removeFromSection = useCallback(
    (card: NoteDocCardData) => {
      void moveCardsToSection([card.key], null);
    },
    [moveCardsToSection]
  );

  const restoreNote = useCallback(
    async (card: NoteDocCardData) => {
      if (busy || !card.ref) return;
      setBusy(true);
      try {
        const res = await fetch("/api/notes/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restore", items: [card.ref] }),
        });
        if (!res.ok) {
          await alertDialog({
            title: "Couldn’t restore",
            body: "Something went wrong. Try again.",
          });
          return;
        }
        const homeSectionId =
          card.ref.kind === "live"
            ? "live"
            : card.ref.kind === "tutor"
              ? "tutor"
              : card.ref.kind === "course"
                ? "course"
                : "standalone";
        setSections((prev) => {
          const restored: NoteDocCardData = {
            ...card,
            trashed: false,
            subtitle: null,
            chip: card.chip?.label === "Deleted" ? undefined : card.chip,
          };
          return prev.map((s) => {
            if (s.id === "trash") {
              return { ...s, cards: s.cards.filter((c) => c.key !== card.key) };
            }
            if (s.id === homeSectionId || s.id === "standalone") {
              const exists = s.cards.some((c) => c.key === card.key);
              return exists ? s : { ...s, cards: [restored, ...s.cards] };
            }
            return s;
          });
        });
        setActiveSectionId(homeSectionId);
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, router]
  );

  const purgeNote = useCallback(
    async (card: NoteDocCardData) => {
      if (busy || !card.ref) return;
      const ok = await confirmDialog({
        title: `Delete “${card.title}” forever?`,
        body: "This permanently removes the note. It cannot be restored.",
        confirmLabel: "Delete forever",
        tone: "danger",
      });
      if (!ok) return;
      setBusy(true);
      try {
        const res = await fetch("/api/notes/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "purge", items: [card.ref] }),
        });
        if (!res.ok) {
          await alertDialog({
            title: "Couldn’t delete",
            body: "Something went wrong. Try again.",
          });
          return;
        }
        setSections((prev) =>
          prev.map((s) => ({
            ...s,
            cards: s.cards.filter((c) => c.key !== card.key),
          }))
        );
        router.refresh();
      } finally {
        setBusy(false);
      }
    },
    [busy, router]
  );

  const canCreateInSection =
    activeSection?.id === "standalone" || isCustomSection(activeSection ?? { id: "" });

  const renderMainContent = (draggableNotes: boolean) => {
    if (empty) {
      return (
        <div className="rounded-3xl border border-zinc-200/90 bg-white/90 p-10 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-950/90">
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
      );
    }

    if (isSearching) {
      return (
        <section>
          <header className="mb-4">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              Search results
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
              {searchHits.length === 0
                ? `No notes match “${searchQuery.trim()}”`
                : `${searchHits.length} note${searchHits.length === 1 ? "" : "s"} matching “${searchQuery.trim()}”`}
            </p>
          </header>
          {searchHits.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Try another word, or clear search to browse by section.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200/90 bg-white shadow-sm dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-950">
              {searchHits.map((hit) => (
                <li key={hit.card.key}>
                  <Link
                    href={hit.card.href}
                    className="block px-4 py-3.5 transition hover:bg-zinc-50 dark:hover:bg-zinc-900/60"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        {hit.card.title}
                      </p>
                      <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
                        {hit.card.dateLabel}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                      {hit.sectionTitle}
                      {hit.card.subtitle ? ` · ${hit.card.subtitle}` : ""}
                    </p>
                    {hit.snippet ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                        {hit.snippet}
                      </p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      );
    }

    if (!activeSection) return null;

    return (
      <section>
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {activeSection.title}
            </h2>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
              {activeSection.hint}
            </p>
          </div>
          {isCustomSection(activeSection) ? (
            <SectionMoreMenu
              section={activeSection}
              onRename={() => void renameSection(activeSection)}
              onDelete={() => void deleteSection(activeSection)}
            />
          ) : null}
        </header>

        {activeSection.cards.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-200 bg-white/60 px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950/40">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Nothing in this section yet.
              {isCustomSection(activeSection)
                ? " Open the sidebar note ⋮ menu → Move to."
                : ""}
            </p>
            {canCreateInSection ? (
              <button
                type="button"
                onClick={() => void createNote()}
                disabled={creating}
                className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
              >
                {creating ? "Creating…" : "+ New note"}
              </button>
            ) : null}
          </div>
        ) : (
          <NotesDocGrid
            cards={activeSection.cards}
            draggableNotes={draggableNotes}
            onRenameNote={(c) => void renameNote(c)}
            onDeleteNote={(c) => void deleteNote(c)}
            onMoveNote={moveSingleNote}
            moveTargets={moveTargets}
            onMoveToNewSection={(c) => void moveNoteToNewSection(c)}
            onRemoveFromSection={removeFromSection}
            onRestoreNote={(c) => void restoreNote(c)}
            onPurgeNote={(c) => void purgeNote(c)}
          />
        )}
      </section>
    );
  };

  const toolbar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => void createNote()}
        disabled={creating}
        className="inline-flex shrink-0 items-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-60"
      >
        {creating ? "Creating…" : "+ New note"}
      </button>
    </div>
  );

  return (
    <div>
      {!empty ? (
        <div className="relative mt-6">
          <label htmlFor="notes-search" className="sr-only">
            Search notes
          </label>
          <span
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400"
            aria-hidden
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            id="notes-search"
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes…"
            className="w-full rounded-2xl border border-zinc-200/90 bg-white py-2.5 pl-10 pr-10 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-violet-300 focus:outline-none focus:ring-2 focus:ring-violet-200 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-violet-700 dark:focus:ring-violet-900/40"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              aria-label="Clear search"
            >
              ✕
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 md:hidden">{toolbar}</div>

      {dndMounted ? (
        <DndContext
          id={dndContextId}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <div className="mt-6 flex flex-col gap-6 md:mt-8 md:flex-row md:gap-8">
            <aside className="md:sticky md:top-20 md:self-start">
              <NotesHubSidebar
                sections={sections}
                activeSectionId={activeSectionId}
                onSectionSelect={setActiveSectionId}
                onAddSection={() => void addSection()}
                onRenameSection={(s) => void renameSection(s)}
                onDeleteSection={(s) => void deleteSection(s)}
                onChangeSectionEmoji={(s, emoji) =>
                  void changeSectionEmoji(s, emoji)
                }
                onRenameNote={(c) => void renameNote(c)}
                onDeleteNote={(c) => void deleteNote(c)}
                onMoveNote={moveSingleNote}
                moveTargets={moveTargets}
                onMoveToNewSection={(c) => void moveNoteToNewSection(c)}
                onRemoveFromSection={removeFromSection}
                onRestoreNote={(c) => void restoreNote(c)}
                onPurgeNote={(c) => void purgeNote(c)}
                addingSection={addingSection}
                draggableNotes
                dragKind={dragKind}
              />
            </aside>

            <div className="min-w-0 flex-1">
              <div className="mb-4 hidden md:block">{toolbar}</div>
              {renderMainContent(true)}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {dragLabel ? (
              <div className="rounded-lg bg-white px-3 py-2 text-xs font-medium shadow-lg ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-700">
                {dragLabel}
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        <div className="mt-6 flex flex-col gap-6 md:mt-8 md:flex-row md:gap-8">
          <aside className="md:sticky md:top-20 md:self-start">
            <NotesHubSidebar
              sections={sections}
              activeSectionId={activeSectionId}
              onSectionSelect={setActiveSectionId}
              onAddSection={() => void addSection()}
              onRenameSection={(s) => void renameSection(s)}
              onDeleteSection={(s) => void deleteSection(s)}
              onChangeSectionEmoji={(s, emoji) =>
                void changeSectionEmoji(s, emoji)
              }
              onRenameNote={(c) => void renameNote(c)}
              onDeleteNote={(c) => void deleteNote(c)}
              onMoveNote={moveSingleNote}
              moveTargets={moveTargets}
              onMoveToNewSection={(c) => void moveNoteToNewSection(c)}
              onRemoveFromSection={removeFromSection}
              onRestoreNote={(c) => void restoreNote(c)}
              onPurgeNote={(c) => void purgeNote(c)}
              addingSection={addingSection}
            />
          </aside>
          <div className="min-w-0 flex-1">
            <div className="mb-4 hidden md:block">{toolbar}</div>
            {renderMainContent(false)}
          </div>
        </div>
      )}
    </div>
  );
}
