"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireLectureAudioStream,
  LectureCaptureError,
  type LiveCaptureSource,
} from "@/lib/live-notes/capture";

export type { LiveCaptureSource } from "@/lib/live-notes/capture";

/**
 * Live lecture transcription hook (Live Notes).
 *
 * Owns the whole capture chain: lecture audio (tab / system / mic — see
 * `capture.ts` for the source abstraction) → Deepgram live WebSocket
 * (nova-3, same params as the voice tutor) → finalized segments → periodic
 * flush to /api/live-notes/[sessionId]/segments.
 *
 * Hardening the voice-tutor dock never needed but a 90-minute lecture does:
 *   - AUTO-RECONNECT on socket drop with a fresh token + exponential backoff.
 *   - KEEPALIVE frames while paused (Deepgram closes sockets after ~10s of
 *     silence with no audio bytes).
 *   - IDEMPOTENT FLUSH: segments carry a client-assigned `seq`; retried
 *     flushes can never duplicate transcript text server-side.
 *   - RECORDER/SOCKET PAIRING: a MediaRecorder writes its WebM container
 *     header only into the FIRST chunk of a recording, so a socket that
 *     joins mid-recording would get headerless Opus clusters it cannot
 *     decode. Invariant: every new socket gets a brand-new recorder, and a
 *     recorder only ever feeds the socket it was created for.
 */

export type LiveTranscriptSegment = {
  seq: number;
  text: string;
  /** Offset from recording start (excludes paused time). */
  atMs: number;
};

export type LiveTranscriptionStatus =
  | "idle"
  | "connecting"
  | "recording"
  | "paused"
  | "reconnecting"
  | "error";

const FLUSH_INTERVAL_MS = 15_000;
const KEEPALIVE_INTERVAL_MS = 5_000;
const RECORDER_TIMESLICE_MS = 250;
const SOCKET_OPEN_TIMEOUT_MS = 8_000;
/** Lecture endpointing: shorter than the tutor's Pause slider default. */
const ENDPOINTING_MS = 1_500;
const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000];
/** Commit a segment mid-utterance if the lecturer never pauses. */
const MAX_UTTERANCE_CHARS = 1_200;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t));
}

type DeepgramResultMessage = {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: Array<{ transcript?: string }>;
  };
};

