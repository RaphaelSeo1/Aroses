"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ChatVoiceTutorButton } from "@/components/chat-voice/ChatVoiceTutorButton";
import { ChatVoiceTutorOrb } from "@/components/chat-voice/ChatVoiceTutorOrb";
import { StudyChatMessageMarkdown } from "@/components/StudyChatMessageMarkdown";
import { parseNotesFocusBucketNoteId } from "@/lib/notes/notes-focus-bucket";
import {
  useChatVoiceTutor,
  type ChatVoiceSendContext,
} from "@/lib/chat-voice/use-chat-voice-tutor";
import { useT } from "@/lib/i18n/LocaleProvider";
import { pumpTypewriterReply } from "@/lib/chat/typewriter-pump";
import { useStickToBottom } from "@/lib/chat/use-stick-to-bottom";
import {
  NotesChatInterruptionCoordinator,
  buildNotesChatHistory,
} from "@/lib/live-notes/chat-interruption";
import {
  loadReviewChatThreads,
  saveReviewChatThreads,
  threadTitleFromTurns,
  type ReviewChatThread,
  type ReviewChatTurn,
} from "@/lib/review/review-chat-threads";
import type { CourseQuizItem } from "@/types/course";

export type ReviewChatCardContext = {
  kind: "module" | "personal";
  materialId: string;
  moduleId: number;
  moduleTitle: string;
  courseTitle: string | null;
  personalItemId?: string;
  /** Focus-card source note — used so Rose can deep-link "your notes" inline. */
  sourceNoteId?: string | null;
  sourceExcerpt?: string | null;
  question: CourseQuizItem;
  revealed: boolean;
  studentAnswer: string;
  selectedChoice: string | null;
  grade: {
    correct: boolean;
    verdict: string;
    feedback: string | null;
  } | null;
};

const SUGGESTIONS = [
  "Why did I get this wrong?",
  "What do my notes say about this?",
  "Explain this like I'm reviewing for the exam",
];

function newThread(): ReviewChatThread {
  return {
    id: `t-${crypto.randomUUID()}`,
    title: "New chat",
    updatedAt: Date.now(),
    turns: [],
  };
}

