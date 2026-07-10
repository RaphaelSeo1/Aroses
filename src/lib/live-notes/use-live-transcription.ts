"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  acquireLectureCaptureStream,
  audioOnlyStream,
  LectureCaptureError,
  type LiveCaptureSource,
  type SharedSurface,
} from "@/lib/live-notes/capture";

export type { LiveCaptureSource } from "@/lib/live-notes/capture";

/**
 * Live lecture transcription hook (Live Notes).
 *
 * Owns the whole capture chain: lecture audio (tab / system / mic — see
 * `capture.ts` for the source abstraction) → Deepgram live WebSocket
 * (nova-3, same params as the voice tutor) → finalized segments → periodic
 * flush to /api/live-notes/[sessionId]/segments (on each finalized utterance,
 * every ~5s as a safety net, and on pause/tab-hide/unmount).
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

export type TranscriptSaveStatus = "idle" | "saving" | "saved" | "error";

const FLUSH_INTERVAL_MS = 5_000;
const KEEPALIVE_INTERVAL_MS = 5_000;
const RECORDER_TIMESLICE_MS = 250;
const SOCKET_OPEN_TIMEOUT_MS = 12_000;
/** Lecture endpointing: shorter than the tutor's Pause slider default. */
const ENDPOINTING_MS = 1_500;
/** Prefetched JWT is only useful briefly (Deepgram grant TTL is short). */
const TOKEN_PREFETCH_MAX_AGE_MS = 90_000;
const RECONNECT_DELAYS_MS = [1_000, 3_000, 8_000];
/** Commit a segment mid-utterance if the lecturer never pauses. */
const MAX_UTTERANCE_CHARS = 1_200;
/**
 * If Deepgram never sends speech_final (marathon sentence, noisy room), bank
 * whatever is in the utterance buffer after this idle window so it still hits
 * the autosave flush instead of living only in RAM.
 */
