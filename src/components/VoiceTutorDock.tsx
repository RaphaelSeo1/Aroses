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
import { VoiceTutorTranscriptSidebar } from "@/components/VoiceTutorTranscriptSidebar";
import type {
  TranscriptFilter,
  VoiceAiTranscriptSegment,
  VoiceUserTranscriptLine,
} from "@/components/VoiceTutorTranscriptSidebar";
import { VoiceWaveform } from "@/components/VoiceWaveform";
import type { VoiceContinuationHint } from "@/lib/ai/study-chat";
import { AI_ASSISTANT_NAME } from "@/lib/brand";
import { playMpegFromResponse } from "@/lib/voice-tutor/play-mpeg-from-response";
import type { StudyChatTurn } from "@/types/study-chat";

type InputMode = "hold" | "live";

type LivePhase = "off" | "listening" | "recording" | "thinking" | "speaking";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
type PlaybackRate = (typeof PLAYBACK_RATES)[number];
type VoiceLanguageCode =
  | "auto"
  | "en"
  | "es"
  | "fr"
  | "ko"
  | "ja"
  | "zh";

const VOICE_LANGUAGES: Array<{
  code: VoiceLanguageCode;
  label: string;
  deepgram?: string;
}> = [
  { code: "auto", label: "Auto" },
  { code: "en", label: "English", deepgram: "en" },
  { code: "es", label: "Spanish", deepgram: "es" },
  { code: "fr", label: "French", deepgram: "fr" },
  { code: "ko", label: "Korean", deepgram: "ko" },
  { code: "ja", label: "Japanese", deepgram: "ja" },
  { code: "zh", label: "Chinese", deepgram: "zh" },
];

const CJK_VOICE_LANGUAGES = new Set<VoiceLanguageCode>(["ko", "ja", "zh"]);
const SENTENCE_TERMINATORS = ".!?。！？";
const CLOSING_PUNCTUATION = "\"')]}”’」』）〉》";

function takeNaturalVoiceChunk(
  text: string,
  final: boolean,
  voiceLanguage: VoiceLanguageCode
): {
  chunk: string | null;
  rest: string;
} {
  if (!text.trim()) return { chunk: null, rest: "" };

  let lastBoundary = -1;
  let sentenceCount = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!SENTENCE_TERMINATORS.includes(text[i])) continue;
    let end = i + 1;
    while (end < text.length && CLOSING_PUNCTUATION.includes(text[end])) {
      end += 1;
    }
    const next = text[end];
    if (
      next &&
      !/\s/.test(next) &&
      !CJK_VOICE_LANGUAGES.has(voiceLanguage)
    ) {
      continue;
    }
    lastBoundary = end;
    sentenceCount += 1;
    if (sentenceCount >= 2 || end >= 180) break;
  }

  if (lastBoundary > 0) {
    return {
      chunk: text.slice(0, lastBoundary),
      rest: text.slice(lastBoundary).replace(/^\s+/, ""),
    };
  }

  if (text.length >= 360) {
    const softBreaks = [", ", "; ", ": ", " — ", " and ", " but ", " so "];
    let cut = -1;
    for (const marker of softBreaks) {
      cut = Math.max(cut, text.lastIndexOf(marker, 300));
    }
    if (cut > 140) {
      const end = cut + 1;
      return {
        chunk: text.slice(0, end),
        rest: text.slice(end).replace(/^\s+/, ""),
      };
    }
  }

  if (final) return { chunk: text, rest: "" };
  return { chunk: null, rest: text };
}

type DeepgramResultMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
};

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
const BARGE_IN_MS = 220;
// How often we fire a speculative transcription while the user is speaking,
// so by the time they stop we already have (most of) the transcript.
const SPEC_INTERVAL_MS = 450;
const SPEC_MIN_BLOB_BYTES = 4 * 1024;
const THINKING_FILLERS = [
  "Hmm.",
  "Okay.",
  "Yeah.",
  "Right.",
  "Let me think.",
  "One sec.",
] as const;
const THINKING_FILLER_CHANCE = 0.12;
const THINKING_FILLER_DELAY_MS = 900;
const MIN_TTS_BUFFERED_CHUNKS = 2;

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
  // Prefer opus-in-webm (Chrome/Firefox), fall back to mp4/aac (Safari/iOS)
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const t of candidates) {
    if (MR.isTypeSupported(t)) return t;
  }
  return undefined;
}