export function ReviewSessionChat({
  sessionKey,
  card,
}: {
  sessionKey: string;
  card: ReviewChatCardContext | null;
}) {
  const t = useT();
  const [threads, setThreads] = useState<ReviewChatThread[]>([
    { id: "new", title: "New chat", updatedAt: 0, turns: [] },
  ]);
  const [activeId, setActiveId] = useState("new");
  const [railOpen, setRailOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [handingOff, setHandingOff] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [voiceCapped, setVoiceCapped] = useState(false);

  useEffect(() => {
    const stored = loadReviewChatThreads(sessionKey);
    if (stored.length > 0) {
      setThreads(stored);
      setActiveId(stored[0]!.id);
      return;
    }
    const th = newThread();
    setThreads([th]);
    setActiveId(th.id);
  }, [sessionKey]);

  const active = threads.find((th) => th.id === activeId) ?? threads[0]!;
  const turns = active?.turns ?? [];

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const turnsRef = useRef(turns);
  const streamingIdRef = useRef(streamingId);
  const coordinatorRef = useRef(new NotesChatInterruptionCoordinator());
  const lastSendIntentRef = useRef<{ message: string; at: number } | null>(
    null
  );
  const voiceActiveRef = useRef(false);
  const cardRef = useRef(card);
  const threadsRef = useRef(threads);
  const activeIdRef = useRef(activeId);

  turnsRef.current = turns;
  streamingIdRef.current = streamingId;
  cardRef.current = card;
  threadsRef.current = threads;
  activeIdRef.current = activeId;

  const { pin } = useStickToBottom(scrollRef, {
    resetKey: `${activeId}:${streamingId ?? ""}:${turns.length}`,
  });

  const persist = useCallback(
    (next: ReviewChatThread[], write = true) => {
      threadsRef.current = next;
      setThreads(next);
      if (write) saveReviewChatThreads(sessionKey, next);
    },
    [sessionKey]
  );

  useEffect(() => {
    if (busy) return;
    saveReviewChatThreads(sessionKey, threadsRef.current);
  }, [busy, sessionKey, threads]);

  const updateActiveTurns = useCallback(
    (update: (current: ReviewChatTurn[]) => ReviewChatTurn[]) => {
      const id = activeIdRef.current;
      const nextTurns = update(turnsRef.current);
      turnsRef.current = nextTurns;
      persist(
        threadsRef.current.map((th) =>
          th.id === id
            ? {
                ...th,
                turns: nextTurns,
                title: threadTitleFromTurns(nextTurns),
                updatedAt: Date.now(),
              }
            : th
        ),
        false
      );
    },
    [persist]
  );

  const startNewChat = useCallback(() => {
    const th = newThread();
    persist([th, ...threadsRef.current].slice(0, 20));
    setActiveId(th.id);
    setDraft("");
    pin();
  }, [persist, pin]);

  const sendRef = useRef<
    (text: string, ctx?: ChatVoiceSendContext) => Promise<string | null>
  >(async () => null);

  const send = useCallback(
    async (text: string, ctx?: ChatVoiceSendContext): Promise<string | null> => {
      const typed = text.trim();
      if (!typed) return null;
      const now = Date.now();
      const previousIntent = lastSendIntentRef.current;
      if (
        previousIntent?.message === typed &&
        now - previousIntent.at < 750
      ) {
        return null;
      }
      lastSendIntentRef.current = { message: typed, at: now };
      const coordinator = coordinatorRef.current;
      const wasActive = coordinator.isActive;
      if (wasActive) setHandingOff(true);
      const lease = await coordinator.beginSend(() => {
        const interruptedId = streamingIdRef.current;
        if (!interruptedId) return;
        updateActiveTurns((current) =>
          current.map((turn) =>
            turn.id === interruptedId ? { ...turn, interrupted: "send" } : turn
          )
        );
        streamingIdRef.current = null;
        setStreamingId(null);
      });
      if (!lease) return null;

      const userTurn: ReviewChatTurn = {
        id: `u-${crypto.randomUUID()}`,
        role: "user",
        content: typed,
      };
      const assistantId = `a-${crypto.randomUUID()}`;
      const history = buildNotesChatHistory(turnsRef.current);
      updateActiveTurns((current) => [
        ...current,
        userTurn,
        { id: assistantId, role: "assistant", content: "" },
      ]);
      setDraft((current) => (current === text ? "" : current));
      setBusy(true);
      setHandingOff(false);
      streamingIdRef.current = assistantId;
      setStreamingId(assistantId);
      pin();

      let pendingReply = "";
      let sseDone = false;
      let cancelled = false;
      const revealReply = (next: string) => {
        if (!lease.isCurrent()) return;
        updateActiveTurns((current) =>
          current.map((turn) =>
            turn.id === assistantId ? { ...turn, content: next } : turn
          )
        );
      };
      const pump = pumpTypewriterReply({
        getSource: () => pendingReply,
        reveal: revealReply,
        isDone: () => sseDone,
        isCancelled: () => cancelled || !lease.isCurrent(),
        skipAnimation: () => voiceActiveRef.current,
      });

      let failed = false;
      const currentCard = cardRef.current;
      try {
        const res = await fetch("/api/srs/review-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: typed,
            history,
            materialId: currentCard?.materialId,
            moduleId: currentCard?.moduleId,
            moduleTitle: currentCard?.moduleTitle,
            courseTitle: currentCard?.courseTitle,
            cardKind: currentCard?.kind,
            personalItemId: currentCard?.personalItemId,
            sourceNoteId:
              currentCard?.sourceNoteId ??
              (currentCard
                ? parseNotesFocusBucketNoteId(currentCard.materialId)
                : null),
            sourceExcerpt: currentCard?.sourceExcerpt,
            question: currentCard?.question,
            revealed: currentCard?.revealed ?? false,
            studentAnswer: currentCard?.studentAnswer ?? "",
            selectedChoice: currentCard?.selectedChoice,
            grade: currentCard?.grade,
            voice: Boolean(ctx?.onReplyDelta),
            voiceContinuation: ctx?.interruption,
          }),
          signal:
            ctx?.signal && typeof AbortSignal.any === "function"
              ? AbortSignal.any([lease.signal, ctx.signal])
              : lease.signal,
        });
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok || !contentType.includes("text/event-stream")) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
            code?: string;
          };
          if (data.code === "voice_cap_reached") setVoiceCapped(true);
          throw new Error(data.error || "Could not reach Rose.");
        }
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Could not reach Rose.");
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!lease.isCurrent()) break;
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
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (event === "text") {
              const delta = typeof parsed.delta === "string" ? parsed.delta : "";
              if (delta) {
                pendingReply += delta;
                ctx?.onReplyDelta?.(delta);
              }
            } else if (event === "done") {
              const finalReply =
                typeof parsed.finalReply === "string" ? parsed.finalReply : "";
              if (finalReply.trim()) {
                pendingReply = finalReply;
                revealReply(finalReply);
              }
            } else if (event === "error") {
              throw new Error(
                typeof parsed.message === "string"
                  ? parsed.message
                  : "Could not answer just now."
              );
            }
          }
        }
        if (!pendingReply.trim()) {
          pendingReply = "I didn't have a reply for that — try asking again.";
        }
      } catch (e) {
        failed = true;
        cancelled = true;
        if (lease.signal.aborted || !lease.isCurrent()) return null;
        const msg =
          e instanceof Error && e.message
            ? e.message
            : "Could not answer just now.";
        lastSendIntentRef.current = null;
        setDraft((current) => current || text);
        updateActiveTurns((current) =>
          current.map((turn) =>
            turn.id === assistantId
              ? { ...turn, content: turn.content.trim() || msg }
              : turn
          )
        );
      } finally {
        sseDone = true;
        await pump;
        if (!failed && lease.isCurrent() && pendingReply.trim()) {
          revealReply(pendingReply);
        }
        if (lease.isCurrent()) {
          streamingIdRef.current = null;
          setStreamingId(null);
          setBusy(false);
        }
        lease.finish();
        setHandingOff(false);
      }
      return pendingReply.trim() || null;
    },
    [pin, updateActiveTurns]
  );
  sendRef.current = send;

  const stopResponse = useCallback(async (reason: "stop" | "send" = "stop") => {
    const interruptedId = streamingIdRef.current;
    await coordinatorRef.current.stop(() => {
      if (!interruptedId) return;
      updateActiveTurns((current) =>
        current.map((turn) =>
          turn.id === interruptedId ? { ...turn, interrupted: reason } : turn
        )
      );
      streamingIdRef.current = null;
      setStreamingId(null);
      setBusy(false);
    });
  }, [updateActiveTurns]);

  const voice = useChatVoiceTutor({
    sessionId: `review:${sessionKey}`,
    sendAndWait: (text, ctx) => sendRef.current(text, ctx),
    onVoiceInterrupt: (reason) => {
      void stopResponse(reason);
    },
    blocked: voiceCapped,
  });
  useEffect(() => {
    voiceActiveRef.current = voice.active;
  }, [voice.active]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div
        className={`flex shrink-0 flex-col border-r border-zinc-200 bg-zinc-50/80 dark:border-zinc-800 dark:bg-zinc-900/40 ${
          railOpen ? "w-[11.5rem]" : "w-10"
        }`}
      >
        <button
          type="button"
          onClick={() => setRailOpen((v) => !v)}
          className="flex h-10 items-center justify-center border-b border-zinc-200 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-expanded={railOpen}
          title={t.review.chats}
        >
          {railOpen ? t.review.chats : "☰"}
        </button>
        {railOpen ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <button
              type="button"
              onClick={startNewChat}
              className="mx-2 mt-2 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-200"
            >
              {t.review.newChat}
            </button>
            <div className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-2">
              {threads.map((th) => (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => {
                    setActiveId(th.id);
                    pin();
                  }}
                  className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-[11px] ${
                    th.id === activeId
                      ? "bg-white font-semibold text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:bg-white/80 dark:text-zinc-400 dark:hover:bg-zinc-800/80"
                  }`}
                  title={th.title}
                >
                  {th.title}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {voice.active ? (
          <ChatVoiceTutorOrb
            phase={voice.phase}
            inputLevelRef={voice.inputLevelRef}
            playbackLevelRef={voice.playbackLevelRef}
            onExit={voice.exit}
          />
        ) : null}
        <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-fuchsia-700 dark:text-fuchsia-300">
              {t.review.askRose}
            </p>
            <p className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">
              {t.review.askRoseHint}
            </p>
          </div>
        </div>
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-3"
        >
          <div className="space-y-3">
            {turns.length === 0 ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {t.review.emptyReviewChat}
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
              turns.map((turn) => (
                <div
                  key={turn.id}
                  className={
                    turn.role === "user" ? "flex justify-end" : "flex justify-start"
                  }
                >
                  <div className="min-w-0 max-w-[92%] overflow-hidden">
                    <div
                      className={
                        turn.role === "user"
                          ? "overflow-hidden rounded-xl rounded-br-sm bg-zinc-800 px-3 py-2 text-[12px] leading-snug text-white"
                          : "overflow-hidden rounded-xl rounded-bl-sm border border-fuchsia-200/55 bg-fuchsia-50/90 px-3 py-2 text-[12px] leading-snug text-zinc-800 dark:border-fuchsia-900/40 dark:bg-fuchsia-950/40 dark:text-zinc-100"
                      }
                    >
                      <p className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">
                        {turn.role === "user" ? "You" : "Rose"}
                        {turn.id === streamingId ? " · …" : ""}
                        {turn.interrupted === "stop"
                          ? " · Stopped"
                          : turn.interrupted
                            ? " · Interrupted"
                            : ""}
                      </p>
                      {turn.role === "assistant" ? (
                        <div className="min-w-0 overflow-hidden text-[12px] leading-snug">
                          {turn.content.trim() ? (
                            <StudyChatMessageMarkdown
                              source={turn.content}
                              compact
                            />
                          ) : null}
                          {turn.id === streamingId ? (
                            <span
                              aria-hidden
                              className="ml-0.5 inline-block h-[0.85em] w-[0.08em] translate-y-[0.12em] animate-pulse rounded-sm bg-fuchsia-500 align-baseline"
                            />
                          ) : null}
                        </div>
                      ) : turn.content.trim() ? (
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {turn.content}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <form
          onSubmit={onSubmit}
          className="border-t border-zinc-200 p-2.5 dark:border-zinc-800"
        >
          <label className="sr-only" htmlFor="review-chat-input">
            {t.review.askRosePlaceholder}
          </label>
          <textarea
            id="review-chat-input"
            ref={inputRef}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(draft);
              }
            }}
            placeholder={t.review.askRosePlaceholder}
            className="w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-fuchsia-300 focus:outline-none focus:ring-2 focus:ring-fuchsia-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="truncate text-[10px] text-zinc-400 dark:text-zinc-500">
              {voice.phase === "speaking"
                ? "Talk over Rose or hit Stop to interrupt"
                : "Enter to send · Shift+Enter for a new line"}
            </p>
            <div className="flex shrink-0 items-center gap-1.5">
              <ChatVoiceTutorButton
                active={voice.active}
                disabled={voice.blocked}
                disabledReason={
                  voice.blocked ? t.billing.voiceCapReached : undefined
                }
                onClick={voice.toggle}
              />
              {(busy && !handingOff) || voice.phase === "speaking" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (voice.active) {
                      voice.interrupt("stop");
                      return;
                    }
                    void stopResponse("stop");
                  }}
                  className="rounded-full border border-zinc-300 bg-white px-3 py-1 text-[11px] font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
                >
                  Stop
                </button>
              ) : null}
              <button
                type="submit"
                disabled={handingOff || !draft.trim()}
                className="rounded-full bg-fuchsia-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-fuchsia-700 disabled:opacity-50"
              >
                {handingOff ? "Switching…" : busy ? "Interrupt & send" : "Send"}
              </button>
            </div>
          </div>
        </form>
        {voice.error ? (
          <p className="px-2.5 pb-2 text-[10px] leading-snug text-red-600 dark:text-red-400">
            {voice.error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