const STALE_UTTERANCE_MS = 8_000;

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
  const [transcriptSaveStatus, setTranscriptSaveStatus] =
    useState<TranscriptSaveStatus>("idle");
  const [transcriptLastSavedAt, setTranscriptLastSavedAt] = useState<
    number | null
  >(null);
  /** Segments committed locally but not yet confirmed by the server. */
  const [transcriptPendingCount, setTranscriptPendingCount] = useState(0);
  /** Source currently feeding audio (null until the first start). */
  const [activeSource, setActiveSource] = useState<LiveCaptureSource | null>(
    null
  );
  /** Full capture stream (audio ± video) for preview + vision consumers. */
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [hasVideo, setHasVideo] = useState(false);
  const [sharedSurface, setSharedSurface] = useState<SharedSurface | null>(
    null
  );

  /** Prefetch while the share picker is open so connect isn't blocked on grant. */
  const prefetchedTokenRef = useRef<{
    accessToken: string;
    fetchedAt: number;
  } | null>(null);
  const prefetchInFlightRef = useRef<Promise<string | null> | null>(null);

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
  const flushQueuedRef = useRef(false);
  /** Last time Deepgram delivered transcript text (final or interim). */
  const lastTranscriptAtRef = useRef(Date.now());

  const syncPendingCount = useCallback(() => {
    setTranscriptPendingCount(pendingFlushRef.current.length);
  }, []);

  const flushSegments = useCallback(async (): Promise<void> => {
    if (flushInFlightRef.current) {
      flushQueuedRef.current = true;
      return;
    }
    const batch = pendingFlushRef.current;
    if (batch.length === 0) return;
    flushInFlightRef.current = true;
    setTranscriptSaveStatus("saving");
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
        syncPendingCount();
        setTranscriptSaveStatus("saved");
        setTranscriptLastSavedAt(Date.now());
      } else {
        setTranscriptSaveStatus("error");
        console.warn("[live-notes] segment flush failed", res.status);
      }
      // Non-OK: keep the batch; seq-idempotency makes the retry safe.
    } catch {
      setTranscriptSaveStatus("error");
      // Network hiccup — retry on the next interval.
    } finally {
      flushInFlightRef.current = false;
      if (flushQueuedRef.current && pendingFlushRef.current.length > 0) {
        flushQueuedRef.current = false;
        void flushSegments();
      }
    }
  }, [sessionId, currentElapsedMs, syncPendingCount]);

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
    syncPendingCount();
    onSegmentRef.current?.(segment);
    // Autosave each finalized utterance — don't wait for the 5s safety timer.
    void flushSegments();
  }, [currentElapsedMs, syncPendingCount, flushSegments]);

  /** Bank in-flight speech, then flush — used on pause, finish, and tab hide. */
  const saveTranscriptNow = useCallback(async (): Promise<void> => {
    commitUtterance();
    await flushSegments();
    if (pendingFlushRef.current.length > 0) {
      await flushSegments();
    }
  }, [commitUtterance, flushSegments]);

  const commitUtteranceRef = useRef(commitUtterance);
  commitUtteranceRef.current = commitUtterance;
  const saveTranscriptNowRef = useRef(saveTranscriptNow);
  saveTranscriptNowRef.current = saveTranscriptNow;
  const currentElapsedMsRef = useRef(currentElapsedMs);
  currentElapsedMsRef.current = currentElapsedMs;

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
    setMediaStream(null);
    setHasVideo(false);
    setSharedSurface(null);
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
   * Video-only end disables preview/vision but keeps transcription going.
   */
  const watchTrackEnded = useCallback((stream: MediaStream) => {
    const audio = stream.getAudioTracks()[0];
    if (audio) {
      audio.addEventListener("ended", () => {
        if (streamRef.current !== stream) return; // superseded stream
        if (statusRef.current === "idle") return;
        onErrorRef.current?.(
          lastSourceRef.current === "mic"
            ? "The microphone stopped. Press Resume to reconnect it, or Finish to build the course."
            : "Audio sharing ended. Press Resume to pick the lecture source again, or Finish to build the course with what was captured."
        );
        void pauseRef.current?.();
      });
    }
    for (const video of stream.getVideoTracks()) {
      video.addEventListener("ended", () => {
        if (streamRef.current !== stream) return;
        setHasVideo(false);
      });
    }
  }, []);

  const fetchDeepgramAccessToken = useCallback(async (): Promise<string> => {
    const cached = prefetchedTokenRef.current;
    if (
      cached &&
      Date.now() - cached.fetchedAt < TOKEN_PREFETCH_MAX_AGE_MS
    ) {
      prefetchedTokenRef.current = null;
      return cached.accessToken;
    }

    if (prefetchInFlightRef.current) {
      const fromPrefetch = await prefetchInFlightRef.current;
      prefetchInFlightRef.current = null;
      if (fromPrefetch) {
        prefetchedTokenRef.current = null;
        return fromPrefetch;
      }
    }

    const tokenController = new AbortController();
    const tokenTimer = window.setTimeout(() => tokenController.abort(), 12_000);
    let tokenRes: Response;
    try {
      tokenRes = await fetch(`/api/live-notes/${sessionId}/deepgram-token`, {
        method: "POST",
        signal: tokenController.signal,
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error(
          "Timed out waiting for the transcription service. Check your connection and try again."
        );
      }
      throw e instanceof Error
        ? e
        : new Error("Could not reach the transcription service.");
    } finally {
      window.clearTimeout(tokenTimer);
    }
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as {
      accessToken?: string;
      error?: string;
      code?: string;
    };
    if (tokenRes.status === 402) {
      onCappedRef.current?.();
      throw new Error(tokenBody.error || "Monthly voice allowance reached.");
    }
    if (!tokenRes.ok || typeof tokenBody.accessToken !== "string") {
      throw new Error(
        tokenBody.error ||
          `Deepgram token failed with status ${tokenRes.status}.`
      );
    }
    return tokenBody.accessToken;
  }, [sessionId]);

  /**
   * Warm the Deepgram JWT while Chrome's share picker is open so connect
   * after Share isn't blocked on a slow /auth/grant.
   */
  const prefetchToken = useCallback(() => {
    if (prefetchedTokenRef.current) {
      const age = Date.now() - prefetchedTokenRef.current.fetchedAt;
      if (age < TOKEN_PREFETCH_MAX_AGE_MS) return;
    }
    if (prefetchInFlightRef.current) return;
    prefetchInFlightRef.current = (async () => {
      try {
        const tokenController = new AbortController();
        const tokenTimer = window.setTimeout(
          () => tokenController.abort(),
          12_000
        );
        let tokenRes: Response;
        try {
          tokenRes = await fetch(`/api/live-notes/${sessionId}/deepgram-token`, {
            method: "POST",
            signal: tokenController.signal,
          });
        } finally {
          window.clearTimeout(tokenTimer);
        }
        const tokenBody = (await tokenRes.json().catch(() => ({}))) as {
          accessToken?: string;
        };
        if (!tokenRes.ok || typeof tokenBody.accessToken !== "string") {
          return null;
        }
        prefetchedTokenRef.current = {
          accessToken: tokenBody.accessToken,
          fetchedAt: Date.now(),
        };
        return tokenBody.accessToken;
      } catch {
        return null;
      } finally {
        prefetchInFlightRef.current = null;
      }
    })();
  }, [sessionId]);

  const connectSocket = useCallback(async (): Promise<WebSocket> => {
    const accessToken = await fetchDeepgramAccessToken();

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
      ["bearer", accessToken]
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
          lastTranscriptAtRef.current = Date.now();
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
  }, [fetchDeepgramAccessToken, commitUtterance]);

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
    if (!stream) {
      throw new Error("No capture stream available for transcription.");
    }
    // Deepgram must receive audio-only — never mux the video track.
    const audioStream = audioOnlyStream(stream);
    if (audioStream.getAudioTracks().length === 0) {
      throw new Error("No audio track available for transcription.");
    }
    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(
        audioStream,
        mimeType ? { mimeType } : undefined
      );
    } catch {
      recorder = new MediaRecorder(audioStream);
    }
    recorderRef.current = recorder;
    recorderSocketRef.current = ws;
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(ev.data);
      }
    };
    recorder.onerror = () => {
      onErrorRef.current?.(
        "Audio recording failed. Press Resume to reconnect, or Finish to save what you have."
      );
    };
    try {
      recorder.start(RECORDER_TIMESLICE_MS);
    } catch (e) {
      recorderRef.current = null;
      recorderSocketRef.current = null;
      throw e instanceof Error
        ? e
        : new Error("Could not start audio recording for transcription.");
    }
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

      // Warm Deepgram while the user is in Chrome's share picker.
      prefetchToken();

      // 1. Capture — one stream for Deepgram + preview + vision.
      //    Missing audio throws and blocks start; video is optional.
      let stream: MediaStream;
      let captureHasVideo = false;
      let captureSurface: SharedSurface = "unknown";
      try {
        const capture = await acquireLectureCaptureStream(source);
        stream = capture.stream;
        captureHasVideo = capture.hasVideo;
        captureSurface = capture.surface;
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
      // Show the lecture preview immediately — don't wait on Deepgram.
      setHasVideo(captureHasVideo);
      setSharedSurface(captureSurface);
      setMediaStream(stream);
      setActiveSource(source);

      try {
        // 2. Socket (uses prefetched token when available).
        const ws = await connectSocket();
        socketRef.current = ws;

        // 3. Recorder (paired to this socket).
        startRecorderForSocket(ws);

        // 4. Timers.
        runningSinceRef.current = Date.now();
        elapsedTimerRef.current = window.setInterval(() => {
          setElapsedMs(currentElapsedMs());
        }, 1_000) as unknown as number;
        flushTimerRef.current = window.setInterval(() => {
          const stale =
            utteranceBufferRef.current.trim().length >= 80 &&
            Date.now() - lastTranscriptAtRef.current > STALE_UTTERANCE_MS;
          if (stale) {
            commitUtteranceRef.current();
          }
          void flushSegments();
        }, FLUSH_INTERVAL_MS) as unknown as number;
        keepAliveTimerRef.current = window.setInterval(() => {
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
      } catch (e) {
        // Keep the shared screen / preview alive so the user doesn't have to
        // re-pick a tab — they can retry transcription with Resume.
        setStatusBoth("error");
        onErrorRef.current?.(
          e instanceof Error
            ? `${e.message} Preview is still up — press Resume to retry transcription.`
            : "Live transcription failed to start. Press Resume to retry."
        );
        // Capture succeeded — treat as started so the UI keeps the preview.
        return true;
      }
    },
    [
      setStatusBoth,
      prefetchToken,
      watchTrackEnded,
      connectSocket,
      startRecorderForSocket,
      currentElapsedMs,
      flushSegments,
    ]
  );

  /**
   * Hot-swap the audio source mid-session (e.g. mic → tab when the lecture
   * moves on screen, or tab → mic when it moves into the room). The new
   * capture is acquired FIRST — if the user cancels the picker or shares a
   * surface without audio, the old source keeps recording untouched. On
   * success the elapsed clock, segment numbering, and notes all continue
   * seamlessly; only the audio plumbing (stream + socket + recorder) is
   * rebuilt, honoring the recorder/socket WebM-header pairing invariant.
   */
  const switchSource = useCallback(
    async (source: LiveCaptureSource): Promise<boolean> => {
      const st = statusRef.current;
      if (st === "idle" || st === "connecting") return false; // use start()
      const currentTrack = streamRef.current?.getAudioTracks()[0];
      if (
        source === lastSourceRef.current &&
        currentTrack &&
        currentTrack.readyState === "live"
      ) {
        return true; // already capturing from this source
      }

      let fresh: MediaStream;
      try {
        const capture = await acquireLectureCaptureStream(source);
        fresh = capture.stream;
        setHasVideo(capture.hasVideo);
        setSharedSurface(capture.surface);
      } catch (e) {
        onErrorRef.current?.(
          e instanceof Error && e.message
            ? e.message
            : "Could not switch the audio source."
        );
        return false;
      }

      // Bank the utterance captured under the old source before it goes away.
      commitUtterance();

      // Cancel any queued reconnect — it belongs to the old socket and would
      // otherwise race the fresh connection below into a duplicate.
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      reconnectAttemptRef.current = 0;

      lastSourceRef.current = source;
      setActiveSource(source);
      const old = streamRef.current;
      streamRef.current = fresh;
      setMediaStream(fresh);
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

      if (st === "paused") {
        // Stay paused on the new source. The old recorder's stream is dead,
        // so drop it — resume() will take its full-restart path and pair a
        // fresh recorder with a fresh socket.
        const rec = recorderRef.current;
        recorderRef.current = null;
        recorderSocketRef.current = null;
        if (rec && rec.state !== "inactive") {
          try {
            rec.stop();
          } catch {
            /* ignore */
          }
        }
        return true;
      }

      // Live: rebuild socket + recorder as a pair.
      setStatusBoth("reconnecting");
      try {
        closeSocket();
        const ws = await connectSocket();
        socketRef.current = ws;
        startRecorderForSocket(ws);
        reconnectAttemptRef.current = 0;
        setStatusBoth("recording");
        return true;
      } catch (e) {
        setStatusBoth("error");
        onErrorRef.current?.(
          e instanceof Error && e.message
            ? e.message
            : "Switched the audio source but could not reconnect transcription. Press Resume to retry."
        );
        return false;
      }
    },
    [
      commitUtterance,
      watchTrackEnded,
      setStatusBoth,
      closeSocket,
      connectSocket,
      startRecorderForSocket,
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
    setStatusBoth("paused");
    void saveTranscriptNow();
    void fetch(`/api/live-notes/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: "paused",
        durationSeconds: Math.round(currentElapsedMs() / 1000),
      }),
    }).catch(() => {});
  }, [sessionId, setStatusBoth, saveTranscriptNow, currentElapsedMs]);

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
        const capture = await acquireLectureCaptureStream(lastSourceRef.current);
        const fresh = capture.stream;
        setHasVideo(capture.hasVideo);
        setSharedSurface(capture.surface);
        const old = streamRef.current;
        streamRef.current = fresh;
        setMediaStream(fresh);
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

  // Teardown + tab-hide: bank in-flight speech and keepalive-flush anything
  // committed so navigating away mid-lecture doesn't strand transcript in RAM.
  useEffect(() => {
    const onHide = () => {
      void saveTranscriptNowRef.current();
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      intentionalCloseRef.current = true;
      clearTimers();
      commitUtteranceRef.current();
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
              durationSeconds: Math.round(currentElapsedMsRef.current() / 1000),
            }),
            keepalive: true,
          });
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return {
    status,
    partialText,
    elapsedMs,
    transcriptSaveStatus,
    transcriptLastSavedAt,
    transcriptPendingCount,
    /** Source currently feeding audio (null before the first start). */
    activeSource,
    /** Full MediaStream for preview + vision (same capture as Deepgram). */
    mediaStream,
    hasVideo,
    sharedSurface,
    start,
    pause,
    resume,
    stop,
    /** Hot-swap the audio source mid-session without losing anything. */
    switchSource,
    /** Warm Deepgram JWT while the share picker is open. */
    prefetchToken,
    /** Bank in-flight speech and flush now (finish, tab hide, manual). */
    flushNow: saveTranscriptNow,
  };
}
