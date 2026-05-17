"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { playMpegFromResponse } from "@/lib/voice-tutor/play-mpeg-from-response";

/**
 * Focused voice helper for the Mentored Learning runner.
 *
 * Exposes three primitives:
 *   - speak(text)        — fetches streaming TTS and plays it
 *   - cancelSpeak()      — aborts any in-flight or playing audio
 *   - recordOnce()       — opens the mic until stopRecording() is called,
 *                          returns the transcribed text on stop
 *
 * Built directly on the existing /api/voice-tutor/{tts,transcribe}
 * endpoints so it shares the same backend the VoiceTutorDock uses.
 *
 * Intentionally lighter than VoiceTutorDock: no Deepgram streaming, no
 * waveform animation owned by this hook, no transcript sidebar plumbing.
 * The runner UI owns its own visualization.
 */

export type MentoredVoiceState = {
  speaking: boolean;
  recording: boolean;
  transcribing: boolean;
  error: string | null;
};

const TTS_VOICE_ID =
  process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID || "Rachel";

export function useMentoredVoice(opts: {
  materialId: string;
  /** 0.5 .. 2.0 — adjusts both TTS pitch and recorded playback */
  playbackRate?: number;
}) {
  const playbackRate = opts.playbackRate ?? 1;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const recordResolveRef = useRef<((value: Blob | null) => void) | null>(null);

  const [state, setState] = useState<MentoredVoiceState>({
    speaking: false,
    recording: false,
    transcribing: false,
    error: null,
  });

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
    setState((s) => ({ ...s, speaking: false }));
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!text.trim()) return;
      cancelSpeak();
      const ac = new AbortController();
      speakAbortRef.current = ac;
      setState((s) => ({ ...s, speaking: true, error: null }));
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
        setState((s) => ({ ...s, speaking: false }));
      }
    },
    [cancelSpeak, opts.materialId, playbackRate]
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
      try {
        recorderRef.current?.stop();
      } catch {
        /* ignore */
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    };
  }, [cancelSpeak]);

  return {
    state,
    speak,
    cancelSpeak,
    startRecording,
    stopRecording,
    transcribe,
  };
}
