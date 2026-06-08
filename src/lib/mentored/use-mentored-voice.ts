"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playMpegFromResponse } from "@/lib/voice-tutor/play-mpeg-from-response";

/**
 * Focused voice helper for the Mentored Learning runner.
 *
 * Primitives:
 *   - speak(text)              fetches streaming TTS and plays it
 *   - cancelSpeak()            aborts any in-flight or playing audio
 *   - startRecording()         opens the mic; returns a Blob promise that
 *                              resolves when stopRecording() is called
 *   - stopRecording()          ends the current recording
 *   - transcribe(blob)         POSTs to /api/voice-tutor/transcribe
 *   - recordUntilSilence()     opens the mic and auto-stops once the user
 *                              has stopped speaking for `silenceMs`; uses
 *                              the same RMS analyser as the barge-in VAD
 *
 * Barge-in (mid-speech interruption):
 *   - Pass `onBargeIn` to be notified when sustained voice activity is
 *     detected during a speak(). The hook cancels the speech immediately
 *     and invokes the callback. The runner typically reacts by starting a
 *     `recordUntilSilence()` capture so the student's interruption gets
 *     transcribed without any button press.
 *
 * Built on /api/voice-tutor/{tts,transcribe} — shares the same backend
 * VoiceTutorDock uses.
 */

export type MentoredVoiceState = {
  speaking: boolean;
  recording: boolean;
  transcribing: boolean;
  /** True while the post-barge-in auto-capture is collecting audio. */
  autoCapturing: boolean;
  error: string | null;
};

// VAD tuning — matched roughly to VoiceTutorDock so behaviour is consistent
// across the two surfaces. Slightly stricter barge-in threshold because the
// speaker is also playing into the room.
const BARGE_RMS = 0.07;
const BARGE_SUSTAIN_MS = 220;
const SILENCE_RMS = 0.014;
const DEFAULT_SILENCE_MS = 1400;
const MIN_SPEECH_MS = 180;

const TTS_VOICE_ID =
  process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || "Rachel";

type MentoredVoiceLanguage = "auto" | "en" | "es" | "fr" | "ko" | "ja" | "zh";

