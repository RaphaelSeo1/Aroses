"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  NotesPanel,
  type NotesPanelHandle,
  type AutoGenerateBlock,
} from "@/components/immersive/NotesPanel";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";
import {
  buildAutoNotesFromTutorTurn,
  studentRequestedNotesSave,
} from "@/lib/mentored/build-auto-notes-from-tutor-turn";
import { autoGenLog } from "@/lib/mentored/auto-generate-log";
import type {
  TutorSessionRecord,
  TutorSessionUpload,
} from "@/types/tutor-session";

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
  /**
   * Optional image rendered inline alongside the message bubble.
   * Set when Rose's turn meta included an imageRequest and the
   * client successfully fetched a Wikimedia result.
   */
  image?: {
    url: string;
    thumbUrl: string;
    sourceUrl: string;
    attribution: string;
    type: "diagram" | "photo" | "illustration";
  };
};

/** Bracket-wrapped instructions — never shown as student speech. */
function isSystemUtterance(text: string): boolean {
  return text.trim().startsWith("[");
}

function isPersistedSystemUserMessage(role: string, content: string): boolean {
  return role === "user" && isSystemUtterance(content);
}

// ---- Inactivity timeout thresholds (adjust here) ----
/** First gentle check-in after this much student silence. */
const INACTIVITY_GENTLE_CHECK_IN_MS = 5 * 60 * 1000;
/** Final check-in + pause after this much total student silence. */
const INACTIVITY_FINAL_PAUSE_MS = 15 * 60 * 1000;
/** Auto-end session + recap after this much total student silence. */
const INACTIVITY_AUTO_END_MS = 60 * 60 * 1000;

const GENTLE_CHECK_IN_TEXT =
  "Hey, still with me? No rush — just let me know when you're ready.";
const FINAL_CHECK_IN_TEXT =
  "I'll pause our session here for now — just press resume whenever you want to pick back up!";

