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

export function useMentoredVoice(opts: {
  materialId: string;
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
}) {
  const playbackRate = opts.playbackRate ?? 1;
  const bargeInEnabled = opts.bargeInEnabled !== false;

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

      const loop = () => {
        const a = bargeAnalyserRef.current;
        const buf = bargeBufRef.current;
        if (!a || !buf) return;
        // TS lib.dom mismatch: AnalyserNode accepts Uint8Array, narrow at call site.
        a.getByteTimeDomainData(buf as unknown as Uint8Array<ArrayBuffer>);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const now = performance.now();
        if (rms >= BARGE_RMS) {
          if (bargeStartAtRef.current === 0) bargeStartAtRef.current = now;
          else if (
            !bargeFiredRef.current &&
            now - bargeStartAtRef.current >= BARGE_SUSTAIN_MS
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
  }, [bargeInEnabled, stopBargeMonitor]);

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

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      cancelSpeak();
      const ac = new AbortController();
      speakAbortRef.current = ac;
      setState((s) => ({ ...s, speaking: true, error: null }));
      // Kick off the barge-in monitor in parallel — don't await it, mic
      // permission shouldn't block playback. If the user denies permission
      // this becomes a no-op and speech still plays.
      void startBargeMonitor();
      try {
        const res = await fetch("/api/voice-tutor/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            materialId: opts.materialId,
            voiceId: TTS_VOICE_ID,
            stream: true,
          }),
          signal: ac.signal,
        });
        if (!res.ok) {
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
          playbackRate,
          audioRef,
        });
      } catch (e) {
        if (ac.signal.aborted) return;
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
    [cancelSpeak, opts.materialId, playbackRate, startBargeMonitor, stopBargeMonitor]
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

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
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
      const message = e instanceof Error ? e.message : "Mic access denied";
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

  const transcribe = useCallback(async (blob: Blob): Promise<string> => {
    setState((s) => ({ ...s, transcribing: true, error: null }));
    try {
      const form = new FormData();
      form.set("audio", blob, "answer.webm");
      const res = await fetch("/api/voice-tutor/transcribe", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        throw new Error(`Transcribe failed (${res.status})`);
      }
      const body = (await res.json()) as { text?: string };
      return (body.text ?? "").trim();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Transcribe failed";
      setState((s) => ({ ...s, error: message }));
      return "";
    } finally {
      setState((s) => ({ ...s, transcribing: false }));
    }
  }, []);

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
    cancelSpeak,
    startRecording,
    stopRecording,
    recordUntilSilence,
    transcribe,
  };
}
