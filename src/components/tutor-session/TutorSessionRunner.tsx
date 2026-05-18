"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NotesPanel, type NotesPanelHandle } from "@/components/immersive/NotesPanel";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";
import type { TutorSessionRecord } from "@/types/tutor-session";

/**
 * Active Tutor Session interface.
 *
 * Layout:
 *   ┌─────────────────────────┬──────────────────────┐
 *   │   Conversation feed     │     Notes panel      │
 *   │   (Rose + student)      │   (Notion-style)     │
 *   ├─────────────────────────┴──────────────────────┤
 *   │            Voice dock (mic + text input)         │
 *   └──────────────────────────────────────────────────┘
 *
 * Key behaviors:
 *   - On first mount with empty transcript, fires an opening
 *     greeting via /turn-stream with a synthetic "opening" utterance
 *     so Rose introduces herself + acknowledges any uploads.
 *   - submitTurn(text): POSTs to /turn-stream SSE, accumulates text
 *     deltas, splits into sentences for TTS, and renders the live
 *     reply as a streaming bubble.
 *   - "End session" → /end → routes to recap page.
 *   - Notes panel saves to /api/tutor-session/[id]/notes.
 */

type LocalMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** True while assistant text is still streaming in. */
  streaming?: boolean;
};

const TURN_META_NOOP = "__meta-event__";

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function TutorSessionRunner({
  initial,
}: {
  initial: TutorSessionRecord;
}) {
  const router = useRouter();

  // ----- conversation state -----
  const [messages, setMessages] = useState<LocalMessage[]>(
    (initial.transcript ?? []).map((m, i) => ({
      id: `${m.ts}-${i}`,
      role: m.role,
      content: m.content,
    }))
  );
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const [composer, setComposer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [endingSession, setEndingSession] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ----- session timer -----
  const [seconds, setSeconds] = useState(() => {
    const startedAt = Date.parse(initial.startedAt);
    if (Number.isNaN(startedAt)) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  });
  useEffect(() => {
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  // ----- voice -----
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const raw = window.localStorage.getItem("rose:playbackRate");
    const n = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(n) ? Math.min(1.5, Math.max(0.5, n)) : 1;
  });
  const updatePlaybackRate = useCallback((next: number) => {
    const clamped = Math.min(1.5, Math.max(0.5, next));
    setPlaybackRate(clamped);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("rose:playbackRate", String(clamped));
      } catch {
        /* ignore */
      }
    }
  }, []);
  const onBargeInRef = useRef<() => void>(() => {});
  const voice = useMentoredVoice({
    sessionId: initial.id,
    playbackRate,
    onBargeIn: () => onBargeInRef.current(),
  });

  // ----- notes panel handle (for future "+ Add to notes" buttons) -----
  const notesPanelRef = useRef<NotesPanelHandle | null>(null);

  // ----- auto-scroll the feed on new content -----
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---------------------------------------------------------------
  // Turn handler — streams /turn-stream SSE, builds an assistant
  // message in place, and feeds full sentences to TTS as they form.
  // ---------------------------------------------------------------

  const submitTurn = useCallback(
    async (utterance: string) => {
      const text = utterance.trim();
      if (!text || submitting) return;
      setComposer("");
      setSubmitting(true);

      // Append user message immediately.
      const userMsg: LocalMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
      };
      // Create empty assistant placeholder.
      const assistantId = `a-${Date.now()}`;
      const assistantMsg: LocalMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      // Set up an async sentence pump for TTS that consumes the
      // streaming reply as it comes in.
      const sentenceQueue: string[] = [];
      let streamDone = false;
      const sentenceIterable: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
          return {
            async next(): Promise<IteratorResult<string>> {
              while (sentenceQueue.length === 0 && !streamDone) {
                await new Promise((r) => setTimeout(r, 30));
              }
              if (sentenceQueue.length > 0) {
                return { value: sentenceQueue.shift() as string, done: false };
              }
              return { value: "", done: true };
            },
          };
        },
      };
      // Kick off speaking. `speakSentenceStream` will resolve when
      // the iterable is exhausted (streamDone=true + queue empty).
      voice.speakSentenceStream(sentenceIterable).catch((e) => {
        console.error("[TutorSessionRunner speakSentenceStream]", e);
      });

      // Stream the SSE.
      let buffered = "";
      let lastFlushedAt = 0;
      const SENTENCE_RE = /([.!?])\s+(?=[A-Z“"'(\[])/g;

      function flushSentences(force = false) {
        SENTENCE_RE.lastIndex = lastFlushedAt;
        let m: RegExpExecArray | null;
        let lastIdx = lastFlushedAt;
        while ((m = SENTENCE_RE.exec(buffered))) {
          const end = m.index + m[0].length;
          const sentence = buffered.slice(lastIdx, end).trim();
          if (sentence.length > 0) sentenceQueue.push(sentence);
          lastIdx = end;
        }
        lastFlushedAt = lastIdx;
        if (force) {
          const tail = buffered.slice(lastIdx).trim();
          if (tail.length > 0) sentenceQueue.push(tail);
          lastFlushedAt = buffered.length;
        }
      }

      try {
        const res = await fetch(
          `/api/tutor-session/${initial.id}/turn-stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ utterance: text }),
          }
        );
        if (!res.ok || !res.body) {
          throw new Error(`Turn failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let leftover = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          const fullText = leftover + chunk;
          const blocks = fullText.split("\n\n");
          leftover = blocks.pop() ?? "";
          for (const block of blocks) {
            if (!block.trim()) continue;
            const lines = block.split("\n");
            let event = "message";
            let data = "";
            for (const line of lines) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            if (event === "text") {
              try {
                const parsed = JSON.parse(data) as { delta?: string };
                if (typeof parsed.delta === "string") {
                  buffered += parsed.delta;
                  flushSentences(false);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === assistantId
                        ? { ...m, content: buffered }
                        : m
                    )
                  );
                }
              } catch {
                /* ignore */
              }
            } else if (event === "meta") {
              // Image requests are deferred to the next phase; just
              // mark the event so we can extend later.
              void TURN_META_NOOP;
            } else if (event === "done") {
              break;
            } else if (event === "error") {
              throw new Error("Stream error");
            }
          }
        }
        flushSentences(true);
        streamDone = true;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
      } catch (e) {
        console.error("[TutorSessionRunner submitTurn]", e);
        streamDone = true;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  content:
                    m.content ||
                    "Sorry — I hit a snag. Try saying that again.",
                }
              : m
          )
        );
      } finally {
        setSubmitting(false);
      }
    },
    [initial.id, submitting, voice]
  );

  // ----- barge-in: stop speech + start recording -----
  const startVoiceCapture = useCallback(async () => {
    voice.cancelSpeak();
    const blob = await voice.recordUntilSilence();
    if (!blob) return;
    const text = await voice.transcribe(blob);
    if (text) void submitTurn(text);
  }, [submitTurn, voice]);
  useEffect(() => {
    onBargeInRef.current = () => {
      void startVoiceCapture();
    };
  }, [startVoiceCapture]);

  // ----- opening greeting (once, if transcript empty) -----
  //
  // Schedule via setTimeout so we never call setState synchronously
  // inside the effect body. Synthetic opening trigger phrased as a
  // system instruction so Rose's first reply is a proper greeting
  // that acknowledges the topic / uploads instead of looking like
  // the student said those words.
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    if ((initial.transcript ?? []).length > 0) return;
    greetedRef.current = true;
    const opener = initial.topic
      ? `[Session starting. The student wrote: "${initial.topic}". Greet them, briefly acknowledge it, and ask what they want to dig into first.]`
      : initial.referenceSummary
        ? `[Session starting. The student has uploaded reference material. Greet them warmly, mention what you can see in the materials in one sentence, and ask what they want to focus on first.]`
        : `[Session starting. The student hasn't given a topic yet. Greet them warmly and ask what they'd like to work on.]`;
    const t = window.setTimeout(() => {
      void submitTurn(opener);
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- end session -----
  const endSession = useCallback(async () => {
    if (endingSession) return;
    if (messages.length < 2) {
      const confirm = window.confirm(
        "You just got started — sure you want to end already?"
      );
      if (!confirm) return;
    }
    setEndingSession(true);
    setEndError(null);
    try {
      const res = await fetch(`/api/tutor-session/${initial.id}/end`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error(`End failed (${res.status})`);
      }
      router.push(`/tutor-session/recap/${initial.id}`);
    } catch (e) {
      console.error("[TutorSessionRunner endSession]", e);
      setEndError("Couldn't end the session. Try again.");
      setEndingSession(false);
    }
  }, [endingSession, initial.id, messages.length, router]);

  // ----- ui helpers -----
  const recordingHint = useMemo(() => {
    if (voice.state.recording) return "Listening…";
    if (voice.state.transcribing) return "Got it, transcribing…";
    if (voice.state.speaking) return "Rose is speaking — tap mic to interrupt";
    return null;
  }, [
    voice.state.recording,
    voice.state.transcribing,
    voice.state.speaking,
  ]);

  return (
    <main className="bg-app-gradient flex min-h-[calc(100vh-4rem)] flex-col">
      {/* Sub-header: title + timer + end button */}
      <div className="border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              Tutor Session
            </p>
            <h1 className="truncate text-base font-semibold text-zinc-900 sm:text-lg">
              {initial.title}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-600 sm:inline">
              {formatDuration(seconds)}
            </span>
            <SpeedPill rate={playbackRate} onChange={updatePlaybackRate} />
            <button
              type="button"
              onClick={endSession}
              disabled={endingSession}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-zinc-700 disabled:opacity-60"
            >
              {endingSession ? "Ending…" : "End session"}
            </button>
          </div>
        </div>
        {endError ? (
          <p className="mx-auto mt-1.5 max-w-6xl text-[11px] text-rose-700">
            {endError}
          </p>
        ) : null}
      </div>

      <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-4 px-3 py-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] lg:px-6">
        {/* Left — conversation */}
        <div className="flex min-h-[60vh] min-w-0 flex-col rounded-3xl border border-white/60 bg-white/85 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md">
          <div
            ref={scrollRef}
            className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7"
          >
            {(initial.referenceSummary || (initial.uploads ?? []).length > 0) ? (
              <UploadsRibbon uploads={initial.uploads ?? []} />
            ) : null}
            {messages.length === 0 ? (
              <p className="text-center text-sm text-zinc-400">
                Rose is getting ready…
              </p>
            ) : null}
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
            {recordingHint ? (
              <p className="text-center text-[11px] font-medium text-violet-700">
                {recordingHint}
              </p>
            ) : null}
          </div>

          {/* Voice dock */}
          <div className="border-t border-white/50 bg-white/70 px-3 py-3 sm:px-5">
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void startVoiceCapture()}
                disabled={submitting || voice.state.recording || voice.state.transcribing}
                aria-label="Hold to speak"
                className={`relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border shadow-sm transition ${
                  voice.state.recording
                    ? "border-rose-400 bg-rose-100 text-rose-700"
                    : "border-zinc-200 bg-white text-zinc-700 hover:border-violet-300 hover:bg-violet-50"
                } disabled:opacity-50`}
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value.slice(0, 4000))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void submitTurn(composer);
                  }
                }}
                placeholder="Type or hit the mic to talk…"
                rows={1}
                className="min-h-[44px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                disabled={submitting}
              />
              <button
                type="button"
                onClick={() => void submitTurn(composer)}
                disabled={submitting || composer.trim().length === 0}
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 px-4 text-xs font-semibold text-white shadow transition hover:from-violet-700 hover:to-fuchsia-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {voice.state.error ? (
              <p className="mt-2 text-[11px] text-rose-600">{voice.state.error}</p>
            ) : null}
          </div>
        </div>

        {/* Right — notes panel */}
        <div className="hidden min-w-0 lg:block">
          <div className="sticky top-4">
            <NotesPanel
              notesEndpoint={`/api/tutor-session/${initial.id}/notes`}
              lessonTitle={initial.title}
              courseTitle={
                initial.modeTag
                  ? initial.modeTag.replace(/_/g, " ")
                  : "Tutor session"
              }
              suggestions={[]}
              onConsumeSuggestion={() => {}}
              autoGenerate={false}
              onAutoGenerateChange={() => {}}
              editorRef={notesPanelRef}
              className="h-[calc(100vh-280px)] min-h-[24rem]"
            />
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageBubble({ message }: { message: LocalMessage }) {
  const isUser = message.role === "user";
  // Strip [bracket-style] instruction-only opener turns from display
  // (the synthetic greeting trigger). Rose's reply IS shown.
  const display =
    isUser && message.content.trim().startsWith("[")
      ? "(starting your session…)"
      : message.content;
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ring-1 ${
          isUser
            ? "rounded-br-md bg-violet-600 text-white ring-violet-700/20"
            : "rounded-bl-md bg-white text-zinc-800 ring-zinc-200/70"
        }`}
      >
        {!isUser ? (
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-violet-700">
            Rose
          </p>
        ) : null}
        <p className="whitespace-pre-wrap">
          {display}
          {message.streaming ? (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse rounded-sm bg-zinc-400 align-middle" />
          ) : null}
        </p>
      </div>
    </div>
  );
}

function UploadsRibbon({
  uploads,
}: {
  uploads: { id: string; fileName: string; fileKind: string }[];
}) {
  if (uploads.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded-2xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-[11px] text-violet-900">
      <span className="font-semibold uppercase tracking-wider text-violet-700">
        📎 Attached:
      </span>
      {uploads.map((u) => (
        <span
          key={u.id}
          className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-violet-900"
          title={u.fileKind}
        >
          {u.fileName}
        </span>
      ))}
    </div>
  );
}

function SpeedPill({
  rate,
  onChange,
}: {
  rate: number;
  onChange: (next: number) => void;
}) {
  const STEPS = [0.75, 1, 1.25, 1.5, 0.5] as const;
  const advance = () => {
    let bestIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < STEPS.length; i += 1) {
      const d = Math.abs(STEPS[i] - rate);
      if (d < bestDelta) {
        bestDelta = d;
        bestIdx = i;
      }
    }
    onChange(STEPS[(bestIdx + 1) % STEPS.length]);
  };
  const label = Number.isInteger(rate)
    ? `${rate}x`
    : `${rate.toFixed(2).replace(/0$/, "")}x`;
  return (
    <button
      type="button"
      onClick={advance}
      className="hidden rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium tabular-nums text-zinc-700 hover:bg-white sm:inline"
      title={`Voice speed ${label} — click to cycle`}
    >
      {label}
    </button>
  );
}