function inactivityLog(step: string, payload?: Record<string, unknown>): void {
  if (payload !== undefined) {
    console.log(`[tutor-inactivity] ${step}`, payload);
  } else {
    console.log(`[tutor-inactivity] ${step}`);
  }
}

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
  const [messages, setMessages] = useState<LocalMessage[]>(() =>
    (initial.transcript ?? [])
      .filter((m) => !isPersistedSystemUserMessage(m.role, m.content))
      .map((m, i) => ({
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
  const [sessionPaused, setSessionPaused] = useState(
    initial.status === "paused"
  );
  const sessionPausedRef = useRef(initial.status === "paused");
  const [sessionBooting, setSessionBooting] = useState(
    () => (initial.transcript ?? []).length === 0
  );
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
  // Voice capture mode — mirrors the Mentored Learning runner:
  //   "push"  hold M (or the mic button) to talk
  //   "live"  Rose auto-listens after her own utterance; barge-in
  //           enabled so the student can talk over her
  // Persisted so the student's preference survives across sessions.
  const [voiceMode, setVoiceMode] = useState<"push" | "live">(() => {
    if (typeof window === "undefined") return "push";
    const raw = window.localStorage.getItem("rose:voiceMode");
    return raw === "live" ? "live" : "push";
  });
  const voiceModeRef = useRef<"push" | "live">("push");
  const voiceCaptureEpochRef = useRef(0);
  const liveCycleGuardRef = useRef(false);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);

  const onBargeInRef = useRef<() => void>(() => {});
  const voice = useMentoredVoice({
    sessionId: initial.id,
    playbackRate,
    onBargeIn: () => onBargeInRef.current(),
    // Barge-in only makes sense in live mode. In push-to-talk we
    // want the mic silent until the student explicitly hits M /
    // mouse-down on the mic button — otherwise room noise or the
    // speaker bleed triggers Rose to "hear" nothing and respond.
    bargeInEnabled: voiceMode === "live",
  });

  const abortVoiceCapture = useCallback(async () => {
    voiceCaptureEpochRef.current += 1;
    liveCycleGuardRef.current = false;
    voice.cancelSpeak();
    if (voice.state.recording) {
      await voice.stopRecording();
    }
  }, [voice]);

  const updateVoiceMode = useCallback(
    (next: "push" | "live") => {
      if (next === voiceModeRef.current) return;
      void abortVoiceCapture();
      setVoiceMode(next);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("rose:voiceMode", next);
        } catch {
          /* ignore — preference just won't persist */
        }
      }
    },
    [abortVoiceCapture]
  );

  // ----- notes panel handle ("+ Add to notes" buttons use this) -----
  const notesPanelRef = useRef<NotesPanelHandle | null>(null);
  const [addedNoteIds, setAddedNoteIds] = useState<Set<string>>(new Set());
  const [autoGenerateNotes, setAutoGenerateNotes] = useState(false);
  const autoGenerateNotesRef = useRef(false);
  const [notesEditorReady, setNotesEditorReady] = useState(false);
  const notesAppendedTurnRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    autoGenerateNotesRef.current = autoGenerateNotes;
  }, [autoGenerateNotes]);

  const handleAutoGenerateChange = useCallback((next: boolean) => {
    autoGenLog("tutor session autoGenerate state", { next });
    setAutoGenerateNotes(next);
  }, []);

  const appendNotesBlock = useCallback(
    (
      block: AutoGenerateBlock,
      turnKey: string,
      opts?: { skipDedupe?: boolean }
    ) => {
      const handle = notesPanelRef.current;
      if (!handle || !notesEditorReady) {
        autoGenLog("tutor append skipped — editor not ready", { turnKey });
        return false;
      }
      if (!opts?.skipDedupe && notesAppendedTurnRef.current.has(turnKey)) {
        autoGenLog("tutor append skipped — already appended", { turnKey });
        return false;
      }
      const ok = handle.appendBlock({ ...block, skipDedupe: opts?.skipDedupe });
      if (ok) notesAppendedTurnRef.current.add(turnKey);
      autoGenLog("tutor appendBlock", { turnKey, ok });
      return ok;
    },
    [notesEditorReady]
  );

  const synthesizeAndAppendNotes = useCallback(
    async (
      turnKey: string,
      roseReply: string,
      studentUtterance?: string,
      opts?: { skipDedupe?: boolean }
    ) => {
      autoGenLog("tutor synthesize notes start", {
        turnKey,
        roseLen: roseReply.length,
      });
      try {
        const res = await fetch(
          `/api/tutor-session/${initial.id}/synthesize-notes`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roseReply, studentUtterance }),
          }
        );
        if (!res.ok) {
          autoGenLog("tutor synthesize failed", {
            turnKey,
            status: res.status,
          });
          const fallback = buildAutoNotesFromTutorTurn(roseReply, {
            headingHint: initial.title,
          });
          if (fallback) {
            return appendNotesBlock(fallback, turnKey, opts);
          }
          return false;
        }
        const data = (await res.json()) as { block?: AutoGenerateBlock };
        if (!data.block) return false;
        return appendNotesBlock(data.block, turnKey, opts);
      } catch (e) {
        console.error("[TutorSessionRunner synthesizeNotes]", e);
        autoGenLog("tutor synthesize error", { turnKey });
        const fallback = buildAutoNotesFromTutorTurn(roseReply, {
          headingHint: initial.title,
        });
        if (fallback) {
          return appendNotesBlock(fallback, turnKey, opts);
        }
        return false;
      }
    },
    [appendNotesBlock, initial.id, initial.title]
  );

  const handleAutoGenerateUserToggle = useCallback(
    (next: boolean) => {
      autoGenLog("tutor user toggle auto-generate", { next });
      if (!next) return;
      const msgs = messagesRef.current;
      const lastAssistant = [...msgs]
        .reverse()
        .find((m) => m.role === "assistant" && !m.streaming && m.content.trim());
      if (!lastAssistant) return;
      const assistantIdx = msgs.findIndex((m) => m.id === lastAssistant.id);
      const priorStudent =
        assistantIdx > 0
          ? [...msgs.slice(0, assistantIdx)]
              .reverse()
              .find((m) => m.role === "user" && m.content.trim())
          : undefined;
      void synthesizeAndAppendNotes(
        `toggle-${lastAssistant.id}`,
        lastAssistant.content,
        priorStudent?.content,
        { skipDedupe: true }
      );
    },
    [synthesizeAndAppendNotes]
  );

  // ----- mid-session uploads -----
  // Local mirror of the session's uploads — seeded from `initial`,
  // appended whenever the student attaches more files mid-session.
  const [uploads, setUploads] = useState<TutorSessionUpload[]>(
    initial.uploads ?? []
  );
  const [uploading, setUploading] = useState(false);
  const [showMaterialsDrawer, setShowMaterialsDrawer] = useState(false);
  const midUploadInputRef = useRef<HTMLInputElement>(null);

  // ----- inactivity tracking (student silence only) -----
  const lastStudentActivityRef = useRef<number>(Date.now());
  /** 0 = none sent, 1 = gentle sent, 2 = final sent (session paused). */
  const checkInsSentRef = useRef<0 | 1 | 2>(0);
  const autoEndTriggeredRef = useRef(false);

  useEffect(() => {
    sessionPausedRef.current = sessionPaused;
  }, [sessionPaused]);

  // ----- live caption sync: revealed sentences -----
  // Text is appended to the assistant bubble ONLY when its sentence
  // is actually being SPOKEN by TTS — never before. This matches
  // the Mentored Learning behavior so voice and captions stay in
  // lockstep. The ref is reset at the start of every assistant turn.
  const revealedSentencesRef = useRef<string[]>([]);

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

  // Fire-and-forget image fetch (server caches), updates the
  // assistant message with the resolved image when ready. Used when
  // Rose's turn meta sets `imageRequest`.
  const fetchImageForMessage = useCallback(
    async (
      assistantId: string,
      query: string,
      type: "diagram" | "photo" | "illustration"
    ) => {
      try {
        const res = await fetch(
          `/api/tutor-session/${initial.id}/image`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, imageType: type }),
          }
        );
        if (!res.ok) return;
        const body = (await res.json()) as {
          image?: {
            url: string;
            thumbUrl: string;
            sourceUrl: string;
            attribution: string;
            type: "diagram" | "photo" | "illustration";
          } | null;
        };
        if (!body.image) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, image: body.image ?? undefined } : m
          )
        );
      } catch (e) {
        console.error("[TutorSessionRunner fetchImageForMessage]", e);
      }
    },
    [initial.id]
  );

  const resumeSessionQuiet = useCallback(async () => {
    if (!sessionPausedRef.current) return;
    try {
      const res = await fetch(`/api/tutor-session/${initial.id}/resume`, {
        method: "POST",
      });
      if (!res.ok) return;
      sessionPausedRef.current = false;
      setSessionPaused(false);
      inactivityLog("session resumed (quiet)");
    } catch (e) {
      console.error("[TutorSessionRunner resumeSessionQuiet]", e);
    }
  }, [initial.id]);

  const pauseSessionFromInactivity = useCallback(async () => {
    if (sessionPausedRef.current) return;
    inactivityLog("pausing session after final check-in");
    await abortVoiceCapture();
    try {
      const res = await fetch(`/api/tutor-session/${initial.id}/pause`, {
        method: "POST",
      });
      if (!res.ok) {
        console.error("[TutorSessionRunner pauseSession]", res.status);
        return;
      }
      sessionPausedRef.current = true;
      setSessionPaused(true);
    } catch (e) {
      console.error("[TutorSessionRunner pauseSession]", e);
    }
  }, [abortVoiceCapture, initial.id]);

  const deliverRoseMessage = useCallback(
    async (
      text: string,
      opts?: { persist?: boolean; speak?: boolean; thenPause?: boolean }
    ) => {
      if (endingSession) return;
      const trimmed = text.trim();
      if (!trimmed) return;
      const assistantId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: trimmed },
      ]);
      if (opts?.persist !== false) {
        try {
          await fetch(
            `/api/tutor-session/${initial.id}/assistant-message`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: trimmed }),
            }
          );
        } catch (e) {
          console.error("[TutorSessionRunner deliverRoseMessage persist]", e);
        }
      }
      if (opts?.speak !== false) {
        try {
          await voice.speak(trimmed);
        } catch (e) {
          console.error("[TutorSessionRunner deliverRoseMessage speak]", e);
        }
      }
      if (opts?.thenPause) {
        await pauseSessionFromInactivity();
      }
    },
    [endingSession, initial.id, pauseSessionFromInactivity, voice]
  );

  const autoEndFromInactivity = useCallback(async () => {
    if (autoEndTriggeredRef.current || endingSession) return;
    autoEndTriggeredRef.current = true;
    inactivityLog("auto-ending session after 60m inactivity");
    await abortVoiceCapture();
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
      console.error("[TutorSessionRunner autoEndFromInactivity]", e);
      setEndError("Session timed out but could not auto-end. Use End session.");
      setEndingSession(false);
      autoEndTriggeredRef.current = false;
    }
  }, [abortVoiceCapture, endingSession, initial.id, router]);

  const submitTurn = useCallback(
    async (utterance: string, opts?: { system?: boolean }) => {
      const text = utterance.trim();
      if (!text || submitting) return;
      if (sessionPausedRef.current && !opts?.system) {
        await resumeSessionQuiet();
      }
      const isSystem = opts?.system === true || isSystemUtterance(text);
      const explicitNotesRequest =
        !isSystem && studentRequestedNotesSave(text);
      const autoGenerateNotes = autoGenerateNotesRef.current;
      setComposer("");
      setSubmitting(true);
      if (!isSystem) {
        lastStudentActivityRef.current = Date.now();
        checkInsSentRef.current = 0;
        inactivityLog("student activity — reset check-in counter");
      }
      // Append user bubble only for real student turns.
      const userMsg: LocalMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: text,
      };
      const assistantId = `a-${Date.now()}`;
      const assistantMsg: LocalMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        streaming: true,
      };
      setMessages((prev) =>
        isSystem
          ? [...prev, assistantMsg]
          : [...prev, userMsg, assistantMsg]
      );
      if (isSystem) {
        inactivityLog("system turn started", {
          preview: text.slice(0, 72),
        });
      } else {
        setSessionBooting(false);
      }
      revealedSentencesRef.current = [];

      // Sentence pump for TTS — consumes deltas as they form.
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

      // §12 — Live caption sync. Captions are appended to the
      // assistant bubble ONLY when the matching sentence is actually
      // being spoken. When TTS fails for a particular sentence we
      // still reveal it (info.failed === true) so the student isn't
      // staring at an empty bubble.
      voice
        .speakSentenceStream(sentenceIterable, {
          onSentencePlaying: (sentence) => {
            const s = sentence.trim();
            if (!s) return;
            revealedSentencesRef.current = [
              ...revealedSentencesRef.current,
              s,
            ];
            const revealed = revealedSentencesRef.current.join(" ");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: revealed } : m
              )
            );
          },
        })
        .catch((e) => {
          console.error("[TutorSessionRunner speakSentenceStream]", e);
        });

      // SSE stream.
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

      let turnIntent = "other";

      try {
        const res = await fetch(
          `/api/tutor-session/${initial.id}/turn-stream`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              utterance: text,
              autoGenerateNotes: autoGenerateNotes && !isSystem,
              explicitNotesRequest,
              systemTurn: isSystem,
            }),
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
                  // §12 — Do NOT update the bubble's content here.
                  // The onSentencePlaying callback drives reveal in
                  // lockstep with TTS playback.
                  flushSentences(false);
                }
              } catch {
                /* ignore */
              }
            } else if (event === "meta") {
              try {
                const parsed = JSON.parse(data) as {
                  intent?: string;
                  imageRequest?: {
                    query?: string;
                    type?: string;
                  } | null;
                };
                if (typeof parsed.intent === "string") {
                  turnIntent = parsed.intent;
                }
                const ir = parsed.imageRequest;
                if (ir && typeof ir.query === "string") {
                  const t =
                    ir.type === "diagram" || ir.type === "photo"
                      ? ir.type
                      : "illustration";
                  void fetchImageForMessage(assistantId, ir.query, t);
                }
              } catch {
                /* ignore malformed meta */
              }
            } else if (event === "done") {
              break;
            } else if (event === "error") {
              throw new Error("Stream error");
            }
          }
        }
        flushSentences(true);
        streamDone = true;
        const finalContent =
          revealedSentencesRef.current.length > 0
            ? revealedSentencesRef.current.join(" ")
            : buffered.trim();
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m
          )
        );
        if (isSystem) {
          setSessionBooting(false);
          inactivityLog("system turn finished");
        }
        if (
          !isSystem &&
          finalContent.length > 40 &&
          (explicitNotesRequest ||
            (autoGenerateNotes &&
              (turnIntent === "teach" ||
                turnIntent === "answer" ||
                turnIntent === "clarify")))
        ) {
          const studentUtterance = isSystem ? undefined : text.trim();
          void synthesizeAndAppendNotes(
            assistantId,
            finalContent,
            studentUtterance || undefined
          );
        }
      } catch (e) {
        console.error("[TutorSessionRunner submitTurn]", e);
        streamDone = true;
        // Fallback: if we never revealed anything (TTS never fired
        // either), show the raw buffer so the student isn't stuck.
        const fallback =
          revealedSentencesRef.current.length === 0
            ? buffered.trim() ||
              "Sorry — I hit a snag. Try saying that again."
            : revealedSentencesRef.current.join(" ");
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  content: fallback,
                }
              : m
          )
        );
        if (isSystem) setSessionBooting(false);
      } finally {
        setSubmitting(false);
      }
    },
    [
      appendNotesBlock,
      fetchImageForMessage,
      initial.id,
      initial.title,
      resumeSessionQuiet,
      submitting,
      synthesizeAndAppendNotes,
      voice,
    ]
  );

  // ----- mid-session uploads -----
  // Posts files to /api/tutor-session/:id/upload (same extraction
  // pipeline as /start), then injects a synthetic instruction so
  // Rose actually says something about the new material.
  const handleUploadFiles = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      if (uploading) return;
      setUploading(true);
      try {
        const form = new FormData();
        const names: string[] = [];
        for (let i = 0; i < fileList.length; i += 1) {
          const f = fileList.item(i);
          if (!f) continue;
          form.append("files", f);
          names.push(f.name);
        }
        if (names.length === 0) return;
        const res = await fetch(
          `/api/tutor-session/${initial.id}/upload`,
          { method: "POST", body: form }
        );
        if (!res.ok) {
          const errBody = (await res
            .json()
            .catch(() => ({ error: "Upload failed." }))) as {
            error?: string;
          };
          throw new Error(errBody.error ?? "Upload failed.");
        }
        const body = (await res.json()) as {
          uploads: TutorSessionUpload[];
          failed: string[];
        };
        setUploads((prev) => [...prev, ...body.uploads]);
        if (body.failed.length > 0) {
          const failMsg: LocalMessage = {
            id: `sys-fail-${Date.now()}`,
            role: "assistant",
            content: `(I had trouble reading ${body.failed.join(
              ", "
            )} — can you describe what's in it or try a clearer photo?)`,
          };
          setMessages((prev) => [...prev, failMsg]);
        }
        if (body.uploads.length > 0) {
          const trigger = `[The student just attached: ${names.join(
            ", "
          )}. Look at it briefly and react in one or two sentences — acknowledge what you see, ask what they want to do with it.]`;
          void submitTurn(trigger, { system: true });
        }
      } catch (e) {
        console.error("[TutorSessionRunner handleUploadFiles]", e);
        const errMsg: LocalMessage = {
          id: `sys-err-${Date.now()}`,
          role: "assistant",
          content: "(Couldn't upload that — try again in a sec.)",
        };
        setMessages((prev) => [...prev, errMsg]);
      } finally {
        setUploading(false);
        if (midUploadInputRef.current) midUploadInputRef.current.value = "";
      }
    },
    [initial.id, submitTurn, uploading]
  );

  // ----- "+ Add to notes" — synthesize structured notes from Rose's reply -----
  const addMessageToNotes = useCallback(
    async (msg: LocalMessage) => {
      const trimmed = msg.content.trim();
      if (!trimmed) return;

      const msgs = messagesRef.current;
      const msgIdx = msgs.findIndex((m) => m.id === msg.id);
      const priorStudent =
        msgIdx > 0
          ? [...msgs.slice(0, msgIdx)]
              .reverse()
              .find((m) => m.role === "user" && m.content.trim())
          : undefined;

      setAddedNoteIds((prev) => new Set(prev).add(msg.id));

      const ok = await synthesizeAndAppendNotes(
        `manual-${msg.id}`,
        trimmed,
        priorStudent?.content,
        { skipDedupe: true }
      );

      if (!ok) {
        setAddedNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
        return;
      }

      window.setTimeout(() => {
        setAddedNoteIds((prev) => {
          const next = new Set(prev);
          next.delete(msg.id);
          return next;
        });
      }, 2000);
    },
    [synthesizeAndAppendNotes]
  );

  // ----- inactivity check-ins + auto-end -----
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (endingSession || autoEndTriggeredRef.current) return;
      if (submitting || voice.state.speaking) return;

      const now = Date.now();
      const silentMs = now - lastStudentActivityRef.current;
      const checkIns = checkInsSentRef.current;

      if (silentMs >= INACTIVITY_AUTO_END_MS) {
        inactivityLog("threshold reached — auto end", { silentMs, checkIns });
        void autoEndFromInactivity();
        return;
      }

      if (sessionPausedRef.current) return;

      if (checkIns === 0 && silentMs >= INACTIVITY_GENTLE_CHECK_IN_MS) {
        checkInsSentRef.current = 1;
        inactivityLog("gentle check-in", { silentMs });
        void deliverRoseMessage(GENTLE_CHECK_IN_TEXT);
        return;
      }

      if (checkIns === 1 && silentMs >= INACTIVITY_FINAL_PAUSE_MS) {
        checkInsSentRef.current = 2;
        inactivityLog("final check-in + pause", { silentMs });
        void deliverRoseMessage(FINAL_CHECK_IN_TEXT, { thenPause: true });
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [
    autoEndFromInactivity,
    deliverRoseMessage,
    endingSession,
    submitting,
    voice.state.speaking,
  ]);

  // ----- LIVE mode: tap mic OR barge-in → record till silence -----
  // Used when voiceMode === "live". Stops Rose if she's speaking,
  // captures until the student goes silent, transcribes, submits.
  const startLiveCapture = useCallback(async () => {
    if (voiceModeRef.current !== "live") return;
    const epoch = voiceCaptureEpochRef.current;
    voice.cancelSpeak();
    const blob = await voice.recordUntilSilence();
    if (epoch !== voiceCaptureEpochRef.current) return;
    if (voiceModeRef.current !== "live") return;
    if (!blob) return;
    const text = await voice.transcribe(blob);
    if (epoch !== voiceCaptureEpochRef.current) return;
    if (voiceModeRef.current !== "live") return;
    if (text) void submitTurn(text);
  }, [submitTurn, voice]);

  // ----- PUSH mode: hold-to-talk (mic button mousedown/up or M key) -----
  // Used when voiceMode === "push". The student presses-and-holds;
  // we record without silence detection, stop on release, transcribe
  // & submit. Cancels any ongoing speech.
  const recordPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const pushStartVoiceAnswer = useCallback(async () => {
    if (submitting) return;
    if (voice.state.recording) return;
    voice.cancelSpeak();
    recordPromiseRef.current = voice.startRecording();
  }, [submitting, voice]);
  const pushFinishVoiceAnswer = useCallback(async () => {
    const promise = recordPromiseRef.current;
    if (!promise) return;
    recordPromiseRef.current = null;
    await voice.stopRecording();
    const blob = await promise;
    if (!blob) return;
    const text = await voice.transcribe(blob);
    if (text) void submitTurn(text);
  }, [submitTurn, voice]);

  // Single mic-button handler — branches on voiceMode. Live = tap to
  // record-till-silence. Push = used as a fallback "tap to start" but
  // the natural gesture in push mode is hold-down on the button (see
  // mousedown/up handlers in the JSX below) or hold-M on the keyboard.
  const onMicTap = useCallback(() => {
    if (voiceMode === "live") {
      void startLiveCapture();
    } else {
      void startLiveCapture(); // tap still works as a fallback
    }
  }, [startLiveCapture, voiceMode]);

  // Barge-in callback — only fires when bargeInEnabled (i.e. live
  // mode). Routes straight to the live capture path.
  useEffect(() => {
    onBargeInRef.current = () => {
      if (voiceMode !== "live") return;
      void startLiveCapture();
    };
  }, [startLiveCapture, voiceMode]);

  // ----- hold M to talk (push mode only) -----
  const mDownRef = useRef(false);
  useEffect(() => {
    if (voiceMode !== "push") return;
    const isTextTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el.isContentEditable
      );
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextTarget(e.target)) return;
      e.preventDefault();
      if (mDownRef.current) return;
      mDownRef.current = true;
      void pushStartVoiceAnswer();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (!mDownRef.current) return;
      mDownRef.current = false;
      void pushFinishVoiceAnswer();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [pushFinishVoiceAnswer, pushStartVoiceAnswer, voiceMode]);

  // ----- live mode: auto-listen after Rose finishes -----
  useEffect(() => {
    if (voiceMode !== "live") return;
    if (sessionPausedRef.current) return;
    if (sessionBooting) return;
    if (voice.state.speaking) return;
    if (voice.state.recording) return;
    if (voice.state.transcribing) return;
    if (submitting) return;
    if (liveCycleGuardRef.current) return;
    // Don't auto-listen until Rose has had a chance to greet at
    // least once — otherwise we kick the mic open before greetedRef
    // even runs.
    if (messagesRef.current.length === 0) return;
    liveCycleGuardRef.current = true;
    const epoch = voiceCaptureEpochRef.current;
    (async () => {
      try {
        const blob = await voice.recordUntilSilence();
        if (epoch !== voiceCaptureEpochRef.current) return;
        if (voiceModeRef.current !== "live") return;
        if (!blob) return;
        const text = await voice.transcribe(blob);
        if (epoch !== voiceCaptureEpochRef.current) return;
        if (voiceModeRef.current !== "live") return;
        if (!text) return;
        void submitTurn(text);
      } catch (e) {
        console.error("[TutorSessionRunner live mode]", e);
      } finally {
        if (epoch === voiceCaptureEpochRef.current) {
          liveCycleGuardRef.current = false;
        }
      }
    })();
  }, [
    submitting,
    voice,
    voice.state.recording,
    voice.state.speaking,
    voice.state.transcribing,
    voiceMode,
    submitTurn,
    sessionBooting,
  ]);

  const resumeSessionWithWelcome = useCallback(async () => {
    if (endingSession) return;
    try {
      const res = await fetch(`/api/tutor-session/${initial.id}/resume`, {
        method: "POST",
      });
      if (!res.ok) return;
      sessionPausedRef.current = false;
      setSessionPaused(false);
      checkInsSentRef.current = 0;
      lastStudentActivityRef.current = Date.now();
      inactivityLog("session resumed with welcome");
      const topic =
        initial.topic?.trim() || initial.title?.trim() || "your topic";
      await deliverRoseMessage(
        `Welcome back! We were talking about ${topic} — want to keep going from there?`
      );
    } catch (e) {
      console.error("[TutorSessionRunner resumeSessionWithWelcome]", e);
    }
  }, [deliverRoseMessage, endingSession, initial.id, initial.title, initial.topic]);

  // ----- opening greeting (once, if transcript empty) -----
  const greetedRef = useRef(false);
  useEffect(() => {
    if (greetedRef.current) return;
    if ((initial.transcript ?? []).length > 0) {
      setSessionBooting(false);
      return;
    }
    if (sessionPausedRef.current) {
      setSessionBooting(false);
      return;
    }
    greetedRef.current = true;
    inactivityLog("session-start firing opening greeting");
    const opener = initial.topic
      ? `[Session starting. The student wrote: "${initial.topic}". Greet them, briefly acknowledge it, and ask what they want to dig into first.]`
      : initial.referenceSummary
        ? `[Session starting. The student has uploaded reference material. Greet them warmly, mention what you can see in the materials in one sentence, and ask what they want to focus on first.]`
        : `[Session starting. The student hasn't given a topic yet. Greet them warmly and ask what they'd like to work on.]`;
    const t = window.setTimeout(() => {
      void submitTurn(opener, { system: true });
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
    await abortVoiceCapture();
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
  }, [abortVoiceCapture, endingSession, initial.id, messages.length, router]);

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
    <main className="bg-app-gradient flex h-[calc(100dvh-4rem)] flex-col overflow-hidden">
      {/* Sub-header: title + timer + end button */}
      <div className="shrink-0 border-b border-white/60 bg-white/70 px-4 py-3 backdrop-blur-md sm:px-6">
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
            {uploads.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowMaterialsDrawer(true)}
                className="hidden items-center gap-1 rounded-full border border-violet-200 bg-white/80 px-2.5 py-1 text-[11px] font-medium text-violet-800 hover:bg-violet-50 sm:inline-flex"
                title="View attached reference materials"
              >
                <span aria-hidden>📎</span>
                {uploads.length} material{uploads.length === 1 ? "" : "s"}
              </button>
            ) : null}
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
        {sessionPaused ? (
          <div className="mx-auto mt-2 max-w-6xl rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-950">
            <p className="font-medium">
              Session paused — you can resume anytime from here or your
              Sessions library.
            </p>
            <button
              type="button"
              onClick={() => void resumeSessionWithWelcome()}
              className="mt-2 inline-flex items-center rounded-full bg-amber-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-800"
            >
              Resume session
            </button>
          </div>
        ) : null}
      </div>

      {/* True 50/50 split at xl (1280px+) — same treatment as the
          Mentored Learning page. Both columns are minmax(0, 1fr) so
          the conversation feed and the notes panel match width
          exactly. Below xl the notes panel hides and the chat takes
          the full width (notes are reachable later from the recap). */}
      <div className="mx-auto grid w-full max-w-[84rem] min-h-0 flex-1 grid-cols-1 gap-4 px-3 py-4 xl:grid-cols-2 xl:gap-8 xl:px-6">
        {/* Left — conversation */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-white/60 bg-white/85 shadow-lg shadow-zinc-900/[0.05] ring-1 ring-white/50 backdrop-blur-md">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6 sm:py-7"
          >
            {(initial.referenceSummary || uploads.length > 0) ? (
              <UploadsRibbon
                uploads={uploads}
                onClick={() => setShowMaterialsDrawer(true)}
              />
            ) : null}
            {sessionBooting && messages.length === 0 ? (
              <p className="text-center text-sm text-zinc-400">
                Rose is getting ready…
              </p>
            ) : null}
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onAddToNotes={() => addMessageToNotes(m)}
                addedRecently={addedNoteIds.has(m.id)}
              />
            ))}
            {recordingHint ? (
              <p className="text-center text-[11px] font-medium text-violet-700">
                {recordingHint}
              </p>
            ) : null}
          </div>

          {/* Voice dock */}
          <div className="border-t border-white/50 bg-white/70 px-3 py-3 sm:px-5">
            {/* Voice-mode toggle — push (hold M / mic) vs live (auto-listen). */}
            <div className="mb-2 flex items-center justify-between gap-2">
              <div
                className="inline-flex items-stretch rounded-2xl border border-zinc-200 bg-white p-0.5 text-[11px] font-medium text-zinc-700 shadow-sm"
                role="group"
                aria-label="Voice mic mode"
              >
                <button
                  type="button"
                  onClick={() => updateVoiceMode("push")}
                  aria-pressed={voiceMode === "push"}
                  className={
                    voiceMode === "push"
                      ? "rounded-xl bg-zinc-900 px-3 py-1 text-white shadow-sm"
                      : "rounded-xl px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                  }
                  title="Press and hold M or the mic button to speak"
                >
                  Hold&nbsp;M
                </button>
                <button
                  type="button"
                  onClick={() => updateVoiceMode("live")}
                  aria-pressed={voiceMode === "live"}
                  className={
                    voiceMode === "live"
                      ? "rounded-xl bg-zinc-900 px-3 py-1 text-white shadow-sm"
                      : "rounded-xl px-3 py-1 text-zinc-700 hover:bg-zinc-50"
                  }
                  title="Rose listens automatically after she finishes speaking"
                >
                  Live
                </button>
              </div>
              <span className="text-[10px] uppercase tracking-[0.14em] text-zinc-400">
                {voiceMode === "live"
                  ? "Auto-listen on · barge-in to interrupt"
                  : "Press and hold M or the mic button to speak"}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={voiceMode === "live" ? onMicTap : undefined}
                onMouseDown={
                  voiceMode === "push"
                    ? (e) => {
                        e.preventDefault();
                        void pushStartVoiceAnswer();
                      }
                    : undefined
                }
                onMouseUp={
                  voiceMode === "push"
                    ? () => void pushFinishVoiceAnswer()
                    : undefined
                }
                onMouseLeave={
                  voiceMode === "push"
                    ? () => {
                        if (voice.state.recording) {
                          void pushFinishVoiceAnswer();
                        }
                      }
                    : undefined
                }
                onTouchStart={
                  voiceMode === "push"
                    ? (e) => {
                        e.preventDefault();
                        void pushStartVoiceAnswer();
                      }
                    : undefined
                }
                onTouchEnd={
                  voiceMode === "push"
                    ? (e) => {
                        e.preventDefault();
                        void pushFinishVoiceAnswer();
                      }
                    : undefined
                }
                disabled={submitting || voice.state.transcribing}
                aria-label={
                  voiceMode === "push" ? "Hold to speak" : "Tap to speak"
                }
                title={
                  voiceMode === "push"
                    ? "Hold (or press M) to speak"
                    : "Tap to speak — Rose listens until you go quiet"
                }
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
              <input
                ref={midUploadInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.md"
                multiple
                className="sr-only"
                onChange={(e) => void handleUploadFiles(e.target.files)}
                disabled={uploading}
              />
              <button
                type="button"
                onClick={() => midUploadInputRef.current?.click()}
                disabled={uploading || submitting}
                aria-label="Attach reference material"
                title="Attach reference material"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 disabled:opacity-50"
              >
                {uploading ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5 animate-spin"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    aria-hidden
                  >
                    <circle cx="12" cy="12" r="9" opacity="0.25" />
                    <path d="M21 12a9 9 0 0 1-9 9" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 1 1-8.49-8.49l9.19-9.19a4 4 0 1 1 5.66 5.66l-9.2 9.19a2 2 0 1 1-2.83-2.83l8.49-8.48" />
                  </svg>
                )}
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
                placeholder={
                  sessionPaused
                    ? "Type to resume, or use the Resume button above…"
                    : "Type or hit the mic to talk…"
                }
                rows={1}
                className="min-h-[44px] flex-1 resize-none rounded-2xl border border-zinc-200 bg-white px-4 py-2.5 text-sm leading-relaxed text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-200"
                disabled={submitting || endingSession}
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

        {/* Right — notes panel (fills column height; transcript scrolls independently) */}
        <div className="hidden min-h-0 min-w-0 xl:block">
          <div className="h-full min-h-0">
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
              autoGenerate={autoGenerateNotes}
              onAutoGenerateChange={handleAutoGenerateChange}
              onAutoGenerateUserToggle={handleAutoGenerateUserToggle}
              onEditorReady={() => setNotesEditorReady(true)}
              editorRef={notesPanelRef}
              className="h-full min-h-0"
            />
          </div>
        </div>
      </div>

      {showMaterialsDrawer ? (
        <MaterialsDrawer
          uploads={uploads}
          onClose={() => setShowMaterialsDrawer(false)}
        />
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MessageBubble({
  message,
  onAddToNotes,
  addedRecently,
}: {
  message: LocalMessage;
  onAddToNotes: () => void;
  addedRecently: boolean;
}) {
  const isUser = message.role === "user";
  const display = message.content;
  const canAddToNotes =
    !isUser && !message.streaming && message.content.trim().length > 12;
  return (
    <div
      className={`group flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className="max-w-[85%]">
        <div
          className={`rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ring-1 ${
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

          {message.image ? (
            <a
              href={message.image.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
              title={`Source: ${message.image.attribution}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={message.image.thumbUrl || message.image.url}
                alt=""
                loading="lazy"
                className="h-auto w-full"
              />
              <p className="px-2 py-1 text-[10px] text-zinc-500">
                {message.image.attribution}
              </p>
            </a>
          ) : null}
        </div>

        {canAddToNotes ? (
          <div className="mt-1.5 flex justify-start">
            <button
              type="button"
              onClick={onAddToNotes}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition ${
                addedRecently
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-zinc-200 bg-white/80 text-zinc-500 opacity-0 hover:border-violet-300 hover:text-violet-700 group-hover:opacity-100"
              }`}
              title="Add to notes"
            >
              <span aria-hidden>{addedRecently ? "✓" : "+"}</span>
              {addedRecently ? "Added" : "Add to notes"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function UploadsRibbon({
  uploads,
  onClick,
}: {
  uploads: { id: string; fileName: string; fileKind: string }[];
  onClick: () => void;
}) {
  if (uploads.length === 0) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex w-full flex-wrap items-center gap-1.5 rounded-2xl border border-violet-100 bg-violet-50/60 px-3 py-2 text-left text-[11px] text-violet-900 transition hover:bg-violet-100/60"
      title="View attached reference materials"
    >
      <span className="font-semibold uppercase tracking-wider text-violet-700">
        📎 Attached:
      </span>
      {uploads.slice(0, 4).map((u) => (
        <span
          key={u.id}
          className="rounded-full border border-violet-200 bg-white px-2 py-0.5 text-violet-900"
          title={u.fileKind}
        >
          {u.fileName}
        </span>
      ))}
      {uploads.length > 4 ? (
        <span className="text-violet-700">+{uploads.length - 4} more</span>
      ) : null}
    </button>
  );
}

function MaterialsDrawer({
  uploads,
  onClose,
}: {
  uploads: TutorSessionUpload[];
  onClose: () => void;
}) {
  // Trap-and-close drawer. Renders a backdrop + a right-aligned
  // panel listing each upload with its AI-generated summary so the
  // student remembers what Rose has in context.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-zinc-950/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-700">
              Reference Materials
            </p>
            <h2 className="text-base font-semibold text-zinc-900">
              What Rose can see
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-zinc-500 hover:bg-zinc-100"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 6l12 12M18 6l-12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {uploads.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No materials attached. Drop a file from the paperclip
              button below the conversation to give Rose more context.
            </p>
          ) : (
            <ul className="space-y-3">
              {uploads.map((u) => (
                <li
                  key={u.id}
                  className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3"
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden>
                      {u.fileKind === "pdf"
                        ? "📄"
                        : u.fileKind === "image"
                          ? "🖼️"
                          : "📝"}
                    </span>
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      {u.fileName}
                    </p>
                  </div>
                  {u.summary ? (
                    <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">
                      {u.summary}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
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
