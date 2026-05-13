"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import type { StudyChatResponse, StudyChatTurn } from "@/types/study-chat";

type InputMode = "hold" | "tap" | "live";

type LivePhase = "off" | "listening" | "recording" | "thinking" | "speaking";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];

// Voice Activity Detection tuning. RMS is on the 0..1 range of the
// time-domain signal centered around 0. These are deliberately permissive
// so short / quiet utterances like "hello" still register.
const SPEECH_RMS = 0.025;
const SILENCE_RMS = 0.014;
const MIN_SPEECH_MS = 150;

// How long the user can stay quiet before we treat the utterance as
// finished. This is user-adjustable via the "Pause" slider; the constants
// below define the slider bounds + default starting value.
const DEFAULT_PAUSE_MS = 3000;
const PAUSE_MIN_MS = 500;
const PAUSE_MAX_MS = 5000;
const PAUSE_STEP_MS = 250;
// While the assistant is talking the mic is still open. We require a slightly
// longer / louder signal before counting it as a real barge-in so room noise
// and the assistant's own voice (after echo cancellation) don't trip it.
const BARGE_IN_RMS = 0.07;
const BARGE_IN_MS = 240;
// How often we fire a speculative transcription while the user is speaking,
// so by the time they stop we already have (most of) the transcript.
const SPEC_INTERVAL_MS = 900;
const SPEC_MIN_BLOB_BYTES = 4 * 1024;

type Props = {
  materialId: string;
  moduleId: number;
  quizOpen: boolean;
  /** Reserved for per-course cloned voices (TTS route already accepts it). */
  courseId?: string;
  studyHrefBase?: string;
  learnMode?: boolean;
  variant?: "course" | "legacy";
  docked?: boolean;
};

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const MR = MediaRecorder;
  if (MR.isTypeSupported("audio/webm;codecs=opus")) {
    return "audio/webm;codecs=opus";
  }
  if (MR.isTypeSupported("audio/webm")) return "audio/webm";
  return undefined;
}

function stopPlayback(audioRef: MutableRefObject<HTMLAudioElement | null>) {
  const a = audioRef.current;
  if (a) {
    try {
      a.pause();
    } catch {
      /* ignore */
    }
    a.src = "";
    audioRef.current = null;
  }
}