export function useLiveLectureTranscription(options: {
  sessionId: string;
  /** Continue numbering after a reload (last stored seq + 1; 0 for fresh). */
  initialNextSeq?: number;
  /** Recorded ms already banked before this mount (resume support). */
  initialElapsedMs?: number;
  /** Fired when finalized segments are committed locally (before flush). */
  onSegment?: (segment: LiveTranscriptSegment) => void;
  /** Fired at utterance boundaries — the natural-break signal for synthesis. */
  onNaturalBreak?: () => void;
  /** Monthly voice allowance exhausted (server 402). */
  onCapped?: () => void;
  onError?: (message: string) => void;
}) {
  const {
    sessionId,
    initialNextSeq = 0,
    initialElapsedMs = 0,
    onSegment,
    onNaturalBreak,
    onCapped,
    onError,
  } = options;

  const [status, setStatus] = useState<LiveTranscriptionStatus>("idle");
  const [partialText, setPartialText] = useState("");
  const [elapsedMs, setElapsedMs] = useState(initialElapsedMs);

  // Callbacks in refs so socket handlers never hold stale closures.
  const onSegmentRef = useRef(onSegment);
  onSegmentRef.current = onSegment;
  const onNaturalBreakRef = useRef(onNaturalBreak);
  onNaturalBreakRef.current = onNaturalBreak;
  const onCappedRef = useRef(onCapped);
  onCappedRef.current = onCapped;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const statusRef = useRef<LiveTranscriptionStatus>("idle");
  const setStatusBoth = useCallback((s: LiveTranscriptionStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  /** Which socket the current recorder feeds (recorder/socket pairing). */
  const recorderSocketRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Last chosen source — Resume re-acquires from it after "Stop sharing". */
  const lastSourceRef = useRef<LiveCaptureSource>("tab");
  /** True while we are tearing down deliberately (stop). */
  const intentionalCloseRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const keepAliveTimerRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);

  /** Recording-time accounting (excludes paused stretches). */
  const bankedMsRef = useRef(initialElapsedMs);
  const runningSinceRef = useRef<number | null>(null);

  const currentElapsedMs = useCallback(() => {
    const running = runningSinceRef.current;
    return bankedMsRef.current + (running != null ? Date.now() - running : 0);
  }, []);

  /** Finalized-but-uncommitted text of the utterance in flight. */
  const utteranceBufferRef = useRef("");
  const nextSeqRef = useRef(initialNextSeq);
  /** Committed segments waiting for the next flush. */
  const pendingFlushRef = useRef<LiveTranscriptSegment[]>([]);
  const flushInFlightRef = useRef(false);

  const commitUtterance = useCallback(() => {
    const text = utteranceBufferRef.current.trim();
    utteranceBufferRef.current = "";
    setPartialText("");
    if (!text) return;
    const segment: LiveTranscriptSegment = {
      seq: nextSeqRef.current++,
      text,
      atMs: Math.max(0, Math.round(currentElapsedMs())),
    };
    pendingFlushRef.current.push(segment);
    onSegmentRef.current?.(segment);
  }, [currentElapsedMs]);

  const flushSegments = useCallback(async (): Promise<void> => {
    if (flushInFlightRef.current) return;
    const batch = pendingFlushRef.current;
    if (batch.length === 0) return;
    flushInFlightRef.current = true;
    try {
      const res = await fetch(`/api/live-notes/${sessionId}/segments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segments: batch.map((s) => ({ seq: s.seq, text: s.text, atMs: s.atMs })),
          durationSeconds: Math.round(currentElapsedMs() / 1000),
        }),
      });
      if (res.ok) {
        // Remove exactly what we sent; new segments may have arrived meanwhile.
        const sentSeqs = new Set(batch.map((s) => s.seq));
        pendingFlushRef.current = pendingFlushRef.current.filter(
          (s) => !sentSeqs.has(s.seq)
        );
      }
      // Non-OK: keep the batch; seq-idempotency makes the retry safe.
    } catch {
      // Network hiccup — retry on the next interval.
    } finally {
      flushInFlightRef.current = false;
    }
  }, [sessionId, currentElapsedMs]);

  const clearTimers = useCallback(() => {
    for (const ref of [
      reconnectTimerRef,
      keepAliveTimerRef,
      flushTimerRef,
      elapsedTimerRef,
    ]) {
      if (ref.current != null) {
        window.clearInterval(ref.current);
        window.clearTimeout(ref.current);
        ref.current = null;
      }
    }
  }, []);

  const closeSocket = useCallback(() => {
    const ws = socketRef.current;
    // Null the ref FIRST: the onclose handler treats a socket that is no
    // longer current as superseded and never schedules a reconnect for it.
    socketRef.current = null;
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
  }, []);

  const stopRecorderAndStream = useCallback(() => {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    recorderSocketRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        /* ignore */
      }
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* ignore */
        }
      }
    }
  }, []);

  /**
   * Pause when the user ends the share from the browser's own UI (Chrome's
   * "Stop sharing" bar) or the mic device disappears. Resume re-acquires.
   */
  const watchTrackEnded = useCallback((stream: MediaStream) => {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.addEventListener("ended", () => {
      if (streamRef.current !== stream) return; // superseded stream
      if (statusRef.current === "idle") return;
      onErrorRef.current?.(
        lastSourceRef.current === "mic"
          ? "The microphone stopped. Press Resume to reconnect it, or Finish to build the course."
          : "Audio sharing ended. Press Resume to pick the lecture source again, or Finish to build the course with what was captured."
      );
      void pauseRef.current?.();
    });
  }, []);

  const connectSocket = useCallback(async (): Promise<WebSocket> => {
    const tokenRes = await fetch(`/api/live-notes/${sessionId}/deepgram-token`, {
      method: "POST",
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as {
      accessToken?: string;
      error?: string;
      code?: string;
    };
    if (tokenRes.status === 402) {
      onCappedRef.current?.();
      throw new Error(
        tokenBody.error || "Monthly voice allowance reached."
      );
    }
    if (!tokenRes.ok || typeof tokenBody.accessToken !== "string") {
      throw new Error(
        tokenBody.error || `Deepgram token failed with status ${tokenRes.status}.`
      );
    }

    const qs = new URLSearchParams({
      model: "nova-3",
      smart_format: "true",
      interim_results: "true",
      endpointing: String(ENDPOINTING_MS),
      utterance_end_ms: String(Math.max(1000, ENDPOINTING_MS)),
      vad_events: "true",
    });
    const ws = new WebSocket(
      `wss://api.deepgram.com/v1/listen?${qs.toString()}`,
      ["bearer", tokenBody.accessToken]
    );

    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        try {
          ws.close();
        } catch {
          /* ignore */
        }
        reject(new Error("Deepgram connection timed out."));
      }, SOCKET_OPEN_TIMEOUT_MS);
      ws.onopen = () => {
        window.clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(timer);
        reject(new Error("Deepgram connection failed."));
      };
    });

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(String(event.data)) as DeepgramResultMessage;
        if (msg.type === "UtteranceEnd") {
          commitUtterance();
          onNaturalBreakRef.current?.();
          return;
        }
        if (msg.type && msg.type !== "Results") return;
        const transcript =
          msg.channel?.alternatives?.[0]?.transcript?.trim() ?? "";
        if (transcript) {
          if (msg.is_final) {
            utteranceBufferRef.current =
              `${utteranceBufferRef.current} ${transcript}`.trim();
            setPartialText(utteranceBufferRef.current);
            // Marathon utterance guard — commit so flushes stay small and the
            // synthesis trigger keeps seeing progress.
            if (
              !msg.speech_final &&
              utteranceBufferRef.current.length >= MAX_UTTERANCE_CHARS
            ) {
              commitUtterance();
            }
          } else {
            const base = utteranceBufferRef.current.trim();
            setPartialText(base ? `${base} ${transcript}` : transcript);
          }
        }
        if (msg.speech_final) {
          commitUtterance();
          onNaturalBreakRef.current?.();
        }
      } catch {
        /* ignore malformed Deepgram frame */
      }
    };

    ws.onclose = () => {
      // A socket that is no longer current was superseded (resume/pause
      // restart or deliberate close) — never reconnect on its behalf, or a
      // stale close event would race a fresh connection into a duplicate.
      if (socketRef.current !== ws) return;
      socketRef.current = null;
      if (intentionalCloseRef.current) return;
      const st = statusRef.current;
      if (st !== "recording" && st !== "paused" && st !== "reconnecting") return;
      scheduleReconnectRef.current?.();
    };

    return ws;
  }, [sessionId, commitUtterance]);

  /**
   * (Re)create the MediaRecorder for a FRESH socket. The WebM container
   * header lives only in the first chunk a recorder emits, so this must
   * never be called for a socket that has already received audio.
   */
  const startRecorderForSocket = useCallback((ws: WebSocket) => {
    const old = recorderRef.current;
    recorderRef.current = null;
    recorderSocketRef.current = null;
    if (old && old.state !== "inactive") {
      try {
        old.stop();
      } catch {
        /* ignore */
      }
    }
    const stream = streamRef.current;
    if (!stream) return;
    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined
    );
    recorderRef.current = recorder;
    recorderSocketRef.current = ws;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(ev.data);
      }
    };
    recorder.start(RECORDER_TIMESLICE_MS);
  }, []);

  /** Defined via ref to avoid a circular useCallback dependency with connectSocket. */
  const scheduleReconnectRef = useRef<(() => void) | null>(null);

  scheduleReconnectRef.current = () => {
    const attempt = reconnectAttemptRef.current;
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      setStatusBoth("error");
      onErrorRef.current?.(
        "Lost the live transcription connection and could not reconnect. Your transcript so far is saved — check your network and press Resume."
      );
      return;
    }
    reconnectAttemptRef.current = attempt + 1;
    const wasPaused = statusRef.current === "paused";
    if (!wasPaused) setStatusBoth("reconnecting");
    reconnectTimerRef.current = window.setTimeout(async () => {
      reconnectTimerRef.current = null;
      // The surface may have stopped the session while we waited.
      if (intentionalCloseRef.current || statusRef.current === "idle") return;
      try {
        const ws = await connectSocket();
        socketRef.current = ws;
        // Fresh socket needs a fresh recorder (WebM header). While paused we
        // leave the recorder alone — resume() creates one.
        if (!wasPaused) startRecorderForSocket(ws);
        reconnectAttemptRef.current = 0;
        setStatusBoth(wasPaused ? "paused" : "recording");
      } catch {
        scheduleReconnectRef.current?.();
      }
    }, RECONNECT_DELAYS_MS[attempt]) as unknown as number;
  };

  const start = useCallback(
    async (source: LiveCaptureSource): Promise<boolean> => {
      if (statusRef.current !== "idle" && statusRef.current !== "error") {
        return false;
      }
      intentionalCloseRef.current = false;
      reconnectAttemptRef.current = 0;
      lastSourceRef.current = source;
      setStatusBoth("connecting");

      // 1. Capture — tab / system / mic all resolve to an audio-only stream;
      //    missing audio (e.g. tab shared without "Also share tab audio")
      //    throws with platform-specific guidance and blocks the start.
      let stream: MediaStream;
      try {
        stream = await acquireLectureAudioStream(source);
      } catch (e) {
        setStatusBoth("idle");
        onErrorRef.current?.(
          e instanceof LectureCaptureError || (e instanceof Error && e.message)
            ? (e as Error).message
            : "Could not access audio. Check browser permissions."
        );
        return false;
      }
      streamRef.current = stream;
      watchTrackEnded(stream);

      // 2. Socket.
      let ws: WebSocket;
      try {
        ws = await connectSocket();
      } catch (e) {
        stopRecorderAndStream();
        setStatusBoth("idle");
        onErrorRef.current?.(
          e instanceof Error ? e.message : "Live transcription failed to start."
        );
        return false;
      }
      socketRef.current = ws;

      // 3. Recorder (paired to this socket).
      startRecorderForSocket(ws);

      // 4. Timers.
      runningSinceRef.current = Date.now();
      elapsedTimerRef.current = window.setInterval(() => {
        setElapsedMs(currentElapsedMs());
      }, 1_000) as unknown as number;
      flushTimerRef.current = window.setInterval(() => {
        void flushSegments();
      }, FLUSH_INTERVAL_MS) as unknown as number;
      keepAliveTimerRef.current = window.setInterval(() => {
        // Deepgram drops sockets after ~10s without audio. While paused the
        // recorder sends nothing, so keep the connection warm explicitly.
        const s = socketRef.current;
        if (
          statusRef.current === "paused" &&
          s &&
          s.readyState === WebSocket.OPEN
        ) {
          try {
            s.send(JSON.stringify({ type: "KeepAlive" }));
          } catch {
            /* ignore */
          }
        }
      }, KEEPALIVE_INTERVAL_MS) as unknown as number;

      setStatusBoth("recording");
      return true;
    },
    [
      setStatusBoth,
      watchTrackEnded,
      connectSocket,
      startRecorderForSocket,
      stopRecorderAndStream,
      currentElapsedMs,
      flushSegments,
    ]
  );

  const pause = useCallback(async () => {
    if (statusRef.current !== "recording" && statusRef.current !== "reconnecting") {
      return;
    }
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      try {
        recorder.pause();
      } catch {
        /* ignore */
      }
    }
    if (runningSinceRef.current != null) {
      bankedMsRef.current += Date.now() - runningSinceRef.current;
      runningSinceRef.current = null;
    }
    commitUtterance();
    setStatusBoth("paused");
    void flushSegments();
    void fetch(`/api/live-notes/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "paused",
        durationSeconds: Math.round(currentElapsedMs() / 1000),
      }),
    }).catch(() => {});
  }, [sessionId, commitUtterance, setStatusBoth, flushSegments, currentElapsedMs]);

  const pauseRef = useRef<typeof pause | null>(null);
  pauseRef.current = pause;

  const resume = useCallback(async () => {
    if (statusRef.current !== "paused" && statusRef.current !== "error") return;

    const markRecording = () => {
      if (runningSinceRef.current == null) {
        runningSinceRef.current = Date.now();
      }
      setStatusBoth("recording");
      void fetch(`/api/live-notes/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "recording" }),
      }).catch(() => {});
    };

    // Fast path: same live socket, same paused recorder, live track — a
    // plain MediaRecorder.resume() continues the original WebM stream.
    const currentWs = socketRef.current;
    const recorder = recorderRef.current;
    const track = streamRef.current?.getAudioTracks()[0];
    if (
      currentWs &&
      currentWs.readyState === WebSocket.OPEN &&
      recorder &&
      recorder.state === "paused" &&
      recorderSocketRef.current === currentWs &&
      track &&
      track.readyState === "live"
    ) {
      let resumed = false;
      try {
        recorder.resume();
        // Re-read via a widened type: TS narrowed `state` to "paused" from
        // the guard above and doesn't model resume()'s mutation.
        resumed =
          (recorder as MediaRecorder).state === ("recording" as RecordingState);
      } catch {
        /* fall through to the full restart below */
      }
      if (resumed) {
        markRecording();
        return;
      }
    }

    // Full restart: re-acquire the audio if the share ended (the Resume
    // click is a user gesture, so getDisplayMedia may be called again), then
    // pair a fresh recorder with a fresh socket — never reuse a socket that
    // already received audio under an older WebM header.
    setStatusBoth("reconnecting");
    try {
      if (!track || track.readyState !== "live") {
        const fresh = await acquireLectureAudioStream(lastSourceRef.current);
        const old = streamRef.current;
        streamRef.current = fresh;
        if (old) {
          for (const t of old.getTracks()) {
            try {
              t.stop();
            } catch {
              /* ignore */
            }
          }
        }
        watchTrackEnded(fresh);
      }
      closeSocket();
      const ws = await connectSocket();
      socketRef.current = ws;
      startRecorderForSocket(ws);
      reconnectAttemptRef.current = 0;
      markRecording();
    } catch (e) {
      setStatusBoth("error");
      onErrorRef.current?.(
        e instanceof Error && e.message ? e.message : "Could not reconnect."
      );
    }
  }, [
    sessionId,
    setStatusBoth,
    watchTrackEnded,
    closeSocket,
    connectSocket,
    startRecorderForSocket,
  ]);

  /**
   * Stop capture and flush everything. Resolves once the final flush attempt
   * finishes — callers can then hit /complete knowing the transcript is saved.
   */
  const stop = useCallback(async () => {
    intentionalCloseRef.current = true;
    clearTimers();
    if (runningSinceRef.current != null) {
      bankedMsRef.current += Date.now() - runningSinceRef.current;
      runningSinceRef.current = null;
    }
    setElapsedMs(bankedMsRef.current);
    commitUtterance();
    stopRecorderAndStream();
    closeSocket();
    setStatusBoth("idle");
    await flushSegments();
    // One retry so a single blip doesn't strand the tail of the lecture.
    if (pendingFlushRef.current.length > 0) {
      await flushSegments();
    }
  }, [
    clearTimers,
    commitUtterance,
    stopRecorderAndStream,
    closeSocket,
    setStatusBoth,
    flushSegments,
  ]);

  // Teardown on unmount; best-effort keepalive flush of any committed tail.
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      clearTimers();
      stopRecorderAndStream();
      closeSocket();
      const batch = pendingFlushRef.current;
      if (batch.length > 0) {
        try {
          void fetch(`/api/live-notes/${sessionId}/segments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              segments: batch.map((s) => ({
                seq: s.seq,
                text: s.text,
                atMs: s.atMs,
              })),
            }),
            keepalive: true,
          });
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    status,
    partialText,
    elapsedMs,
    start,
    pause,
    resume,
    stop,
    /** Force a flush now (used right before wrap-up). */
    flushNow: flushSegments,
  };
}