export function useMentoredVoice(opts: {
  /**
   * Identifier passed to the TTS + transcribe routes for access
   * control. Standard course / Mentored Learning use cases pass the
   * study material UUID; Tutor Sessions pass their session id.
   *
   * Pass either `materialId` or `sessionId` — not both. When
   * `sessionId` is set it's sent under the `sessionId` key in the
   * request body / form-data so the server can pick the right
   * access-check path.
   */
  materialId?: string;
  sessionId?: string;
  /**
   * Teaching language for TTS + Whisper. When set to a specific code
   * (e.g. "ko", "es") Rose speaks and listens in that language.
   * "auto" leaves language detection to the models.
   */
  voiceLanguage?: MentoredVoiceLanguage;
  /** 0.5 .. 2.0 — adjusts both TTS pitch and recorded playback */
  playbackRate?: number;
  /**
   * Fired when the VAD detects sustained voice activity while a `speak()`
   * is in progress. The hook cancels the speech first; the caller decides
   * what to do next (typically: `recordUntilSilence()` to capture the
   * student's interruption).
   */
  onBargeIn?: () => void;
  /**
   * Enables / disables the barge-in monitor. Default true. Set false from
   * the caller when the student has just released the mic (no need to
   * watch for barge-in if we're not speaking).
   */
  bargeInEnabled?: boolean;
  /** RMS threshold for barge-in detection (default 0.07). Higher = less sensitive. */
  bargeRms?: number;
  /** Ms of sustained voice above threshold before barge-in fires (default 220). */
  bargeSustainMs?: number;
  /**
   * Fired when a voice request is refused because the user has used up their
   * monthly voice allowance (HTTP 402). The caller should switch to text mode
   * — voice is the metered premium; everything else stays unlimited.
   */
  onVoiceCapReached?: () => void;
}) {
  const playbackRate = opts.playbackRate ?? 1;
  /** Live ref so mid-utterance speed changes apply to the next sentence/chunk. */
  const playbackRateRef = useRef(playbackRate);
  useEffect(() => {
    playbackRateRef.current = playbackRate;
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);
  const bargeInEnabled = opts.bargeInEnabled !== false;
  const bargeRms = opts.bargeRms ?? BARGE_RMS;
  const bargeSustainMs = opts.bargeSustainMs ?? BARGE_SUSTAIN_MS;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordResolveRef = useRef<((value: Blob | null) => void) | null>(null);

  // Barge-in VAD plumbing — separate stream from `mediaStreamRef` because
  // we want to monitor mic input while the AI is speaking even though
  // we're not recording yet.
  const bargeStreamRef = useRef<MediaStream | null>(null);
  const bargeCtxRef = useRef<AudioContext | null>(null);
  const bargeAnalyserRef = useRef<AnalyserNode | null>(null);
  const bargeBufRef = useRef<Uint8Array | null>(null);
  const bargeRafRef = useRef<number | null>(null);
  const bargeStartAtRef = useRef<number>(0);
  const bargeFiredRef = useRef<boolean>(false);
  const onBargeInRef = useRef<(() => void) | undefined>(opts.onBargeIn);
  useEffect(() => {
    onBargeInRef.current = opts.onBargeIn;
  }, [opts.onBargeIn]);

  // Fired (once per request) when a voice call returns 402 (cap reached). The
  // caller flips to text mode. Guarded so repeated 402s don't spam the caller.
  const onVoiceCapReachedRef = useRef<(() => void) | undefined>(
    opts.onVoiceCapReached
  );
  useEffect(() => {
    onVoiceCapReachedRef.current = opts.onVoiceCapReached;
  }, [opts.onVoiceCapReached]);
  const notifyVoiceCap = useCallback((status: number) => {
    if (status === 402) {
      try {
        onVoiceCapReachedRef.current?.();
      } catch {
        /* ignore caller errors */
      }
      return true;
    }
    return false;
  }, []);

  // Silence-detection plumbing (reused by `recordUntilSilence`). We tap
  // the same MediaStream the MediaRecorder is recording from.
  const silenceCtxRef = useRef<AudioContext | null>(null);
  const silenceAnalyserRef = useRef<AnalyserNode | null>(null);
  const silenceBufRef = useRef<Uint8Array | null>(null);
  const silenceRafRef = useRef<number | null>(null);

  const [state, setState] = useState<MentoredVoiceState>({
    speaking: false,
    recording: false,
    transcribing: false,
    autoCapturing: false,
    error: null,
  });

  // ===========================================================================
  // Barge-in VAD monitor
  // ===========================================================================
  //
  // While the assistant is speaking we keep a low-overhead RMS watcher on
  // the mic. The moment sustained voice activity crosses BARGE_RMS for
  // BARGE_SUSTAIN_MS, we cancel the speech and notify the caller.

  const stopBargeMonitor = useCallback(() => {
    if (bargeRafRef.current != null) {
      cancelAnimationFrame(bargeRafRef.current);
      bargeRafRef.current = null;
    }
    bargeAnalyserRef.current = null;
    bargeBufRef.current = null;
    bargeStartAtRef.current = 0;
    if (bargeCtxRef.current) {
      bargeCtxRef.current.close().catch(() => {});
      bargeCtxRef.current = null;
    }
    if (bargeStreamRef.current) {
      bargeStreamRef.current.getTracks().forEach((t) => t.stop());
      bargeStreamRef.current = null;
    }
  }, []);

  const startBargeMonitor = useCallback(async () => {
    if (!bargeInEnabled) return;
    if (bargeStreamRef.current) return; // already running
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      });
      bargeStreamRef.current = stream;
      const Ctx =
        window.AudioContext ||
        // Safari fallback — typed manually because TS doesn't ship webkit types.
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      bargeCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      bargeAnalyserRef.current = analyser;
      bargeBufRef.current = new Uint8Array(analyser.fftSize);
      bargeFiredRef.current = false;
      bargeStartAtRef.current = 0;

      // Sample at ~30fps instead of every animation frame — voice-activity
      // detection doesn't need 60fps, and this halves the analyser work that
      // runs the entire time Rose is speaking.
      const SAMPLE_INTERVAL_MS = 33;
      let lastSampleAt = 0;

      const loop = () => {
        const a = bargeAnalyserRef.current;
        const buf = bargeBufRef.current;
        if (!a || !buf) return;
        const sampleNow = performance.now();
        if (sampleNow - lastSampleAt < SAMPLE_INTERVAL_MS) {
          bargeRafRef.current = requestAnimationFrame(loop);
          return;
        }
        lastSampleAt = sampleNow;
        // TS lib.dom mismatch: AnalyserNode accepts Uint8Array, narrow at call site.
        a.getByteTimeDomainData(buf as unknown as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms >= bargeRms) {
          if (bargeStartAtRef.current === 0) bargeStartAtRef.current = now;
          else if (
            !bargeFiredRef.current &&
            now - bargeStartAtRef.current >= bargeSustainMs
          ) {
            bargeFiredRef.current = true;
            // Tear down the speech + invoke callback. Caller decides what
            // happens next (typically: recordUntilSilence).
            const cb = onBargeInRef.current;
            if (speakAbortRef.current) {
              speakAbortRef.current.abort();
              speakAbortRef.current = null;
            }
            try {
              audioRef.current?.pause();
            } catch {
              /* ignore */
            }
            audioRef.current = null;
            setState((s) => ({ ...s, speaking: false }));
            stopBargeMonitor();
            cb?.();
            return; // stop the rAF loop
          }
        } else {
          bargeStartAtRef.current = 0;
        }
        bargeRafRef.current = requestAnimationFrame(loop);
      };
      bargeRafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      // Mic permission denied or unsupported — barge-in just won't fire.
      // Speech still plays normally; user can interrupt with the mic button.
      console.warn("[useMentoredVoice barge monitor]", e);
      stopBargeMonitor();
    }
  }, [bargeInEnabled, bargeRms, bargeSustainMs, stopBargeMonitor]);

  // ----- speak -----
  const cancelSpeak = useCallback(() => {
    if (speakAbortRef.current) {
      speakAbortRef.current.abort();
      speakAbortRef.current = null;
    }
    try {
      audioRef.current?.pause();
    } catch {
      /* ignore */
    }
    audioRef.current = null;
    stopBargeMonitor();
    setState((s) => ({ ...s, speaking: false }));
  }, [stopBargeMonitor]);

  const voiceLanguage = opts.voiceLanguage ?? "auto";
  const voiceLanguageRef = useRef(voiceLanguage);
  useEffect(() => {
    voiceLanguageRef.current = voiceLanguage;
  }, [voiceLanguage]);

  const ttsFetch = useCallback(
    (text: string, previousText: string | undefined, signal: AbortSignal) =>
      fetch("/api/voice-tutor/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          ...(opts.sessionId
            ? { sessionId: opts.sessionId }
            : { materialId: opts.materialId }),
          voiceId: TTS_VOICE_ID,
          stream: true,
          ...(previousText ? { previousText: previousText.slice(-1500) } : {}),
          ...(voiceLanguageRef.current !== "auto"
            ? { voiceLanguage: voiceLanguageRef.current }
            : {}),
        }),
        signal,
      }),
    [opts.materialId, opts.sessionId]
  );

  /**
   * Speak `text` through ElevenLabs.
   *
   * `speakOpts.onPlay` fires the exact moment audio playback begins
   * (not when the request was sent). Callers that want to gate
   * transcript reveal on audio playback should pass this and only
   * call `setTutorReply` from inside it — that's what keeps the
   * captioning in sync with Rose's voice instead of racing ahead of
   * it.
   *
   * If the TTS request fails before any audio can play, `onPlay` is
   * fired anyway with `failed: true` so the transcript still appears
   * (per spec: "never leave the user staring at silence with no
   * feedback").
   */
  const speak = useCallback(
    async (
      text: string,
      speakOpts?: { onPlay?: (info: { failed: boolean }) => void }
    ): Promise<void> => {
      if (!text.trim()) return;
      cancelSpeak();
      const ac = new AbortController();
      speakAbortRef.current = ac;
      setState((s) => ({ ...s, speaking: true, error: null }));
      // Kick off the barge-in monitor in parallel — don't await it, mic
      // permission shouldn't block playback. If the user denies permission
      // this becomes a no-op and speech still plays.
      void startBargeMonitor();
      let revealed = false;
      const fireReveal = (failed: boolean) => {
        if (revealed) return;
        revealed = true;
        try {
          speakOpts?.onPlay?.({ failed });
        } catch {
          /* ignore */
        }
      };
      try {
        const res = await ttsFetch(text, undefined, ac.signal);
        if (!res.ok) {
          fireReveal(true);
          notifyVoiceCap(res.status);
          let msg = `TTS failed (${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) msg = body.error;
          } catch {
            /* ignore */
          }
          throw new Error(msg);
        }
        await playMpegFromResponse(res, {
          signal: ac.signal,
          playbackRate: playbackRateRef.current,
          audioRef,
          onFirstPlay: () => fireReveal(false),
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        // Make sure the caller still gets the reveal even on
        // unexpected playback failure — better silent text than no
        // text at all.
        fireReveal(true);
        const message = e instanceof Error ? e.message : "Speak failed";
        setState((s) => ({ ...s, error: message }));
      } finally {
        if (speakAbortRef.current === ac) speakAbortRef.current = null;
        // Stop the barge monitor when speech finishes naturally — it would
        // be left running otherwise and keep the mic permission indicator on.
        stopBargeMonitor();
        setState((s) => ({ ...s, speaking: false }));
      }
    },
    [cancelSpeak, notifyVoiceCap, startBargeMonitor, stopBargeMonitor, ttsFetch]
  );

  /**
   * Speak a stream of sentences as they become available, pipelining
   * the TTS fetches: while sentence N is playing, sentence N+1 is
   * already being fetched. This is the main latency lever for the
   * streaming Mentored turn — the student hears the first sentence
   * within 1-2s of finishing their utterance instead of waiting for
   * the whole reply to generate.
   *
   * Each sentence is sent with `previous_text` so ElevenLabs can keep
   * prosody continuous across the chunks.
   *
   * The caller controls the iterator; closing it (return/break) ends
   * playback once the in-flight sentences are done.
   */
  /**
   * Speak a stream of sentences. The optional `onSentencePlaying`
   * callback fires the moment each sentence's audio actually starts
   * playing (NOT when its TTS request was kicked off). Use this to
   * sync transcript text reveal with the spoken audio so the text
   * never races ahead of the voice. If a sentence's audio fails or
   * is aborted, `onSentencePlaying` is still called with
   * `failed: true` so the caller can fall back to revealing the
   * text rather than leaving it permanently hidden.
   *
   * Sentence indices match the position in the input iterable
   * (first yielded sentence is `index: 0`). Empty strings are
   * skipped and do NOT advance the index.
   */
  const speakSentenceStream = useCallback(
    async (
      sentences: AsyncIterable<string>,
      streamOpts?: {
        onSentencePlaying?: (
          text: string,
          index: number,
          info: { failed: boolean }
        ) => void;
      }
    ): Promise<void> => {
      cancelSpeak();
      const ac = new AbortController();
      speakAbortRef.current = ac;
      setState((s) => ({ ...s, speaking: true, error: null }));
      void startBargeMonitor();

      let previousText = "";
      // Sentence playback is serial — we await the prior playback before
      // starting the next one's playback, but the TTS network fetch for
      // sentence N+1 runs in parallel with sentence N's playback so we
      // don't restart latency from zero between sentences.
      let priorPlayback: Promise<void> = Promise.resolve();
      let nextIndex = 0;
      const failures: unknown[] = [];
      const fireReveal = (text: string, index: number, failed: boolean) => {
        try {
          streamOpts?.onSentencePlaying?.(text, index, { failed });
        } catch {
          /* swallow caller errors so they can't break playback */
        }
      };

      try {
        for await (const raw of sentences) {
          if (ac.signal.aborted) break;
          const sentence = raw.trim();
          if (!sentence) continue;

          const sentenceIndex = nextIndex++;
          const previousForThis = previousText;
          previousText = `${previousText} ${sentence}`.trim();
          const fetchPromise = ttsFetch(sentence, previousForThis, ac.signal);

          // Chain this sentence's playback onto the prior one. We don't
          // throw mid-stream so a single failed sentence doesn't kill
          // the rest of the reply. We track whether the reveal callback
          // has been fired so we never reveal the same sentence twice.
          priorPlayback = priorPlayback
            .catch(() => undefined)
            .then(async () => {
              if (ac.signal.aborted) {
                // Aborted mid-stream — don't reveal text we never
                // played. The caller (transcript) will see the
                // interruption and stop appending.
                return;
              }
              let revealed = false;
              const reveal = (failed: boolean) => {
                if (revealed) return;
                revealed = true;
                fireReveal(sentence, sentenceIndex, failed);
              };
              let res: Response;
              try {
                res = await fetchPromise;
              } catch (e) {
                failures.push(e);
                reveal(true);
                return;
              }
              if (!res.ok || ac.signal.aborted) {
                if (!res.ok) {
                  notifyVoiceCap(res.status);
                  failures.push(new Error(`TTS failed (${res.status})`));
                  reveal(true);
                }
                try {
                  await res.body?.cancel();
                } catch {
                  /* ignore */
                }
                return;
              }
              try {
                await playMpegFromResponse(res, {
                  signal: ac.signal,
                  playbackRate: playbackRateRef.current,
                  audioRef,
                  onFirstPlay: () => reveal(false),
                });
                // If for some reason `onFirstPlay` never fired (edge
                // case: stream ended with 0 bytes), still reveal so
                // text isn't lost.
                reveal(false);
              } catch (e) {
                failures.push(e);
                reveal(true);
              }
            });
        }
        await priorPlayback;
        if (failures.length > 0 && !ac.signal.aborted) {
          const first = failures[0];
          const msg = first instanceof Error ? first.message : "Speak failed";
          setState((s) => ({ ...s, error: msg }));
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        const message = e instanceof Error ? e.message : "Speak failed";
        setState((s) => ({ ...s, error: message }));
      } finally {
        if (speakAbortRef.current === ac) speakAbortRef.current = null;
        stopBargeMonitor();
        setState((s) => ({ ...s, speaking: false }));
      }
    },
    [cancelSpeak, notifyVoiceCap, startBargeMonitor, stopBargeMonitor, ttsFetch]
  );

  // ----- record -----
  const stopRecording = useCallback(async () => {
    const rec = recorderRef.current;
    if (!rec) return;
    try {
      rec.stop();
    } catch {
      /* ignore */
    }
  }, []);

  const startRecording = useCallback(async (): Promise<Blob | null> => {
    // If something is being spoken, cut it off — student wants to answer.
    cancelSpeak();
    if (recorderRef.current) await stopRecording();

    if (typeof navigator === "undefined" || !navigator.mediaDevices) {
      setState((s) => ({
        ...s,
        error: "Microphone access isn't available in this browser.",
        recording: false,
      }));
      return null;
    }

    try {
      // The browser's getUserMedia handles consent. We request audio with
      // echoCancellation + noiseSuppression so the recording is clean
      // even when the AI voice is still playing in the room. We omit
      // sampleRate because forcing it breaks several Android browsers
      // — the server-side Whisper handler resamples internally.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : MediaRecorder.isTypeSupported("audio/mp4")
            ? "audio/mp4"
            : "";
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = rec;
      recordChunksRef.current = [];

      const done = new Promise<Blob | null>((resolve) => {
        recordResolveRef.current = resolve;
      });

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
      };
      rec.onerror = () => {
        recordResolveRef.current?.(null);
        recordResolveRef.current = null;
      };
      rec.onstop = () => {
        const blob =
          recordChunksRef.current.length > 0
            ? new Blob(recordChunksRef.current, { type: mime || "audio/webm" })
            : null;
        // Release the mic.
        try {
          stream.getTracks().forEach((t) => t.stop());
        } catch {
          /* ignore */
        }
        mediaStreamRef.current = null;
        recorderRef.current = null;
        recordChunksRef.current = [];
        const resolve = recordResolveRef.current;
        recordResolveRef.current = null;
        setState((s) => ({ ...s, recording: false }));
        if (resolve) resolve(blob);
      };

      rec.start(50);
      setState((s) => ({ ...s, recording: true, error: null }));
      return done;
    } catch (e) {
      // Distinguish denial from absence so the error pill is actionable.
      let message = e instanceof Error ? e.message : "Mic access denied";
      if (e instanceof DOMException) {
        if (e.name === "NotAllowedError" || e.name === "SecurityError") {
          message =
            "Microphone permission was blocked. Allow mic access in your browser, then try again.";
        } else if (e.name === "NotFoundError" || e.name === "OverconstrainedError") {
          message = "No microphone detected. Check your input device and retry.";
        } else if (e.name === "NotReadableError") {
          message =
            "Another app is using the microphone. Close it and try again.";
        }
      }
      console.error("[useMentoredVoice startRecording]", e);
      setState((s) => ({ ...s, error: message, recording: false }));
      return null;
    }
  }, [cancelSpeak, stopRecording]);

  // ===========================================================================
  // recordUntilSilence
  // ===========================================================================
  //
  // Records audio and auto-stops when the user has been silent for
  // `silenceMs`. Used after a barge-in so the student can naturally
  // interrupt + speak without ever pressing a button.
  //
  // Implementation: same MediaRecorder pipeline as `startRecording`, plus a
  // parallel AnalyserNode reading from the same stream. We require at
  // least `MIN_SPEECH_MS` of above-silence audio before silence-endpointing
  // kicks in — otherwise an immediate-stop could fire from room noise
  // before the student even starts.

  const stopSilenceWatcher = useCallback(() => {
    if (silenceRafRef.current != null) {
      cancelAnimationFrame(silenceRafRef.current);
      silenceRafRef.current = null;
    }
    silenceAnalyserRef.current = null;
    silenceBufRef.current = null;
    if (silenceCtxRef.current) {
      silenceCtxRef.current.close().catch(() => {});
      silenceCtxRef.current = null;
    }
  }, []);

  const recordUntilSilence = useCallback(
    async (silenceMs: number = DEFAULT_SILENCE_MS): Promise<Blob | null> => {
      cancelSpeak();
      if (recorderRef.current) await stopRecording();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        mediaStreamRef.current = stream;
        const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "";
        const rec = mime
          ? new MediaRecorder(stream, { mimeType: mime })
          : new MediaRecorder(stream);
        recorderRef.current = rec;
        recordChunksRef.current = [];

        const done = new Promise<Blob | null>((resolve) => {
          recordResolveRef.current = resolve;
        });

        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) recordChunksRef.current.push(e.data);
        };
        rec.onerror = () => {
          stopSilenceWatcher();
          recordResolveRef.current?.(null);
          recordResolveRef.current = null;
        };
        rec.onstop = () => {
          stopSilenceWatcher();
          const blob =
            recordChunksRef.current.length > 0
              ? new Blob(recordChunksRef.current, { type: mime || "audio/webm" })
              : null;
          try {
            stream.getTracks().forEach((t) => t.stop());
          } catch {
            /* ignore */
          }
          mediaStreamRef.current = null;
          recorderRef.current = null;
          recordChunksRef.current = [];
          const resolve = recordResolveRef.current;
          recordResolveRef.current = null;
          setState((s) => ({
            ...s,
            recording: false,
            autoCapturing: false,
          }));
          if (resolve) resolve(blob);
        };

        // Set up the silence-detection analyser.
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const ctx = new Ctx();
        silenceCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        silenceAnalyserRef.current = analyser;
        silenceBufRef.current = new Uint8Array(analyser.fftSize);

        const startedAt = performance.now();
        let lastVoiceAt = startedAt;
        let everSpoke = false;

        const loop = () => {
          const a = silenceAnalyserRef.current;
          const buf = silenceBufRef.current;
          if (!a || !buf) return;
          a.getByteTimeDomainData(buf as unknown as Uint8Array<ArrayBuffer>);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const now = performance.now();
          if (rms > SILENCE_RMS * 2) {
            lastVoiceAt = now;
            if (!everSpoke && now - startedAt >= MIN_SPEECH_MS) everSpoke = true;
          }
          // Endpoint: must have had real speech, and silence sustained.
          if (
            everSpoke &&
            now - lastVoiceAt >= silenceMs &&
            recorderRef.current
          ) {
            try {
              recorderRef.current.stop();
            } catch {
              /* ignore */
            }
            return; // loop ends; onstop cleans up
          }
          // Safety cap: 60s max.
          if (now - startedAt >= 60_000 && recorderRef.current) {
            try {
              recorderRef.current.stop();
            } catch {
              /* ignore */
            }
            return;
          }
          silenceRafRef.current = requestAnimationFrame(loop);
        };
        silenceRafRef.current = requestAnimationFrame(loop);

        rec.start(50);
        setState((s) => ({
          ...s,
          recording: true,
          autoCapturing: true,
          error: null,
        }));
        return done;
      } catch (e) {
        const message = e instanceof Error ? e.message : "Mic access denied";
        setState((s) => ({
          ...s,
          error: message,
          recording: false,
          autoCapturing: false,
        }));
        return null;
      }
    },
    [cancelSpeak, stopRecording, stopSilenceWatcher]
  );

  const transcribe = useCallback(
    async (blob: Blob): Promise<string> => {
      // Guard against unusably short clips (silence, a stray click, or a
      // barge-in blip). Whisper rejects these with a 400 "unsupported or
      // empty audio", which used to surface as a scary error pill even though
      // nothing was actually wrong. Treat them as "nothing said" — callers
      // already handle an empty string gracefully. ~1.5KB of opus ≈ <0.5s.
      if (!blob || blob.size < 1500) {
        return "";
      }
      setState((s) => ({ ...s, transcribing: true, error: null }));
      try {
        // /api/voice-tutor/transcribe expects multipart fields named
        // `file` + `materialId` (Whisper handler). An earlier version
        // here used `audio` and no materialId, which made every Mentored
        // Learning transcription fail with HTTP 400. Keep these in sync
        // with `src/app/api/voice-tutor/transcribe/route.ts`.
        //
        // The filename extension must match the real container — Whisper
        // sniffs it to pick a decoder. Safari/iOS record mp4/aac while
        // Chrome/Firefox record webm/opus; mislabeling caused 400s.
        const form = new FormData();
        const t = (blob.type || "").toLowerCase();
        const filename = t.includes("webm")
          ? "answer.webm"
          : t.includes("ogg")
            ? "answer.ogg"
            : t.includes("wav")
              ? "answer.wav"
              : t.includes("mp4") || t.includes("m4a") || t.includes("aac")
                ? "answer.mp4"
                : t.includes("mpeg") || t.includes("mp3")
                  ? "answer.mp3"
                  : "answer.webm";
        const file =
          blob instanceof File
            ? blob
            : new File([blob], filename, {
                type: blob.type || "audio/webm",
              });
        form.set("file", file, filename);
        if (opts.sessionId) {
          form.set("sessionId", opts.sessionId);
        } else if (opts.materialId) {
          form.set("materialId", opts.materialId);
        }
        if (voiceLanguageRef.current !== "auto") {
          form.set("language", voiceLanguageRef.current);
        }
        const res = await fetch("/api/voice-tutor/transcribe", {
          method: "POST",
          body: form,
        });
        if (!res.ok) {
          if (notifyVoiceCap(res.status)) {
            // Out of voice time — caller switches to text. Not an error.
            return "";
          }
          let detail = "";
          try {
            const b = (await res.json()) as { error?: string };
            if (b.error) detail = `: ${b.error}`;
          } catch {
            /* ignore */
          }
          throw new Error(`Transcribe failed (${res.status})${detail}`);
        }
        const body = (await res.json()) as { text?: string };
        return (body.text ?? "").trim();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Transcribe failed";
        console.error("[useMentoredVoice transcribe]", e);
        setState((s) => ({ ...s, error: message }));
        return "";
      } finally {
        setState((s) => ({ ...s, transcribing: false }));
      }
    },
    [opts.materialId, opts.sessionId, notifyVoiceCap]
  );

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      cancelSpeak();
      stopBargeMonitor();
      stopSilenceWatcher();
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, [cancelSpeak, stopBargeMonitor, stopSilenceWatcher]);

  return {
    state,
    speak,
    speakSentenceStream,
    cancelSpeak,
    startRecording,
    stopRecording,
    recordUntilSilence,
    transcribe,
  };
}
