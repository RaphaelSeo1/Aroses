"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { NotesPanelHandle } from "@/components/immersive/NotesPanel";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type NoteOp =
  | { kind: "delete"; sectionId: string }
  | { kind: "highlight"; sectionId: string; color: string }
  | { kind: "revise"; sectionId: string }
  | { kind: "append"; sectionId: string; dividerBefore: boolean }
  | { kind: "notes"; text: string };

const TYPE_CPS = 110;
const TYPE_TICK_MS = 24;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SUGGESTIONS = [
  "What did they just cover?",
  "Add more detail to the last section",
  "Highlight the key definition",
  "Delete the draft that looks wrong",
];

function storageKey(sessionId: string) {
  return `aroses.liveNotes.chat.${sessionId}`;
}

function loadTurns(sessionId: string): ChatTurn[] {
  try {
    const raw = sessionStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (t): t is ChatTurn =>
          !!t &&
          typeof t === "object" &&
          (t.role === "user" || t.role === "assistant") &&
          typeof t.content === "string" &&
          typeof t.id === "string"
      )
      .slice(-40);
  } catch {
    return [];
  }
}

export function LiveNotesChat({
  sessionId,
  lectureTitle,
  recentTranscript,
  screenContext,
  noteInstruction,
  notesRef,
  enqueueWriterJob,
  onActivity,
}: {
  sessionId: string;
  lectureTitle: string;
  recentTranscript: string;
  screenContext: string;
  noteInstruction: string;
  notesRef: RefObject<NotesPanelHandle | null>;
  enqueueWriterJob: (job: () => Promise<void>) => void;
  onActivity: (kind: "thought" | "status" | "error", message: string) => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTurns(sessionId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  useEffect(() => {
    try {
      sessionStorage.setItem(
        storageKey(sessionId),
        JSON.stringify(turnsRef.current.filter((t) => t.content.trim()).slice(-40))
      );
    } catch {
      /* ignore */
    }
  }, [sessionId, turns]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [turns, busy]);

  const applyNoteOps = useCallback(
    async (ops: NoteOp[]) => {
      const writer = notesRef.current?.getStreamWriter();
      if (!writer || ops.length === 0) return;

      const run = async () => {
        notesRef.current?.setStreamingIndicator(true);
        let opValid = false;
        for (const item of ops) {
          if (item.kind === "delete") {
            writer.finishOp();
            opValid = false;
            writer.deleteSection(item.sectionId);
          } else if (item.kind === "highlight") {
            writer.finishOp();
            opValid = false;
            writer.highlightSection(item.sectionId, item.color);
          } else if (item.kind === "revise") {
            writer.finishOp();
            opValid = await writer.beginRevision(item.sectionId);
          } else if (item.kind === "append") {
            writer.finishOp();
            writer.beginAppend({
              sectionId: item.sectionId,
              dividerBefore: item.dividerBefore,
            });
            opValid = true;
          } else if (item.kind === "notes" && opValid && item.text) {
            const step = Math.max(1, Math.round((TYPE_CPS * TYPE_TICK_MS) / 1000));
            for (let i = 0; i < item.text.length; i += step) {
              writer.write(item.text.slice(i, i + step));
              await sleep(TYPE_TICK_MS);
            }
          }
        }
        writer.finishOp();
        notesRef.current?.setStreamingIndicator(false);
      };

      enqueueWriterJob(run);
    },
    [enqueueWriterJob, notesRef]
  );

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setDraft("");
      setBusy(true);

      const userTurn: ChatTurn = {
        id: `u-${Date.now()}`,
        role: "user",
        content: message,
      };
      const assistantId = `a-${Date.now()}`;
      const history = turnsRef.current
        .filter((t) => t.content.trim())
        .slice(-12)
        .map((t) => ({ role: t.role, content: t.content }));

      setTurns((prev) => [
        ...prev,
        userTurn,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      const writer = notesRef.current?.getStreamWriter();
      const sections = writer?.listRevisableSections(40) ?? [];
      const selectedText = notesRef.current?.getSelectedText() ?? "";
      const hasNotes = Boolean(writer && sections.length > 0);

      const noteOps: NoteOp[] = [];
      let appendStarted = false;
      let noteOpCount = 0;

      try {
        const res = await fetch(`/api/live-notes/${sessionId}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            history,
            sections,
            transcript: recentTranscript || undefined,
            screenContext: screenContext || undefined,
            selectedText: selectedText || undefined,
            noteInstruction,
          }),
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("text/event-stream")) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || "Could not reach Rose.");
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error("Could not reach Rose.");
        const decoder = new TextDecoder();
        let buf = "";

        const handleEvent = (event: string, parsed: Record<string, unknown>) => {
          if (event === "thought") {
            if (typeof parsed.message === "string" && parsed.message.trim()) {
              onActivity("thought", parsed.message.trim());
            }
          } else if (event === "text") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (!delta) return;
            if (parsed.channel === "notes") {
              noteOps.push({ kind: "notes", text: delta });
            } else {
              setTurns((prev) =>
                prev.map((t) =>
                  t.id === assistantId
                    ? { ...t, content: t.content + delta }
                    : t
                )
              );
            }
          } else if (event === "op") {
            const sectionId =
              typeof parsed.sectionId === "string" ? parsed.sectionId : "";
            if (!sectionId) return;
            if (parsed.op === "delete") {
              noteOps.push({ kind: "delete", sectionId });
              noteOpCount += 1;
            } else if (parsed.op === "highlight") {
              noteOps.push({
                kind: "highlight",
                sectionId,
                color:
                  typeof parsed.color === "string" ? parsed.color : "#fde68a",
              });
              noteOpCount += 1;
            } else if (parsed.op === "revise") {
              noteOps.push({ kind: "revise", sectionId });
              noteOpCount += 1;
            } else if (parsed.op === "append") {
              noteOps.push({
                kind: "append",
                sectionId,
                dividerBefore: hasNotes || appendStarted,
              });
              appendStarted = true;
              noteOpCount += 1;
            }
          } else if (event === "error") {
            throw new Error(
              typeof parsed.message === "string"
                ? parsed.message
                : "Could not answer just now."
            );
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let sepIdx: number;
          while ((sepIdx = buf.indexOf("\n\n")) >= 0) {
            const raw = buf.slice(0, sepIdx);
            buf = buf.slice(sepIdx + 2);
            let event = "message";
            let data = "";
            for (const line of raw.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            handleEvent(event, JSON.parse(data) as Record<string, unknown>);
          }
        }

        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId && !t.content.trim()
              ? {
                  ...t,
                  content: noteOpCount
                    ? "Updated your notes."
                    : "I didn't have a reply for that — try asking again.",
                }
              : t
          )
        );

        if (noteOps.length > 0) {
          onActivity(
            "status",
            noteOpCount === 1
              ? "Updating your notes from chat…"
              : "Applying those note edits…"
          );
          void applyNoteOps(noteOps);
        }
      } catch (e) {
        const msg =
          e instanceof Error && e.message
            ? e.message
            : "Could not answer just now.";
        onActivity("error", msg);
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId
              ? { ...t, content: t.content.trim() || msg }
              : t
          )
        );
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [
      applyNoteOps,
      busy,
      noteInstruction,
      notesRef,
      onActivity,
      recentTranscript,
      screenContext,
      sessionId,
    ]
  );

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {turns.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Ask about this lecture, or tell Rose to edit the notes — add,
              delete, expand, or highlight a section.
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(s)}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t) => (
            <div
              key={t.id}
              className={t.role === "user" ? "flex justify-end" : "flex justify-start"}
            >
              <div
                className={
                  t.role === "user"
                    ? "max-w-[92%] rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] leading-snug text-white"
                    : "max-w-[92%] rounded-xl rounded-bl-sm border border-fuchsia-200/55 bg-fuchsia-50/90 px-3 py-2 text-[12px] leading-snug text-zinc-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/40 dark:text-zinc-100"
                }
              >
                <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                  {t.role === "user" ? "You" : "Rose"}
                  {busy && t.role === "assistant" && t === turns[turns.length - 1]
                    ? " · …"
                    : ""}
                </p>
                {t.content.trim() ? (
                  t.role === "assistant" ? (
                    <StudyChatMessageMarkdown source={t.content} />
                  ) : (
                    <p className="whitespace-pre-wrap">{t.content}</p>
                  )
                ) : busy && t.role === "assistant" ? (
                  <span className="text-zinc-400">…</span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={onSubmit}
        className="border-t border-zinc-200 p-2.5 dark:border-zinc-800"
      >
        <label className="sr-only" htmlFor="live-notes-chat-input">
          Ask Rose about the lecture
        </label>
        <textarea
          id="live-notes-chat-input"
          ref={inputRef}
          rows={2}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(draft);
            }
          }}
          placeholder={
            lectureTitle.trim()
              ? `Ask about ${lectureTitle.trim()}…`
              : "Ask about the lecture, or edit the notes…"
          }
          className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-rose-300 focus:outline-none focus:ring-2 focus:ring-rose-100 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-rose-800 dark:focus:ring-rose-950/80"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="text-[10px] text-zinc-400 dark:text-zinc-500">
            Enter to send · Shift+Enter for a new line
          </p>
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="rounded-full bg-rose-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? "Thinking…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