function mimeTypeToExtension(mimeType: string | undefined): string {
  if (!mimeType) return "webm";
  if (mimeType.startsWith("audio/mp4")) return "m4a";
  if (mimeType.startsWith("audio/ogg")) return "ogg";
  return "webm";
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

function pickThinkingFiller(
  clips: Map<string, ArrayBuffer>,
  last: string | null
): { text: string; audio: ArrayBuffer } | null {
  const options = THINKING_FILLERS.filter(
    (text) => text !== last && clips.has(text)
  );
  if (options.length === 0) return null;
  const text = options[Math.floor(Math.random() * options.length)];
  const audio = clips.get(text);
  return audio ? { text, audio } : null;
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
  const [holdRecording, setHoldRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1);
  const [livePhase, setLivePhaseState] = useState<LivePhase>("off");
  const [pauseMs, setPauseMs] = useState<number>(DEFAULT_PAUSE_MS);
  const [voiceLanguage, setVoiceLanguage] =
    useState<VoiceLanguageCode>("auto");
  // Set when the monthly voice allowance is exhausted (server 402). An effect
  // below leaves live mode (defined later, so a direct call here would be a
  // forward reference) and the cap message stays visible in the error slot.
  const [voiceCapped, setVoiceCapped] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Only show errors after the user has actually used the mic at least once.
  const hasInteractedRef = useRef(false);

  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptFilter, setTranscriptFilter] =
    useState<TranscriptFilter>("both");
  const [partialUserDraft, setPartialUserDraft] = useState("");
  const [userTranscriptLines, setUserTranscriptLines] = useState<
    VoiceUserTranscriptLine[]
  >([]);
  const [aiTranscriptSegments, setAiTranscriptSegments] = useState<
    VoiceAiTranscriptSegment[]
  >([]);
  const [liveAssistantText, setLiveAssistantText] = useState("");
  const [assistantHighlight, setAssistantHighlight] = useState<{
    start: number;
    end: number;
  } | null>(null);

  const assistantStreamFullRef = useRef("");
  const streamTokensDoneRef = useRef(true);
  const playedAssistantAloudRef = useRef("");
  const pendingVoiceContinuationRef = useRef<VoiceContinuationHint | null>(
    null
  );
  const assistantCharOffsetRef = useRef(0);
  const lastUserTranscriptIdRef = useRef<string | null>(null);
  // Cached short thinking clips. We play them only occasionally and after a
  // short delay so they don't become a repetitive verbal tic.
  const thinkingAudioRef = useRef<Map<string, ArrayBuffer>>(new Map());
  const lastThinkingFillerRef = useRef<string | null>(null);
  const thinkingFillerUsedLastTurnRef = useRef(false);

  // Auto-clear transient errors after 5 seconds so the hint text shows again.
  useEffect(() => {
    if (!error) return;
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
    return () => {
      if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    };
  }, [error]);

  // Pre-fetch a few short thinking clips when live mode is active. These are
  // optional: the real answer always wins if it starts quickly.
  useEffect(() => {
    if (inputMode !== "live" || voiceLanguage !== "en") {
      thinkingAudioRef.current.clear();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await Promise.all(
          THINKING_FILLERS.map(async (text) => {
            const res = await fetch("/api/voice-tutor/tts", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text,
                materialId,
                ...(courseId ? { courseId } : {}),
              }),
            });
            if (!cancelled && res.ok) {
              thinkingAudioRef.current.set(text, await res.arrayBuffer());
            }
          })
        );
      } catch {
        // Not critical — fall back to normal (no filler)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inputMode, materialId, courseId, voiceLanguage]);
  const voiceLanguageRef = useRef<VoiceLanguageCode>("auto");
  useEffect(() => {
    voiceLanguageRef.current = voiceLanguage;
  }, [voiceLanguage]);

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
  const deepgramSocketRef = useRef<WebSocket | null>(null);
  const deepgramRecorderRef = useRef<MediaRecorder | null>(null);
  const deepgramFinalRef = useRef("");
  const deepgramStartingRef = useRef(false);
  const deepgramSendingRef = useRef(false);

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

  const transcribeBlob = useCallback(
    async (blob: Blob): Promise<string | null> => {
      if (blob.size < 256) return null;
      const actualType = blob.type || "audio/webm";
      const ext = mimeTypeToExtension(actualType);
      const fd = new FormData();
      fd.append("materialId", materialId);
      fd.append("file", new File([blob], `speech.${ext}`, { type: actualType }));
      try {
        const r = await fetch("/api/voice-tutor/transcribe", {
          method: "POST",
          body: fd,
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          const msg = typeof j.error === "string" ? j.error : "Transcription failed.";
          setError(msg);
          return null;
        }
        const j = (await r.json()) as { text?: string };
        return typeof j.text === "string" ? j.text.trim() : null;
      } catch {
        setError("Network error — check your connection and try again.");
        return null;
      }
    },
    [materialId]
  );

  const runVoiceStream = useCallback(
    async (transcript: string, earlyAudio?: ArrayBuffer | null) => {
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

      const userLineId = crypto.randomUUID();
      lastUserTranscriptIdRef.current = userLineId;
      setUserTranscriptLines((p) => [
        ...p,
        { id: userLineId, ts: Date.now(), text: transcript },
      ]);
      void (async () => {
        try {
          const r = await fetch("/api/voice-tutor/utterance-bullets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: transcript }),
          });
          if (!r.ok) return;
          const j = (await r.json()) as { bullets?: string[] };
          const bullets = Array.isArray(j.bullets) ? j.bullets : [];
          if (!bullets.length) return;
          setUserTranscriptLines((lines) =>
            lines.map((row) =>
              row.id === userLineId ? { ...row, bullets } : row
            )
          );
        } catch {
          /* ignore */
        }
      })();

      setLiveAssistantText("");
      assistantStreamFullRef.current = "";
      playedAssistantAloudRef.current = "";
      assistantCharOffsetRef.current = 0;
      streamTokensDoneRef.current = false;
      const hadPendingInterruption =
        pendingVoiceContinuationRef.current != null;

      // Cancellation for barge-in or mode-switch.
      let cancelled = false;
      const ttsControllers: AbortController[] = [];
      const cancelAll = () => {
        cancelled = true;
        const full = assistantStreamFullRef.current;
        const spoken = playedAssistantAloudRef.current;
        const hadAssistantProgress =
          full.trim().length > 0 || spoken.trim().length > 0;
        if (hadAssistantProgress) {
          const notYet = full.startsWith(spoken) ? full.slice(spoken.length) : full;
          if (spoken.trim() || notYet.trim()) {
            pendingVoiceContinuationRef.current = {
              spokenBeforeInterrupt: spoken,
              notYetSpoken: notYet,
              streamIncomplete: !streamTokensDoneRef.current,
            };
          }
          setAiTranscriptSegments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              kind: "divider",
              content: "",
              label: "Interrupted",
            },
          ]);
        }
        try {
          audioRef.current?.pause();
        } catch {
          /* ignore */
        }
        try {
          audioRef.current && (audioRef.current.src = "");
        } catch {
          /* ignore */
        }
        audioRef.current = null;
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

      const playMp3ArrayBuffer = async (buf: ArrayBuffer): Promise<void> => {
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
          audioRef.current = a;
          const cleanup = () => {
            URL.revokeObjectURL(url);
            if (audioRef.current === a) audioRef.current = null;
            resolve();
          };
          a.onended = cleanup;
          a.onerror = cleanup;
          void a
            .play()
            .then(() => {
              if (!firstAudioStarted && liveModeRef.current && !cancelled) {
                firstAudioStarted = true;
                setLivePhase("speaking");
              }
            })
            .catch(cleanup);
        });
      };

      const fetchTtsStream = (
        text: string,
        ctrl: AbortController,
        context?: { previousText?: string; nextText?: string }
      ) =>
        fetch("/api/voice-tutor/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            materialId,
            stream: true,
            voiceLanguage,
            ...(context?.previousText ? { previousText: context.previousText } : {}),
            ...(context?.nextText ? { nextText: context.nextText } : {}),
            ...(courseId ? { courseId } : {}),
          }),
          signal: ctrl.signal,
        }).then((r) => (r.ok ? r : null));

      type QueueItem =
        | { kind: "thinking"; bufPromise: Promise<ArrayBuffer | null> }
        | {
            kind: "tts";
            spokenChunk: string;
            responsePromise: Promise<Response | null>;
            ctrl: AbortController;
          };

      let playbackTail: Promise<void> = Promise.resolve();
      let playableChunksQueued = 0;
      let playbackGateResolve: (() => void) | null = null;
      const playbackGate = new Promise<void>((resolve) => {
        playbackGateResolve = resolve;
      });
      const openPlaybackGate = () => {
        playbackGateResolve?.();
        playbackGateResolve = null;
      };

      // Optional filler: wait briefly, then play a random thinking cue only
      // sometimes, never twice in a row, and never after interruptions.
      if (
        earlyAudio &&
        voiceLanguage === "en" &&
        !hadPendingInterruption &&
        !thinkingFillerUsedLastTurnRef.current &&
        Math.random() < THINKING_FILLER_CHANCE
      ) {
        const picked = pickThinkingFiller(
          thinkingAudioRef.current,
          lastThinkingFillerRef.current
        );
        if (picked) {
          lastThinkingFillerRef.current = picked.text;
          thinkingFillerUsedLastTurnRef.current = true;
          const earlyItem: QueueItem = {
            kind: "thinking",
            bufPromise: (async () => {
              await new Promise((r) =>
                setTimeout(r, THINKING_FILLER_DELAY_MS)
              );
              return picked.audio;
            })(),
          };
          playbackTail = playbackTail.then(async () => {
            if (cancelled || firstAudioStarted) return;
            const buf = await earlyItem.bufPromise;
            if (!buf || cancelled || firstAudioStarted) return;
            await playMp3ArrayBuffer(buf);
          });
        } else {
          thinkingFillerUsedLastTurnRef.current = false;
        }
      } else {
        thinkingFillerUsedLastTurnRef.current = false;
      }

      const pendingTtsChunks: string[] = [];
      const enqueueTtsChunk = (spokenChunk: string, nextText?: string) => {
        const trimmed = spokenChunk.trim();
        if (!trimmed) return;
        const ctrl = new AbortController();
        ttsControllers.push(ctrl);
        const previousText = [
          playedAssistantAloudRef.current,
          ...pendingTtsChunks,
        ].join(" ");
        const responsePromise = fetchTtsStream(trimmed, ctrl, {
          previousText: previousText || playedAssistantAloudRef.current,
          nextText,
        });
        const item: QueueItem = {
          kind: "tts",
          spokenChunk: trimmed,
          responsePromise,
          ctrl,
        };
        playableChunksQueued += 1;
        if (playableChunksQueued >= MIN_TTS_BUFFERED_CHUNKS) openPlaybackGate();
        playbackTail = playbackTail.then(async () => {
          if (cancelled) return;
          await playbackGate;
          const res = await item.responsePromise;
          if (!res || cancelled) return;
          const start = assistantCharOffsetRef.current;
          const end = start + item.spokenChunk.length;
          assistantCharOffsetRef.current = end;
          setAssistantHighlight({ start, end });
          await playMpegFromResponse(res, {
            signal: item.ctrl.signal,
            playbackRate: playbackRateRef.current,
            audioRef,
            onFirstPlay: () => {
              if (!firstAudioStarted && liveModeRef.current && !cancelled) {
                firstAudioStarted = true;
                setLivePhase("speaking");
              }
            },
          });
          if (!cancelled) {
            playedAssistantAloudRef.current = `${playedAssistantAloudRef.current} ${item.spokenChunk}`.trim();
          }
        });
      };

      const flushPendingTtsChunks = (final: boolean) => {
        while (pendingTtsChunks.length >= (final ? 1 : 2)) {
          const current = pendingTtsChunks.shift();
          if (!current) continue;
          const nextText = pendingTtsChunks[0] ?? "";
          enqueueTtsChunk(current, nextText);
        }
        if (final) openPlaybackGate();
      };

      // Sentence-boundary extraction over a streaming buffer. Prefer complete
      // sentence groups so ElevenLabs has enough text for natural prosody.
      let sentenceBuf = "";
      const extractChunk = (final: boolean): string | null => {
        const result = takeNaturalVoiceChunk(sentenceBuf, final, voiceLanguage);
        sentenceBuf = result.rest;
        return result.chunk;
      };

      let fullText = "";
      let detectedAction: unknown | null = null;

      try {
        const voiceContinuation = pendingVoiceContinuationRef.current;
        pendingVoiceContinuationRef.current = null;

        const res = await fetch("/api/voice-tutor/converse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            materialId,
            moduleId,
            quizOpen,
            messages: nextMessages,
            voiceLanguage,
            ...(voiceContinuation
              ? { voiceContinuation }
              : {}),
          }),
        });

        if (!res.ok || !res.body) {
          if (voiceContinuation) {
            pendingVoiceContinuationRef.current = voiceContinuation;
          }
          const eb = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          // Monthly voice allowance exhausted: show the server's friendly cap
          // message and shut the live session down (effect on voiceCapped)
          // instead of leaving the mic running against a dead endpoint.
          if (res.status === 402) {
            setVoiceCapped(true);
          }
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
                assistantStreamFullRef.current = fullText;
                setLiveAssistantText(fullText);
                let chunk;
                while ((chunk = extractChunk(false)) !== null) {
                  pendingTtsChunks.push(chunk);
                  flushPendingTtsChunks(false);
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

        streamTokensDoneRef.current = true;

        // Flush whatever remains in the sentence buffer.
        const tail = extractChunk(true);
        if (tail) pendingTtsChunks.push(tail);
        flushPendingTtsChunks(true);

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

        if (fullText.trim()) {
          setAiTranscriptSegments((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              kind: "text",
              content: fullText.trim(),
            },
          ]);
        }
        setLiveAssistantText("");
        setAssistantHighlight(null);
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
      voiceLanguage,
    ]
  );

  const runPipeline = useCallback(
    async (blob: Blob) => {
      // Tiny blobs almost always come from accidental button bounces or
      // a stray M-keypress, NOT a real attempt. We silently ignore those
      // in Hold/Tap (where the user knows they pressed something brief)
      // and only surface a friendly nudge in Live mode where the user
      // can't easily tell they were too quiet.
      if (blob.size < 4 * 1024) {
        if (liveModeRef.current) {
          setError("Didn't catch that — say something.");
        }
        return;
      }

      setBusy(true);
      setError(null);
      if (liveModeRef.current) setLivePhase("thinking");
      try {
        const actualType = blob.type || "audio/webm";
        const ext = mimeTypeToExtension(actualType);
        const fd = new FormData();
        fd.append("materialId", materialId);
        if (voiceLanguage !== "auto") {
          fd.append("language", voiceLanguage);
        }
        fd.append("file", new File([blob], `speech.${ext}`, { type: actualType }));

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

        await runVoiceStream(transcript, null);
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
    [materialId, runVoiceStream, setLivePhase, voiceLanguage]
  );

  // ---------- Live mode (always-on VAD) ----------

  const resetSpeculative = useCallback(() => {
    specAbortRef.current?.abort();
    specAbortRef.current = null;
    specPendingRef.current = null;
    specLatestTextRef.current = "";
    specLastFiredAtRef.current = 0;
    finalSpecRequestedRef.current = false;
    setPartialUserDraft("");
  }, []);

  const stopDeepgramLive = useCallback(() => {
    deepgramSendingRef.current = false;
    deepgramStartingRef.current = false;
    const recorder = deepgramRecorderRef.current;
    deepgramRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    const ws = deepgramSocketRef.current;
    deepgramSocketRef.current = null;
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "CloseStream" }));
        }
      } catch {
        /* ignore */
      }
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    deepgramFinalRef.current = "";
  }, []);

  const handleVoiceLanguageChange = useCallback(
    (nextLanguage: VoiceLanguageCode) => {
      setVoiceLanguage(nextLanguage);
      voiceLanguageRef.current = nextLanguage;
      if (inputMode === "live") {
        stopDeepgramLive();
        setLivePhase("off");
      }
    },
    [inputMode, setLivePhase, stopDeepgramLive]
  );

  const sendDeepgramUtterance = useCallback(
    (reason: "speech_final" | "utterance_end") => {
      const transcript = deepgramFinalRef.current.trim();
      if (!transcript || !liveModeRef.current || deepgramSendingRef.current) {
        return;
      }
      deepgramSendingRef.current = true;
      deepgramFinalRef.current = "";
      setPartialUserDraft("");
      if (livePhaseRef.current !== "thinking") {
        setLivePhase("thinking");
      }
      const fillerCandidate =
        thinkingAudioRef.current.values().next().value ?? null;
      void runVoiceStream(transcript, fillerCandidate).finally(() => {
        deepgramSendingRef.current = false;
        if (liveModeRef.current && reason === "utterance_end") {
          setLivePhase("listening");
        }
      });
    },
    [runVoiceStream, setLivePhase]
  );

  const startDeepgramLive = useCallback(async () => {
    if (deepgramStartingRef.current || deepgramSocketRef.current) return;
    deepgramStartingRef.current = true;
    try {
      const stream = await ensureStream();
      const tokenRes = await fetch("/api/voice-tutor/deepgram-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          materialId,
          ...(courseId ? { courseId } : {}),
        }),
      });
      const tokenBody = (await tokenRes.json().catch(() => ({}))) as {
        accessToken?: string;
        error?: string;
      };
      if (!tokenRes.ok || typeof tokenBody.accessToken !== "string") {
        throw new Error(
          tokenBody.error ||
            `Deepgram token failed with status ${tokenRes.status}.`
        );
      }

      const qs = new URLSearchParams({
        model: "nova-3",
        smart_format: "true",
        interim_results: "true",
        endpointing: "300",
        utterance_end_ms: "1000",
        vad_events: "true",
      });
      const language = VOICE_LANGUAGES.find(
        (l) => l.code === voiceLanguageRef.current
      );
      if (language?.deepgram) {
        qs.set("language", language.deepgram);
      }
      const ws = new WebSocket(
        `wss://api.deepgram.com/v1/listen?${qs.toString()}`,
        ["bearer", tokenBody.accessToken]
      );
      deepgramSocketRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const fail = () =>
          reject(
            new Error(
              "Deepgram WebSocket connection failed. Check that the token was accepted and that the selected language/model is supported."
            )
          );
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", fail, { once: true });
        window.setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) fail();
        }, 6000);
      });

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as DeepgramResultMessage;
          if (msg.type === "UtteranceEnd") {
            sendDeepgramUtterance("utterance_end");
            return;
          }
          if (msg.type && msg.type !== "Results") return;
          const transcript =
            msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
          if (!transcript) return;

          if (livePhaseRef.current === "speaking") {
            cancelPlaybackRef.current?.();
            setLivePhase("recording");
          }

          if (msg.is_final) {
            deepgramFinalRef.current = `${deepgramFinalRef.current} ${transcript}`.trim();
            setPartialUserDraft(deepgramFinalRef.current);
          } else {
            const base = deepgramFinalRef.current.trim();
            setPartialUserDraft(base ? `${base} ${transcript}` : transcript);
          }

          if (msg.speech_final) {
            sendDeepgramUtterance("speech_final");
          } else if (livePhaseRef.current === "listening") {
            setLivePhase("recording");
          }
        } catch {
          /* ignore malformed Deepgram frame */
        }
      };
      ws.onclose = () => {
        if (deepgramSocketRef.current === ws) {
          deepgramSocketRef.current = null;
        }
      };

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );
      deepgramRecorderRef.current = recorder;
      recorder.ondataavailable = (ev) => {
        if (
          ev.data.size > 0 &&
          deepgramSocketRef.current?.readyState === WebSocket.OPEN
        ) {
          deepgramSocketRef.current.send(ev.data);
        }
      };
      recorder.start(120);
    } catch (e) {
      console.error(e);
      stopDeepgramLive();
      liveModeRef.current = false;
      setLivePhase("off");
      setError(
        e instanceof Error
          ? e.message
          : "Deepgram live transcription could not start. Use Hold or Tap for now."
      );
    } finally {
      deepgramStartingRef.current = false;
    }
  }, [
    courseId,
    ensureStream,
    materialId,
    sendDeepgramUtterance,
    setLivePhase,
    stopDeepgramLive,
  ]);

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
            setPartialUserDraft(specLatestTextRef.current);
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

      try {
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
          const fillerCandidate =
            thinkingAudioRef.current.values().next().value ?? null;
          await runVoiceStream(transcript, fillerCandidate);
          return;
        }

        // Fallback: speculative came back empty. Transcribe the full blob
        // synchronously and then stream the reply.
        const blob = await finalizeBlob();
        endRecorder();
        resetSpeculative();
        const text = await transcribeBlob(blob);
        if (text) {
          const fillerCandidate =
            thinkingAudioRef.current.values().next().value ?? null;
          await runVoiceStream(text, fillerCandidate);
        } else {
          setError(
            "Didn't catch that — try speaking a little louder or closer to the mic."
          );
        }
      } catch {
        setError("Something went wrong — try again.");
      } finally {
        // Always return to listening so the phase never gets stuck on "thinking".
        if (liveModeRef.current) setLivePhase("listening");
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

      await startDeepgramLive();
    } catch {
      liveModeRef.current = false;
      setLivePhase("off");
      setError(
        (prev) => prev || "Microphone permission is required for live mode."
      );
      setInputMode("hold");
    }
  }, [ensureStream, setLivePhase, startDeepgramLive]);

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
    stopDeepgramLive();
    endRecorder();
    releaseStream();
    resetSpeculative();
    setLivePhase("off");
  }, [
    endRecorder,
    releaseStream,
    resetSpeculative,
    setLivePhase,
    stopDeepgramLive,
  ]);

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

  // Voice cap reached (server 402): stop the live session so the mic doesn't
  // keep streaming against endpoints that will keep refusing. Hold-to-talk
  // stays available in the UI but /transcribe is capped too, so the user sees
  // the same friendly message rather than a stuck session.
  useEffect(() => {
    if (!voiceCapped) return;
    setInputMode("hold");
    leaveLiveMode();
  }, [voiceCapped, leaveLiveMode]);

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
      stopDeepgramLive();
      void cleanupRecorder();
      stopPlayback(audioRef);
    };
  }, [cleanupRecorder, stopDeepgramLive]);

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

  // Stale error toasts ("Didn't catch that", etc) used to stick around
  // forever after a single failed attempt. Auto-clear them after a short
  // window so the dock doesn't permanently look broken.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => {
      setError((prev) => (prev === error ? null : prev));
    }, 2500);
    return () => clearTimeout(t);
  }, [error]);

  // When the assistant kicks off a new request, any stale toast from a
  // previous attempt is irrelevant — clear it immediately so the user
  // doesn't see "Recording too short" while the AI is actively speaking.
  useEffect(() => {
    if (busy) setError(null);
  }, [busy]);

  const speedIndex = Math.max(0, PLAYBACK_RATES.indexOf(playbackRate));

  // ---------- Hold / Tap handlers ----------

  const micButtonClass =
    "flex min-w-[11rem] items-center justify-center gap-2 rounded-2xl border-2 px-5 py-3 text-sm font-semibold shadow-xl transition disabled:opacity-60 " +
    ((inputMode === "live"
      ? livePhase === "recording" || livePhase === "thinking"
      : holdRecording || busy)
      ? "border-rose-400 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-950/50 dark:text-rose-100 "
      : "border-zinc-200 bg-white text-zinc-900 hover:border-brand hover:text-brand dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:border-brand-soft dark:hover:text-brand-soft ") +
    (inputMode === "live" && livePhase === "recording"
      ? "ring-2 ring-rose-400/60 ring-offset-2 ring-offset-white motion-safe:animate-pulse dark:ring-rose-500/50 dark:ring-offset-zinc-950 "
      : "") +
    (docked
      ? ""
      : "fixed bottom-[7.5rem] right-6 z-[100] sm:bottom-[8.5rem] ");

  const onPointerDownHold = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (inputMode !== "hold" || busy) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      hasInteractedRef.current = true;
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

  // ---------- "M" hotkey (Hold mode only) ----------
  // Press-and-hold `M` on the keyboard to record without needing to
  // mouse over to the Voice button. We mirror the pointer-hold flow
  // exactly so the UX stays consistent.
  const holdHotkeyActiveRef = useRef<boolean>(false);
  useEffect(() => {
    if (inputMode !== "hold") return;

    const isTextEditableTarget = (t: EventTarget | null): boolean => {
      if (!(t instanceof HTMLElement)) return false;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (t.isContentEditable) return true;
      return false;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (e.repeat) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextEditableTarget(e.target)) return;
      if (busy || holdHotkeyActiveRef.current) return;
      e.preventDefault();
      holdHotkeyActiveRef.current = true;
      hasInteractedRef.current = true;
      setHoldRecording(true);
      const p = startRecording();
      startPromiseRef.current = p;
      void p.catch(() => {
        setError("Microphone permission is required.");
        setHoldRecording(false);
        startPromiseRef.current = null;
        holdHotkeyActiveRef.current = false;
        void cleanupRecorder();
      });
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "m" && e.key !== "M") return;
      if (!holdHotkeyActiveRef.current) return;
      e.preventDefault();
      holdHotkeyActiveRef.current = false;
      setHoldRecording(false);
      void (async () => {
        try {
          await startPromiseRef.current;
        } catch {
          return;
        }
        const blob = await finalizeBlob();
        await cleanupRecorder();
        await runPipeline(blob);
      })();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      holdHotkeyActiveRef.current = false;
    };
  }, [
    busy,
    cleanupRecorder,
    finalizeBlob,
    inputMode,
    runPipeline,
    startRecording,
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
    <>
      <div
        className={
          docked
            ? "flex w-[min(16rem,calc(100vw-2rem))] flex-col items-stretch gap-2"
            : "fixed bottom-6 right-6 z-[100] flex w-[min(16rem,calc(100vw-2rem))] flex-col items-stretch gap-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        }
        role="group"
        aria-label={`Voice tutor — ${AI_ASSISTANT_NAME}`}
      >
        <VoiceTutorTranscriptSidebar
          open={transcriptOpen}
          filter={transcriptFilter}
          onFilterChange={setTranscriptFilter}
          micActive={
            inputMode === "live" &&
            (livePhase === "recording" || livePhase === "listening")
          }
          aiSpeaking={inputMode === "live" && livePhase === "speaking"}
          partialUserText={partialUserDraft}
          userLines={userTranscriptLines}
          aiSegments={aiTranscriptSegments}
          liveAssistantText={liveAssistantText}
          assistantHighlight={assistantHighlight}
          floating={false}
        />
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => setTranscriptOpen((o) => !o)}
            className="rounded-lg border border-zinc-200/90 bg-white/90 px-2 py-1 text-[10px] font-semibold text-zinc-600 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {transcriptOpen ? "Hide transcript" : "Transcript"}
          </button>
        </div>
      <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300">
        <span className="pl-1">Input</span>
        <div className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
          <button
            type="button"
            onClick={() => {
              void cleanupRecorder();
              setHoldRecording(false);
              setInputMode("hold");
            }}
            className={modeButtonClass(inputMode === "hold")}
            title="Hold the mic button or press & hold M to talk"
          >
            Hold M
          </button>
          <button
            type="button"
            onClick={() => {
              hasInteractedRef.current = true;
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

      <div className="flex items-center gap-2 rounded-xl border border-zinc-200/90 bg-white/95 px-2 py-1.5 text-[10px] font-medium text-zinc-600 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-300">
        <span className="pl-1">Lang</span>
        <select
          value={voiceLanguage}
          onChange={(e) =>
            handleVoiceLanguageChange(e.target.value as VoiceLanguageCode)
          }
          className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-xs font-semibold text-zinc-800 shadow-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
          aria-label="Voice language"
        >
          {VOICE_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>
              {lang.label}
            </option>
          ))}
        </select>
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

      {/* Audio visualizer — flowing neon ribbon for mic input and assistant playback. */}
        <div className="rounded-xl border border-zinc-200/90 bg-gradient-to-b from-zinc-900 to-zinc-950 px-3 py-2 shadow-sm dark:border-zinc-700">
          <VoiceWaveform
            streamRef={streamRef}
            audioElementRef={audioRef}
            phase={
              inputMode === "live"
                ? livePhase
                : holdRecording
                  ? "recording"
                  : busy
                    ? "speaking"
                    : "off"
            }
          />
        </div>

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
          aria-pressed={holdRecording}
          onPointerDown={onPointerDownHold}
          onPointerUp={onPointerUpHold}
          onPointerCancel={onPointerUpHold}
          onPointerLeave={(e) => {
            if (e.buttons === 0) void onPointerUpHold(e);
          }}
          className={micButtonClass}
          title="Hold the button (or press & hold M) — release to send"
        >
          {busy ? (
            <>
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500"
                aria-hidden
              />
              Speaking…
            </>
          ) : holdRecording ? (
            <>Listening…</>
          ) : (
            <>
              Voice
              <kbd className="ml-1 hidden rounded border border-zinc-300 bg-zinc-100 px-1 text-[10px] font-semibold text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 sm:inline">
                hold M
              </kbd>
            </>
          )}
        </button>
      )}

      {error && hasInteractedRef.current ? (
        <div className="flex max-w-[14rem] items-start gap-1.5">
          <p className="flex-1 text-xs leading-snug text-red-500 dark:text-red-400">
            {error}
          </p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="-mt-0.5 rounded p-0.5 text-red-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden
            >
              <path
                fillRule="evenodd"
                d="M10 8.586l4.293-4.293a1 1 0 011.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 011.414-1.414L10 8.586z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      ) : (
        <p className="max-w-[14rem] text-[10px] leading-snug text-zinc-400 dark:text-zinc-500">
          {inputMode === "hold"
            ? "Hold the button and speak — Rose will reply when you let go."
            : livePhase === "off"
              ? "Starting up…"
              : "Listening — just start talking to Rose."}
        </p>
      )}
      </div>
    </>
  );
}
