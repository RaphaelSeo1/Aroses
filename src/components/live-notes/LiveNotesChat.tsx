"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from "react";
import type { NotesPanelHandle } from "@/components/immersive/NotesPanel";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import {
  sanitizeChatNotesMarkdown,
  splitStudentFacingReply,
  visibleReplyForStream,
} from "@/lib/live-notes/lecture-chat-protocol";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  thoughts?: string[];
};

type NoteOp =
  | { kind: "delete"; sectionId: string }
  | { kind: "highlight"; sectionId: string; color: string }
  | { kind: "revise"; sectionId: string }
  | { kind: "append"; sectionId: string; dividerBefore: boolean }
  | { kind: "notes"; text: string };

const REPLY_TICK_MS = 16;
const REPLY_CPS = 68;
const REPLY_CPS_CATCHUP = 170;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SUGGESTIONS = [
  "What did they just cover?",
  "Add more detail to the last section",
  "Highlight the key definition",
  "Delete the draft that looks wrong",
];

function looksLikeNotesBody(md: string): boolean {
  const t = md.trim();
  if (!t) return false;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/^\s*[-*]\s/m.test(t)) return true;
  if (/^\s*\d+\.\s/m.test(t)) return true;
  if (/^\|.+\|/m.test(t)) return true;
  return t.split("\n").filter((l) => l.trim()).length >= 3;
}

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
      .map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        thoughts: Array.isArray(t.thoughts)
          ? t.thoughts
              .filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
              .slice(0, 24)
          : undefined,
      }))
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
  active = true,
}: {
  sessionId: string;
  lectureTitle: string;
  recentTranscript: string;
  screenContext: string;
  noteInstruction: string;
  notesRef: RefObject<NotesPanelHandle | null>;
  enqueueWriterJob: (job: () => Promise<void>) => void;
  onActivity: (
    kind: "thought" | "status" | "error",
    message: string,
    loc?: { sectionId?: string; sectionLabel?: string }
  ) => void;
  /** When the chat tab is shown — re-pin to the latest turn. */
  active?: boolean;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>(() => loadTurns(sessionId));
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const turnsRef = useRef(turns);
  turnsRef.current = turns;

  const stickToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  useLayoutEffect(() => {
    if (!active) return;
    stickToLatest();
    const id = window.requestAnimationFrame(() => {
      stickToLatest();
      window.requestAnimationFrame(stickToLatest);
    });
    return () => window.cancelAnimationFrame(id);
  }, [turns, busy, streamingId, active, stickToLatest]);

  useEffect(() => {
    if (!active) return;
    const el = scrollRef.current;
    if (!el) return;
    const stick = () => stickToLatest();
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(stick) : null;
    ro?.observe(el);
    const inner = el.firstElementChild;
    if (inner) ro?.observe(inner);
    const mo = new MutationObserver(stick);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      ro?.disconnect();
      mo.disconnect();
    };
  }, [active, stickToLatest, turns.length]);

  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(
        storageKey(sessionId),
        JSON.stringify(turnsRef.current.filter((t) => t.content.trim()).slice(-40))
      );
    } catch {
      /* ignore */
    }
  }, [sessionId, turns, busy]);

  const applyNoteOps = useCallback(
    async (ops: NoteOp[], fallbackMarkdown = "") => {
      const run = async () => {
        const writer = notesRef.current?.getStreamWriter();
        if (!writer) {
          onActivity(
            "error",
            "Could not reach the notes editor to apply that change."
          );
          return;
        }

        type Applied = {
          kind: "revise" | "append";
          sectionId: string;
          markdown: string;
          dividerBefore?: boolean;
        };
        const coalesced: Array<
          | Applied
          | { kind: "delete"; sectionId: string }
          | { kind: "highlight"; sectionId: string; color: string }
        > = [];
        for (const item of ops) {
          if (item.kind === "notes") {
            const last = coalesced[coalesced.length - 1];
            if (last && (last.kind === "revise" || last.kind === "append")) {
              last.markdown += item.text;
            }
            continue;
          }
          if (item.kind === "revise") {
            coalesced.push({
              kind: "revise",
              sectionId: item.sectionId,
              markdown: "",
            });
          } else if (item.kind === "append") {
            coalesced.push({
              kind: "append",
              sectionId: item.sectionId,
              markdown: "",
              dividerBefore: item.dividerBefore,
            });
          } else if (item.kind === "delete") {
            coalesced.push({ kind: "delete", sectionId: item.sectionId });
          } else if (item.kind === "highlight") {
            coalesced.push({
              kind: "highlight",
              sectionId: item.sectionId,
              color: item.color,
            });
          }
        }

        const fallbackRaw = sanitizeChatNotesMarkdown(fallbackMarkdown);
        const fallback = looksLikeNotesBody(fallbackRaw) ? fallbackRaw : "";
        notesRef.current?.setStreamingIndicator(true);
        writer.finishOp();
        let applied = 0;
        let failed = 0;

        for (const item of coalesced) {
          if (item.kind === "delete") {
            if (
              writer.deleteSection(item.sectionId, { evenIfStudentEdited: true })
            ) {
              applied += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "highlight") {
            if (writer.highlightSection(item.sectionId, item.color)) {
              applied += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "revise") {
            let md = sanitizeChatNotesMarkdown(item.markdown);
            if (!md) md = fallback;
            const ok = md
              ? writer.replaceSectionMarkdown(item.sectionId, md, {
                  evenIfStudentEdited: true,
                })
              : false;
            if (ok) {
              applied += 1;
            } else if (md) {
              const appended = writer.appendMarkdown(item.sectionId, md, {
                dividerBefore: true,
              });
              if (appended) applied += 1;
              else failed += 1;
            } else {
              failed += 1;
            }
          } else if (item.kind === "append") {
            let md = sanitizeChatNotesMarkdown(item.markdown);
            if (!md) md = fallback;
            if (
              md &&
              writer.appendMarkdown(item.sectionId, md, {
                dividerBefore: item.dividerBefore,
              })
            ) {
              applied += 1;
            } else {
              failed += 1;
            }
          }
        }

        notesRef.current?.setStreamingIndicator(false);
        let jumpId: string | undefined;
        for (const item of coalesced) {
          if ("sectionId" in item) jumpId = item.sectionId;
        }
        if (applied > 0 && failed === 0) {
          onActivity("status", "Updated your notes.", {
            sectionId: jumpId,
          });
          if (jumpId) notesRef.current?.revealSection(jumpId);
        } else if (applied > 0) {
          onActivity("error", "Some of those note edits didn't apply.", {
            sectionId: jumpId,
          });
        } else {
          onActivity(
            "error",
            "I couldn't change that section in the notes. Select it and ask again."
          );
        }
      };

      enqueueWriterJob(run);
    },
    [enqueueWriterJob, notesRef, onActivity]
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
      setStreamingId(assistantId);

      const writer = notesRef.current?.getStreamWriter();
      const sections = writer?.listAllSections(60) ?? [];
      const selectedText = notesRef.current?.getSelectedText() ?? "";
      const hasNotes = Boolean(writer && sections.length > 0);

      const noteOps: NoteOp[] = [];
      let appendStarted = false;
      let noteOpCount = 0;
      let pendingReply = "";
      let fallbackReply: string | null = null;
      let revealed = 0;
      let sseDone = false;
      let cancelled = false;
      const thoughtAcc: string[] = [];
      const seenThoughts = new Set<string>();

      const visibleSource = () =>
        fallbackReply ?? visibleReplyForStream(pendingReply, sseDone);

      const syncThoughts = () => {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, thoughts: [...thoughtAcc] } : t
          )
        );
      };

      const pushThought = (message: string, toActivity: boolean) => {
        const msg = message.trim();
        if (!msg || seenThoughts.has(msg)) return;
        seenThoughts.add(msg);
        thoughtAcc.push(msg);
        if (toActivity) onActivity("thought", msg);
        syncThoughts();
      };

      const harvestLeaks = () => {
        for (const leak of splitStudentFacingReply(pendingReply).leaked) {
          pushThought(leak, false);
        }
      };

      const revealReply = (next: string) => {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === assistantId ? { ...t, content: next } : t
          )
        );
      };

      const pumpReply = async () => {
        while (!cancelled) {
          harvestLeaks();
          const source = visibleSource();
          if (revealed > source.length) {
            revealed = source.length;
            revealReply(source);
          }
          const leftover = source.slice(revealed);
          if (!leftover) {
            if (sseDone) break;
            await sleep(REPLY_TICK_MS);
            continue;
          }
          const cps =
            leftover.length > 320
              ? REPLY_CPS_CATCHUP
              : leftover.length > 90
                ? 110
                : REPLY_CPS;
          const step = Math.max(
            1,
            Math.round((cps * REPLY_TICK_MS) / 1000)
          );
          revealed += Math.min(step, leftover.length);
          revealReply(source.slice(0, revealed));
          await sleep(REPLY_TICK_MS);
        }
      };

      const pump = pumpReply();
      let failed = false;
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
              pushThought(parsed.message, true);
            }
          } else if (event === "text") {
            const delta = typeof parsed.delta === "string" ? parsed.delta : "";
            if (!delta) return;
            if (parsed.channel === "notes") {
              noteOps.push({ kind: "notes", text: delta });
            } else {
              pendingReply += delta;
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

        harvestLeaks();
        if (!visibleReplyForStream(pendingReply, true).trim()) {
          fallbackReply = noteOpCount
            ? "Updated your notes."
            : "I didn't have a reply for that — try asking again.";
        }
        const looksLikeEdit =
          /\b(fix the wording|reword|rewrite|rephrase|change (that|this|it) to|make (it|this|that) (simpler|shorter|clearer|better)|add (that|this|it|more) (to|detail)|put that in the notes|take (that|this) out|delete (that|this|the)|highlight (that|this|the)|expand (that|this|the))\b/i.test(
            message
          ) ||
          /^(please\s+)?((can|could)\s+you\s+)?(fix|change|reword|rewrite|rephrase|simplify|shorten|expand|delete|remove|highlight)\b/i.test(
            message.trim()
          );
        if (!failed && noteOpCount === 0 && looksLikeEdit) {
          onActivity(
            "error",
            "I didn't apply that to the notes. Try again, or select the section first."
          );
        }
      } catch (e) {
        failed = true;
        cancelled = true;
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
        sseDone = true;
        await pump;
        if (!failed) {
          harvestLeaks();
          const final = visibleSource();
          if (final.trim()) revealReply(final);
        }
        setStreamingId(null);
        setBusy(false);
        inputRef.current?.focus();
      }

      if (!failed && noteOps.length > 0) {
        onActivity(
          "status",
          noteOpCount === 1
            ? "Updating your notes from chat…"
            : "Applying those note edits…"
        );
        void applyNoteOps(
          noteOps,
          visibleReplyForStream(pendingReply, true)
        );
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
              <div className="max-w-[92%]">
                <div
                  className={
                    t.role === "user"
                      ? "rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] leading-snug text-white"
                      : "rounded-xl rounded-bl-sm border border-fuchsia-200/55 bg-fuchsia-50/90 px-3 py-2 text-[12px] leading-snug text-zinc-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/40 dark:text-zinc-100"
                  }
                >
                  <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                    {t.role === "user" ? "You" : "Rose"}
                    {t.id === streamingId ? " · …" : ""}
                  </p>
                  {t.role === "assistant" ? (
                    <div className="text-[12px] leading-snug">
                      {t.content.trim() ? (
                        <StudyChatMessageMarkdown source={t.content} compact />
                      ) : null}
                      {t.id === streamingId ? (
                        <span
                          aria-hidden
                          className="ml-0.5 inline-block h-[0.85em] w-[0.08em] translate-y-[0.12em] animate-pulse rounded-sm bg-fuchsia-500 align-baseline"
                        />
                      ) : null}
                    </div>
                  ) : t.content.trim() ? (
                    <p className="whitespace-pre-wrap text-[12px] leading-snug">
                      {t.content}
                    </p>
                  ) : null}
                </div>
                {t.role === "assistant" &&
                (t.thoughts?.length ?? 0) > 0 ? (
                  <details className="mt-1 px-0.5">
                    <summary className="cursor-pointer select-none text-[10px] font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
                      Thinking…
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                      {t.thoughts!.join("\n")}
                    </p>
                  </details>
                ) : null}
              </div>
            </div>
          ))
        )}
        <div aria-hidden className="h-px w-full" />
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
            {busy
              ? turns.some((t) => t.id === streamingId && t.content)
                ? "Writing…"
                : "Thinking…"
              : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