export function VoiceTutorDock({
  materialId,
  moduleId,
  quizOpen,
  courseId,
  studyHrefBase,
  learnMode = false,
  variant = "course",
  docked = false,
}: Props) {
  const router = useRouter();
  const [inputMode, setInputMode] = useState<InputMode>("hold");
  const [tapRecording, setTapRecording] = useState(false);
  const [holdRecording, setHoldRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const [livePhase, setLivePhaseState] = useState<LivePhase>("off");
  const [pauseMs, setPauseMs] = useState<number>(DEFAULT_PAUSE_MS);

  const messagesRef = useRef<StudyChatTurn[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackRateRef = useRef<PlaybackRate>(1);
  const pauseMsRef = useRef<number>(DEFAULT_PAUSE_MS);
  useEffect(() => {
    pauseMsRef.current = pauseMs;
  }, [pauseMs]);

  // Live-mode / VAD plumbing
  const liveModeRef = useRef<boolean>(false);
  const livePhaseRef = useRef<LivePhase>("off");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const analyserSourceRef =
    useRef<MediaStreamAudioSourceNode | null>(null);
  const vadIntervalRef = useRef<number | null>(null);
  const vadBufRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const speechStartedAtRef = useRef<number>(0);
  const silenceStartedAtRef = useRef<number>(0);
  const bargeStartedAtRef = useRef<number>(0);
  const cancelPlaybackRef = useRef<(() => void) | null>(null);

  // Speculative transcription state — we transcribe in chunks while the user
  // is still speaking so the assistant can start thinking the instant they go
  // quiet, instead of waiting for one big transcribe at the end.
  const specAbortRef = useRef<AbortController | null>(null);
  const specPendingRef = useRef<Promise<void> | null>(null);
  const specLatestTextRef = useRef<string>("");
  const specLastFiredAtRef = useRef<number>(0);
  const finalSpecRequestedRef = useRef<boolean>(false);
  // Guards against the VAD interval double-firing startLiveRecording while
  // the previous call is still awaiting startRecording().
  const startingRecordingRef = useRef<boolean>(false);

  const setLivePhase = useCallback((p: LivePhase) => {
    livePhaseRef.current = p;
    setLivePhaseState(p);
  }, []);

  const setPlaybackRate = useCallback((r: PlaybackRate) => {
    playbackRateRef.current = r;
    setPlaybackRateState(r);
    const a = audioRef.current;
    if (a) {
      try {
        a.playbackRate = r;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const ensureStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current && streamRef.current.active) {
      return streamRef.current;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamRef.current = stream;
    return stream;
  }, []);

  const releaseStream = useCallback(() => {
    const s = streamRef.current;
    streamRef.current = null;
    s?.getTracks().forEach((t) => t.stop());
  }, []);

  const endRecorder = useCallback(() => {
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
  }, []);

  const cleanupRecorder = useCallback(async () => {
    startPromiseRef.current = null;
    endRecorder();
    if (!liveModeRef.current) releaseStream();
  }, [endRecorder, releaseStream]);

  const finalizeBlob = useCallback((): Promise<Blob> => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current;
      if (!mr) {
        resolve(new Blob([], { type: "audio/webm" }));
        return;
      }
      stopResolverRef.current = resolve;
      if (mr.state !== "inactive") {
        try {
          mr.stop();
        } catch {
          stopResolverRef.current = null;
          resolve(
            new Blob(chunksRef.current, {
              type: mr.mimeType || "audio/webm",
            })
          );
        }
      } else {
        const r = stopResolverRef.current;
        stopResolverRef.current = null;
        r?.(
          new Blob(chunksRef.current, {
            type: mr.mimeType || "audio/webm",
          })
        );
      }
    });
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    if (!liveModeRef.current) {
      stopPlayback(audioRef);
    }
    endRecorder();

    const mimeType = pickMimeType();
    const stream = await ensureStream();

    const mr = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    chunksRef.current = [];
    mr.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    mr.onstop = () => {
      const resolve = stopResolverRef.current;
      stopResolverRef.current = null;
      const blob = new Blob(chunksRef.current, {
        type: mr.mimeType || mimeType || "audio/webm",
      });
      resolve?.(blob);
    };

    mediaRecorderRef.current = mr;
    mr.start(120);
  }, [endRecorder, ensureStream]);

  const playMp3 = useCallback(async (buf: ArrayBuffer) => {
    stopPlayback(audioRef);
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    const a = new Audio(url);
    try {
      a.playbackRate = playbackRateRef.current;
    } catch {
      /* ignore */
    }
    audioRef.current = a;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (
        kind: "ended" | "cancelled" | "error",
        err?: unknown
      ) => {
        if (settled) return;
        settled = true;
        cancelPlaybackRef.current = null;
        URL.revokeObjectURL(url);
        if (kind === "error") reject(err ?? new Error("Audio playback failed"));
        else resolve();
      };
      a.onended = () => finish("ended");
      a.onerror = () => finish("error");
      cancelPlaybackRef.current = () => {
        try {
          a.pause();
        } catch {
          /* ignore */
        }
        a.src = "";
        if (audioRef.current === a) audioRef.current = null;
        finish("cancelled");
      };
      void a.play().catch((e) => finish("error", e));
    });
  }, []);

  const applyNavigation = useCallback(
    (action: unknown) => {
      if (variant !== "course") return;
      if (
        !action ||
        typeof action !== "object" ||
        typeof studyHrefBase !== "string" ||
        studyHrefBase.length === 0
      ) {
        return;
      }
      const t = (action as { type?: unknown }).type;
      if (t !== "navigate_to_module" && t !== "navigate_to_location") return;

      const targetModule = (action as { moduleId?: unknown }).moduleId;
      const targetMaterial =
        t === "navigate_to_location" &&
        typeof (action as { materialId?: unknown }).materialId === "string"
          ? (action as { materialId: string }).materialId
          : materialId;
      if (typeof targetModule !== "number" || !Number.isFinite(targetModule)) {
        return;
      }
      const p = new URLSearchParams();
      p.set("material", targetMaterial);
      p.set("module", String(targetModule));
      if (learnMode) p.set("mode", "learn");
      router.push(`${studyHrefBase}?${p.toString()}`);
    },
    [learnMode, materialId, router, studyHrefBase, variant]
  );

  const runChatAndTts = useCallback(
    async (transcript: string) => {
      const prev = messagesRef.current;
      const nextMessages: StudyChatTurn[] = [
        ...prev,
        { role: "user", content: transcript },
      ];
      messagesRef.current = nextMessages;

      const chatRes = await fetch("/api/study-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          moduleId,
          quizOpen,
          messages: nextMessages,
        }),
      });
      const chatBody = (await chatRes.json().catch(() => ({}))) as Partial<
        StudyChatResponse
      > & { error?: string };

      if (!chatRes.ok) {
        setError(
          typeof chatBody.error === "string"
            ? chatBody.error
            : "Tutor could not answer."
        );
        messagesRef.current = prev;
        return;
      }

      const reply = chatBody.reply;
      if (typeof reply !== "string" || !reply.trim()) {
        setError("Bad tutor response.");
        messagesRef.current = prev;
        return;
      }

      const trimmed = reply.trim();
      messagesRef.current = [
        ...nextMessages,
        { role: "assistant", content: trimmed },
      ];

      applyNavigation(chatBody.action ?? null);

      const ttsRes = await fetch("/api/voice-tutor/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          materialId,
          ...(courseId ? { courseId } : {}),
        }),
      });

      if (!ttsRes.ok) {
        const tb = (await ttsRes.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(
          typeof tb.error === "string"
            ? tb.error
            : "Could not play voice response. The written answer is still saved in this session."
        );
        return;
      }

      const audioBuf = await ttsRes.arrayBuffer();
      if (liveModeRef.current) setLivePhase("speaking");
      await playMp3(audioBuf);
    },
    [
      applyNavigation,
      courseId,
      materialId,
      moduleId,
      playMp3,
      quizOpen,
      setLivePhase,
    ]
  );

  const transcribeBlob = useCallback(
    async (blob: Blob): Promise<string | null> => {
      if (blob.size < 256) return null;
      const fd = new FormData();
      fd.append("materialId", materialId);
      fd.append(
        "file",
        new File([blob], "speech.webm", {
          type: blob.type || "audio/webm",
        })
      );
      try {
        const r = await fetch("/api/voice-tutor/transcribe", {
          method: "POST",
          body: fd,
        });
        if (!r.ok) return null;
        const j = (await r.json()) as { text?: string };
        return typeof j.text === "string" ? j.text.trim() : null;
      } catch {
        return null;
      }
    },
    [materialId]
  );

  const runVoiceStream = useCallback(
    async (transcript: string) => {
      if (!transcript) {
        setError(
          "Didn't catch that — try speaking a little louder or closer to the mic."
        );
        return;
      }

      setBusy(true);
      setError(null);
      if (liveModeRef.current) setLivePhase("thinking");

      const prev = messagesRef.current;
      const nextMessages: StudyChatTurn[] = [
        ...prev,
        { role: "user", content: transcript },
      ];
      messagesRef.current = nextMessages;

      // Cancellation for barge-in or mode-switch.
      let cancelled = false;
      let currentAudio: HTMLAudioElement | null = null;
      const ttsControllers: AbortController[] = [];
      const cancelAll = () => {
        cancelled = true;
        if (currentAudio) {
          try {
            currentAudio.pause();
          } catch {
            /* ignore */
          }
          currentAudio.src = "";
          if (audioRef.current === currentAudio) audioRef.current = null;
          currentAudio = null;
        }
        for (const c of ttsControllers) {
          try {
            c.abort();
          } catch {
            /* ignore */
          }
        }
        ttsControllers.length = 0;
      };
      cancelPlaybackRef.current = cancelAll;

      // Pre-fetch TTS the instant we have text, then play in order.
      // Key insight: the fetch for chunk N+1 must start while chunk N is
      // *playing*, not after it finishes. We do that by kicking off the
      // fetch immediately on enqueue and storing the promise; the playback
      // queue only awaits the already-in-flight result.
      let firstAudioStarted = false;

      const fetchTts = (text: string, ctrl: AbortController): Promise<ArrayBuffer | null> =>
        fetch("/api/voice-tutor/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            materialId,
            ...(courseId ? { courseId } : {}),
          }),
          signal: ctrl.signal,
        })
          .then((r) => (r.ok ? r.arrayBuffer() : null))
          .catch(() => null);

      const playBuffer = async (buf: ArrayBuffer): Promise<void> => {
        if (cancelled) return;
        await new Promise<void>((resolve) => {
          const url = URL.createObjectURL(
            new Blob([buf], { type: "audio/mpeg" })
          );
          const a = new Audio(url);
          try {
            a.playbackRate = playbackRateRef.current;
          } catch {
            /* ignore */
          }
          currentAudio = a;
          audioRef.current = a;
          const cleanup = () => {
            URL.revokeObjectURL(url);
            if (currentAudio === a) currentAudio = null;
            if (audioRef.current === a) audioRef.current = null;
            resolve();
          };
          a.onended = cleanup;
          a.onerror = cleanup;
          void a.play()
            .then(() => {
              if (!firstAudioStarted && liveModeRef.current && !cancelled) {
                firstAudioStarted = true;
                setLivePhase("speaking");
              }
            })
            .catch(cleanup);
        });
      };

      // Each item in the queue is a pre-started TTS promise so the fetch
      // overlaps with playback of the previous chunk.
      type QueueItem = { bufPromise: Promise<ArrayBuffer | null> };
      const queue: QueueItem[] = [];
      let playbackTail: Promise<void> = Promise.resolve();

      const enqueueSentence = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        // Fire the TTS fetch NOW so it runs in parallel with whatever is
        // currently playing.
        const ctrl = new AbortController();
        ttsControllers.push(ctrl);
        const item: QueueItem = { bufPromise: fetchTts(trimmed, ctrl) };
        queue.push(item);
        playbackTail = playbackTail.then(async () => {
          if (cancelled) return;
          const buf = await item.bufPromise;
          if (!buf || cancelled) return;
          await playBuffer(buf);
        });
      };

      // Sentence-boundary extraction over a streaming buffer.
      // We split only on strong terminators (.!?) so opener phrases like
      // "Okay so," stay attached to the real content that follows them,
      // keeping playback gapless. The force-flush threshold handles runaway
      // long replies without a break.
      let sentenceBuf = "";
      const extractChunk = (final: boolean): string | null => {
        if (!sentenceBuf) return null;
        // Strong terminator: . ! ? (optionally followed by quote/bracket)
        const strong = sentenceBuf.match(/^([\s\S]*?[.!?]+["')\]]?)(\s|$)/);
        if (strong) {
          const chunk = strong[1];
          sentenceBuf = sentenceBuf
            .slice(strong[0].length)
            .replace(/^\s+/, "");
          return chunk;
        }
        // Force-flush on a word boundary if the buffer grows very long
        // with no sentence terminator (e.g. a run-on spoken style reply).
        if (sentenceBuf.length >= 160) {
          const i = sentenceBuf.lastIndexOf(" ", 130);
          if (i > 40) {
            const chunk = sentenceBuf.slice(0, i);
            sentenceBuf = sentenceBuf.slice(i + 1);
            return chunk;
          }
        }
        if (final && sentenceBuf.trim()) {
          const chunk = sentenceBuf;
          sentenceBuf = "";
          return chunk;
        }
        return null;
      };

      let fullText = "";
      let detectedAction: unknown | null = null;

      try {
        const res = await fetch("/api/voice-tutor/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            moduleId,
            quizOpen,
            messages: nextMessages,
          }),
        });

        if (!res.ok || !res.body) {
          const eb = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          setError(
            typeof eb.error === "string" ? eb.error : "Tutor could not answer."
          );
          messagesRef.current = prev;
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let sseBuf = "";

        while (true) {
          if (cancelled) {
            try {
              await reader.cancel();
            } catch {
              /* ignore */
            }
            break;
          }
          const { value, done } = await reader.read();
          if (done) break;
          sseBuf += decoder.decode(value, { stream: true });

          let nlnl: number;
          while ((nlnl = sseBuf.indexOf("\n\n")) !== -1) {
            const block = sseBuf.slice(0, nlnl);
            sseBuf = sseBuf.slice(nlnl + 2);

            let evt = "message";
            let dataStr = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:"))
                dataStr += line.slice(5).trimStart();
            }
            if (!dataStr) continue;

            try {
              const data = JSON.parse(dataStr);
              if (evt === "text" && typeof data.delta === "string") {
                fullText += data.delta;
                sentenceBuf += data.delta;
                let chunk;
                while ((chunk = extractChunk(false)) !== null) {
                  enqueueSentence(chunk);
                }
              } else if (evt === "action") {
                detectedAction = data;
              } else if (evt === "error") {
                setError(
                  typeof data.message === "string"
                    ? data.message
                    : "Tutor stream failed."
                );
              }
            } catch {
              /* ignore malformed SSE */
            }
          }
        }

        // Flush whatever remains in the sentence buffer.
        const tail = extractChunk(true);
        if (tail) enqueueSentence(tail);

        await playbackTail;

        if (cancelled) {
          messagesRef.current = prev;
          return;
        }

        if (fullText.trim()) {
          messagesRef.current = [
            ...nextMessages,
            { role: "assistant", content: fullText.trim() },
          ];
        } else {
          messagesRef.current = prev;
          if (!cancelled) {
            setError("Empty tutor response — try again.");
          }
        }

        if (detectedAction) applyNavigation(detectedAction);
      } catch {
        if (!cancelled) setError("Network error — try again.");
        messagesRef.current = prev;
      } finally {
        cancelPlaybackRef.current = null;
        setBusy(false);
        // If we were cancelled by barge-in or by leaving live mode, whoever
        // cancelled us already set the right next phase ("recording" or
        // "off"); don't stomp on it here.
        if (liveModeRef.current && !cancelled) {
          speechStartedAtRef.current = 0;
          silenceStartedAtRef.current = 0;
          bargeStartedAtRef.current = 0;
          setLivePhase("listening");
        }
      }
    },
    [
      applyNavigation,
      courseId,
      materialId,
      moduleId,
      quizOpen,
      setLivePhase,
    ]
  );

  const runPipeline = useCallback(
    async (blob: Blob) => {
      if (blob.size < 256) {
        setError(
          liveModeRef.current
            ? "Didn't catch that — say something."
            : "Recording too short — try again."
        );
        return;
      }

      setBusy(true);
      setError(null);
      if (liveModeRef.current) setLivePhase("thinking");
      try {
        const fd = new FormData();
        fd.append("materialId", materialId);
        fd.append(
          "file",
          new File([blob], "speech.webm", {
            type: blob.type || "audio/webm",
          })
        );

        const tr = await fetch("/api/voice-tutor/transcribe", {
          method: "POST",
          body: fd,
        });
        const trBody = (await tr.json().catch(() => ({}))) as {
          error?: string;
          text?: string;
        };
        if (!tr.ok) {
          setError(
            typeof trBody.error === "string"
              ? trBody.error
              : "Could not transcribe audio."
          );
          return;
        }
        const transcript =
          typeof trBody.text === "string" ? trBody.text.trim() : "";
        if (!transcript) {
          setError(
            liveModeRef.current
              ? "Didn't catch that — try speaking a little louder or closer to the mic."
              : "Did not catch any speech — try speaking closer to the mic."
          );
          return;
        }

        await runChatAndTts(transcript);
      } catch {
        setError("Network error — try again.");
      } finally {
        setBusy(false);
        if (liveModeRef.current) {
          // Reset VAD timestamps so a stale silence/speech window doesn't
          // immediately re-trigger when we re-arm.
          speechStartedAtRef.current = 0;
          silenceStartedAtRef.current = 0;
          bargeStartedAtRef.current = 0;
          setLivePhase("listening");
        }
      }
    },
    [materialId, runChatAndTts, setLivePhase]
  );

  // ---------- Live mode (always-on VAD) ----------

  const resetSpeculative = useCallback(() => {
    specAbortRef.current?.abort();
    specAbortRef.current = null;
    specPendingRef.current = null;
    specLatestTextRef.current = "";
    specLastFiredAtRef.current = 0;
    finalSpecRequestedRef.current = false;
  }, []);

  const fireSpeculative = useCallback(
    async (opts: { final: boolean }) => {
      if (!liveModeRef.current) return;
      const mr = mediaRecorderRef.current;
      if (!mr) return;
      // We only speculate while a recorder is alive; even if it's mid-stop,
      // the buffered chunks are still accumulating.
      if (mr.state === "inactive") return;
      // Avoid stacking duplicate speculative requests.
      if (specPendingRef.current && !opts.final) return;

      try {
        // Synchronously flush the latest captured audio into chunksRef.
        if (mr.state === "recording") mr.requestData();
      } catch {
        /* ignore */
      }
      // Give ondataavailable a tick to fire.
      await new Promise((r) => setTimeout(r, 50));

      const chunks = chunksRef.current.slice();
      if (chunks.length === 0) return;
      const blob = new Blob(chunks, {
        type: mr.mimeType || "audio/webm",
      });
      if (blob.size < SPEC_MIN_BLOB_BYTES && !opts.final) return;

      specAbortRef.current?.abort();
      const ctrl = new AbortController();
      specAbortRef.current = ctrl;
      specLastFiredAtRef.current = performance.now();

      const fd = new FormData();
      fd.append("materialId", materialId);
      fd.append(
        "file",
        new File([blob], "speech.webm", {
          type: blob.type || "audio/webm",
        })
      );

      const work = (async () => {
        try {
          const r = await fetch("/api/voice-tutor/transcribe", {
            method: "POST",
            body: fd,
            signal: ctrl.signal,
          });
          if (!r.ok) return;
          const j = (await r.json()) as { text?: string };
          if (typeof j.text === "string") {
            specLatestTextRef.current = j.text.trim();
          }
        } catch {
          /* abort or network — ignore */
        }
      })();
      specPendingRef.current = work;
      try {
        await work;
      } finally {
        if (specPendingRef.current === work) {
          specPendingRef.current = null;
        }
      }
    },
    [materialId]
  );

  const startLiveRecording = useCallback(async () => {
    if (startingRecordingRef.current) return;
    startingRecordingRef.current = true;
    try {
      setError(null);
      resetSpeculative();
      await startRecording();
      speechStartedAtRef.current = performance.now();
      silenceStartedAtRef.current = 0;
      specLastFiredAtRef.current = performance.now();
      setLivePhase("recording");
    } catch {
      setError("Microphone permission is required.");
      setInputMode("hold");
    } finally {
      startingRecordingRef.current = false;
    }
  }, [resetSpeculative, setLivePhase, startRecording]);

  const finalizeLiveUtterance = useCallback(
    async (opts: { tooShort: boolean }) => {
      if (opts.tooShort) {
        resetSpeculative();
        endRecorder();
        setError("Didn't catch that — say a bit more.");
        setLivePhase("listening");
        speechStartedAtRef.current = 0;
        silenceStartedAtRef.current = 0;
        return;
      }

      // Ensure we have an up-to-the-moment speculative transcript before we
      // stop the recorder. This is the "thinking while you're still speaking"
      // payoff — by the time we get here it's usually already in flight.
      await fireSpeculative({ final: true });
      const pending = specPendingRef.current;
      if (pending) {
        try {
          await pending;
        } catch {
          /* ignore */
        }
      }

      const transcript = specLatestTextRef.current.trim();
      if (transcript) {
        // Tear down the recorder in the background — we already have the text.
        void (async () => {
          try {
            await finalizeBlob();
          } catch {
            /* ignore */
          }
          endRecorder();
        })();
        resetSpeculative();
        await runVoiceStream(transcript);
        return;
      }

      // Fallback: speculative came back empty. Transcribe the full blob
      // synchronously and then stream the reply.
      const blob = await finalizeBlob();
      endRecorder();
      resetSpeculative();
      const text = await transcribeBlob(blob);
      if (text) {
        await runVoiceStream(text);
      } else {
        setError(
          "Didn't catch that — try speaking a little louder or closer to the mic."
        );
      }
    },
    [
      endRecorder,
      finalizeBlob,
      fireSpeculative,
      resetSpeculative,
      runVoiceStream,
      setLivePhase,
      transcribeBlob,
    ]
  );

  const vadTick = useCallback(() => {
    const analyser = analyserRef.current;
    const buf = vadBufRef.current;
    if (!liveModeRef.current || !analyser || !buf) {
      return;
    }

    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buf.length);
    const now = performance.now();

    const phase = livePhaseRef.current;
    if (phase === "listening") {
      if (rms > SPEECH_RMS && !startingRecordingRef.current) {
        // Begin recording an utterance.
        void startLiveRecording();
      }
    } else if (phase === "recording") {
      if (rms < SILENCE_RMS) {
        if (silenceStartedAtRef.current === 0) {
          silenceStartedAtRef.current = now;
          // Speech just ended — kick off a transcribe of everything captured
          // so far. By the time the silence-hold window elapses we usually
          // already have the text back.
          if (!finalSpecRequestedRef.current) {
            finalSpecRequestedRef.current = true;
            void fireSpeculative({ final: false });
          }
        } else if (now - silenceStartedAtRef.current > pauseMsRef.current) {
          const spokenFor =
            silenceStartedAtRef.current - speechStartedAtRef.current;
          const tooShort = spokenFor < MIN_SPEECH_MS;
          // Snapshot then transition before awaiting to avoid races.
          setLivePhase("thinking");
          void finalizeLiveUtterance({ tooShort });
        }
      } else if (rms > SPEECH_RMS) {
        silenceStartedAtRef.current = 0;
        finalSpecRequestedRef.current = false;
        // Periodically transcribe in the background while the user is still
        // speaking — we throw the result away if they keep going, but keep
        // the latest one for the eventual end-of-speech moment.
        if (now - specLastFiredAtRef.current > SPEC_INTERVAL_MS) {
          void fireSpeculative({ final: false });
        }
      }
    } else if (phase === "speaking") {
      // Barge-in: user starts talking while the assistant is mid-reply.
      if (rms > BARGE_IN_RMS) {
        if (bargeStartedAtRef.current === 0) {
          bargeStartedAtRef.current = now;
        } else if (now - bargeStartedAtRef.current > BARGE_IN_MS) {
          bargeStartedAtRef.current = 0;
          // Cancel the playback and start recording the interruption.
          cancelPlaybackRef.current?.();
          void startLiveRecording();
        }
      } else {
        bargeStartedAtRef.current = 0;
      }
    }
  }, [
    finalizeLiveUtterance,
    fireSpeculative,
    setLivePhase,
    startLiveRecording,
  ]);

  const enterLiveMode = useCallback(async () => {
    liveModeRef.current = true;
    setError(null);
    try {
      const stream = await ensureStream();
      const AC: typeof AudioContext | undefined =
        typeof window === "undefined"
          ? undefined
          : window.AudioContext ??
            (window as unknown as {
              webkitAudioContext?: typeof AudioContext;
            }).webkitAudioContext;
      if (!AC) throw new Error("AudioContext not supported");

      let ctx = audioCtxRef.current;
      if (!ctx) {
        ctx = new AC();
        audioCtxRef.current = ctx;
      }
      if (ctx.state === "suspended") {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }

      const source = ctx.createMediaStreamSource(stream);
      analyserSourceRef.current = source;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.2;
      source.connect(analyser);
      analyserRef.current = analyser;
      vadBufRef.current = new Uint8Array(new ArrayBuffer(analyser.fftSize));

      speechStartedAtRef.current = 0;
      silenceStartedAtRef.current = 0;
      bargeStartedAtRef.current = 0;
      setLivePhase("listening");

      if (vadIntervalRef.current === null) {
        // ~30 Hz is enough for VAD and avoids the React-19 lint warning
        // about a useCallback that references itself for rAF rescheduling.
        vadIntervalRef.current = window.setInterval(vadTick, 30);
      }
    } catch {
      liveModeRef.current = false;
      setLivePhase("off");
      setError("Microphone permission is required for live mode.");
      setInputMode("hold");
    }
  }, [ensureStream, setLivePhase, vadTick]);

  const leaveLiveMode = useCallback(() => {
    liveModeRef.current = false;
    if (vadIntervalRef.current !== null) {
      window.clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    try {
      analyserSourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    analyserSourceRef.current = null;
    analyserRef.current = null;
    vadBufRef.current = null;
    if (audioCtxRef.current) {
      try {
        void audioCtxRef.current.close();
      } catch {
        /* ignore */
      }
      audioCtxRef.current = null;
    }
    cancelPlaybackRef.current?.();
    endRecorder();
    releaseStream();
    resetSpeculative();
    setLivePhase("off");
  }, [endRecorder, releaseStream, resetSpeculative, setLivePhase]);

  useEffect(() => {
    if (inputMode !== "live") return undefined;
    // Defer to a macrotask so the effect itself doesn't synchronously trigger
    // setState (which the react-hooks/set-state-in-effect rule disallows).
    const t = window.setTimeout(() => {
      void enterLiveMode();
    }, 0);
    return () => {
      window.clearTimeout(t);
      leaveLiveMode();
    };
  }, [enterLiveMode, inputMode, leaveLiveMode]);

  useEffect(() => {
    return () => {
      liveModeRef.current = false;
      if (vadIntervalRef.current !== null) {
        window.clearInterval(vadIntervalRef.current);
        vadIntervalRef.current = null;
      }
      try {
        analyserSourceRef.current?.disconnect();
      } catch {
        /* ignore */
      }
      if (audioCtxRef.current) {
        try {
          void audioCtxRef.current.close();
        } catch {
          /* ignore */
        }
      }
      void cleanupRecorder();
      stopPlayback(audioRef);
    };
  }, [cleanupRecorder]);

  // ---------- Speed control ----------

  const cycleRate = useCallback(
    (direction: 1 | -1) => {
      const idx = PLAYBACK_RATES.indexOf(playbackRateRef.current);
      const safeIdx = idx < 0 ? 2 : idx;
      const next = Math.max(
        0,
        Math.min(PLAYBACK_RATES.length - 1, safeIdx + direction)
      );
      setPlaybackRate(PLAYBACK_RATES[next]);
    },
    [setPlaybackRate]
  );

  // React attaches wheel listeners as passive at the root, so
  // event.preventDefault() inside an onWheel handler is silently ignored
  // and the page scrolls instead. We bind a native non-passive listener
  // to the speed row directly so the wheel can adjust speed cleanly.
  const speedRowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = speedRowRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0 && e.deltaX === 0) return;
      e.preventDefault();
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      cycleRate(delta < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [cycleRate]);

  const speedIndex = Math.max(0, PLAYBACK_RATES.indexOf(playbackRate));

  // ---------- Hold / Tap handlers ----------

  const micButtonClass =
    "flex min-w-[11rem] items-center justify-center gap-2 rounded-2xl border-2 px-5 py-3 text-sm font-semibold shadow-xl transition disabled:opacity-60 " +
    ((inputMode === "live"
      ? livePhase === "recording" || livePhase === "thinking"
      : tapRecording || holdRecording || busy)
      ? "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-100 "
      : "border-zinc-200 bg-white text-zinc-900 hover:border-brand hover:text-brand dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-brand-soft dark:hover:text-brand-soft ") +
    (docked ? "" : "fixed bottom-[7.5rem] right-6 z-[100] sm:bottom-[8.5rem] ");

  const onPointerDownHold = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (inputMode !== "hold" || busy) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setHoldRecording(true);
      const p = startRecording();
      startPromiseRef.current = p;
      void p.catch(() => {
        setError("Microphone permission is required.");
        setHoldRecording(false);
        startPromiseRef.current = null;
        void cleanupRecorder();
      });
    },
    [busy, cleanupRecorder, inputMode, startRecording]
  );

  const onPointerUpHold = useCallback(
    async (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (inputMode !== "hold") return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setHoldRecording(false);
      try {
        await startPromiseRef.current;
      } catch {
        return;
      }
      const blob = await finalizeBlob();
      await cleanupRecorder();
      await runPipeline(blob);
    },
    [cleanupRecorder, finalizeBlob, inputMode, runPipeline]
  );

  const onTapMic = useCallback(async () => {
    if (inputMode !== "tap" || busy) return;
    if (!tapRecording) {
      setTapRecording(true);
      setError(null);
      try {
        const p = startRecording();
        startPromiseRef.current = p;
        await p;
      } catch {
        setTapRecording(false);
        setError("Microphone permission is required.");
        await cleanupRecorder();
      }
      return;
    }

    setTapRecording(false);
    try {
      await startPromiseRef.current;
    } catch {
      await cleanupRecorder();
      return;
    }
    const blob = await finalizeBlob();
    await cleanupRecorder();
    await runPipeline(blob);
  }, [
    busy,
    cleanupRecorder,
    finalizeBlob,
    inputMode,
    runPipeline,
    startRecording,
    tapRecording,
  ]);

  // ---------- Live mic button ----------

  const liveStatusLabel =
    livePhase === "recording"
      ? "Listening to you…"
      : livePhase === "thinking"
        ? "Thinking…"
        : livePhase === "speaking"
          ? "Speaking — talk to interrupt"
          : livePhase === "listening"
            ? "Live · waiting for you"
            : "Live · off";

  const onLiveStopClick = useCallback(() => {
    if (livePhaseRef.current === "speaking") {
      cancelPlaybackRef.current?.();
      setLivePhase("listening");
      return;
    }
    if (livePhaseRef.current === "recording") {
      // Force-finalize the current utterance.
      setLivePhase("thinking");
      void finalizeLiveUtterance({ tooShort: false });
    }
  }, [finalizeLiveUtterance, setLivePhase]);

  const modeButtonClass = (active: boolean) =>
    `rounded-md px-2 py-0.5 transition ${
      active
        ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
        : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
    }`;

  return (
    <div
      className={
        docked
          ? "flex flex-col items-stretch gap-2"
          : "fixed bottom-6 right-6 z-[100] flex flex-col items-stretch gap-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      }
      role="group"
      aria-label={`Voice tutor — ${AI_ASSISTANT_NAME}`}
    >
      <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300">
        <span className="pl-1">Input</span>
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => {
              void cleanupRecorder();
              setTapRecording(false);
              setHoldRecording(false);
              setInputMode("hold");
            }}
            className={modeButtonClass(inputMode === "hold")}
          >
            Hold
          </button>
          <button
            type="button"
            onClick={() => {
              void cleanupRecorder();
              setTapRecording(false);
              setHoldRecording(false);
              setInputMode("tap");
            }}
            className={modeButtonClass(inputMode === "tap")}
          >
            Tap
          </button>
          <button
            type="button"
            onClick={() => {
              setTapRecording(false);
              setHoldRecording(false);
              setInputMode("live");
            }}
            className={modeButtonClass(inputMode === "live")}
            title="Always-on conversation — talk anytime, interrupt anytime"
          >
            Live
          </button>
        </div>
      </div>

      <div
        ref={speedRowRef}
        className="flex items-center gap-2 rounded-xl border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300"
        title="Drag the slider or scroll the wheel to change voice speed"
      >
        <span className="pl-1">Speed</span>
        <input
          type="range"
          min={0}
          max={PLAYBACK_RATES.length - 1}
          step={1}
          value={speedIndex}
          onChange={(e) =>
            setPlaybackRate(PLAYBACK_RATES[Number(e.target.value)])
          }
          aria-label={`Playback speed ${playbackRate}x`}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-rose-500 dark:bg-zinc-700"
        />
        <button
          type="button"
          onClick={() => cycleRate(1)}
          onContextMenu={(e) => {
            e.preventDefault();
            cycleRate(-1);
          }}
          className="min-w-[2.75rem] rounded-lg bg-zinc-100 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-zinc-900 shadow-sm transition hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
          aria-label="Step playback speed up"
        >
          {playbackRate}x
        </button>
      </div>

      {inputMode === "live" ? (
        <div
          className="flex items-center gap-2 rounded-xl border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300"
          title="How long to wait after you stop talking before the assistant replies. Longer = more room to pause mid-thought."
        >
          <span className="pl-1">Pause</span>
          <input
            type="range"
            min={PAUSE_MIN_MS}
            max={PAUSE_MAX_MS}
            step={PAUSE_STEP_MS}
            value={pauseMs}
            onChange={(e) => setPauseMs(Number(e.target.value))}
            aria-label={`Wait ${(pauseMs / 1000).toFixed(1)} seconds of silence before sending`}
            className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-zinc-200 accent-rose-500 dark:bg-zinc-700"
          />
          <span className="min-w-[2.75rem] rounded-lg bg-zinc-100 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-100">
            {(pauseMs / 1000).toFixed(pauseMs % 1000 === 0 ? 0 : 1)}s
          </span>
        </div>
      ) : null}

      {inputMode === "live" ? (
        <button
          type="button"
          disabled={livePhase === "off"}
          aria-busy={livePhase === "thinking"}
          aria-pressed={livePhase === "recording"}
          onClick={onLiveStopClick}
          className={micButtonClass}
          title={
            livePhase === "speaking"
              ? "Tap or start speaking to interrupt"
              : livePhase === "recording"
                ? "Tap to send now"
                : "Live mode is on — just talk"
          }
        >
          {livePhase === "thinking" ? (
            <>
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500"
                aria-hidden
              />
              Thinking…
            </>
          ) : livePhase === "recording" ? (
            <>
              <span
                className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-500"
                aria-hidden
              />
              Listening…
            </>
          ) : livePhase === "speaking" ? (
            <>
              <span
                className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500"
                aria-hidden
              />
              Speaking…
            </>
          ) : (
            <>Live · just talk</>
          )}
        </button>
      ) : (
        <button
          type="button"
          disabled={busy}
          aria-busy={busy}
          aria-pressed={inputMode === "hold" ? holdRecording : tapRecording}
          onPointerDown={inputMode === "hold" ? onPointerDownHold : undefined}
          onPointerUp={inputMode === "hold" ? onPointerUpHold : undefined}
          onPointerCancel={
            inputMode === "hold" ? onPointerUpHold : undefined
          }
          onPointerLeave={
            inputMode === "hold"
              ? (e) => {
                  if (e.buttons === 0) void onPointerUpHold(e);
                }
              : undefined
          }
          onClick={inputMode === "tap" ? () => void onTapMic() : undefined}
          className={micButtonClass}
          title={
            inputMode === "hold"
              ? "Hold to speak — release to send"
              : tapRecording
                ? "Tap again to send"
                : "Tap to start recording"
          }
        >
          {busy ? (
            <>
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500"
                aria-hidden
              />
              Working…
            </>
          ) : inputMode === "tap" && tapRecording ? (
            <>Recording… tap to send</>
          ) : inputMode === "hold" && holdRecording ? (
            <>Listening…</>
          ) : (
            <>Voice</>
          )}
        </button>
      )}

      {error ? (
        <p className="max-w-[14rem] text-xs leading-snug text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="max-w-[14rem] text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          {inputMode === "hold"
            ? "Hold the button, speak, release. Uses the same lesson context as chat (Claude + your materials)."
            : inputMode === "tap"
              ? "Tap once to record, tap again to send."
              : `${liveStatusLabel} · Pause slider sets how long after you stop talking before the reply kicks in.`}
        </p>
      )}
    </div>
  );
}
