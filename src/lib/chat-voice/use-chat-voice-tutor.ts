"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { speakableText } from "@/lib/chat-voice/speakable-text";
import {
  isEchoOfAssistantSpeech,
  isLikelyNoiseTranscript,
} from "@/lib/mentored/is-likely-noise-transcript";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";

export type ChatVoicePhase = "idle" | "listening" | "thinking" | "speaking";

export function useChatVoiceTutor(opts: {
  materialId?: string;
  sessionId?: string;
  sendAndWait: (text: string) => Promise<string | null>;
  /** Parent already knows the monthly cap is hit (e.g. live lecture banner). */
  blocked?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [capped, setCapped] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const activeRef = useRef(false);
  const epochRef = useRef(0);
  const lastAssistantRef = useRef("");
  const sendRef = useRef(opts.sendAndWait);
  sendRef.current = opts.sendAndWait;
  const blockedRef = useRef(opts.blocked);
  blockedRef.current = opts.blocked;

  const onCap = useCallback(() => {
    epochRef.current += 1;
    activeRef.current = false;
    setActive(false);
    setCapped(true);
    setChatBusy(false);
  }, []);

  const voice = useMentoredVoice({
    materialId: opts.materialId,
    sessionId: opts.sessionId,
    bargeInEnabled: true,
    onVoiceCapReached: onCap,
  });
  const voiceRef = useRef(voice);
  voiceRef.current = voice;

  const exit = useCallback(() => {
    epochRef.current += 1;
    activeRef.current = false;
    setActive(false);
    setChatBusy(false);
    voiceRef.current.cancelSpeak();
    void voiceRef.current.stopRecording();
  }, []);

  const enter = useCallback(async () => {
    if (blockedRef.current || capped) return;
    try {
      const res = await fetch("/api/voice-tutor/allowance");
      const body = (await res.json().catch(() => ({}))) as {
        allowed?: boolean;
      };
      if (body.allowed === false) {
        setCapped(true);
        return;
      }
    } catch {
      /* proceed — individual TTS/STT calls still enforce the cap */
    }

    const epoch = ++epochRef.current;
    activeRef.current = true;
    setActive(true);

    while (activeRef.current && epoch === epochRef.current) {
      const v = voiceRef.current;
      const blob = await v.recordUntilSilence();
      if (epoch !== epochRef.current || !activeRef.current) return;
      if (!blob) continue;

      const text = await v.transcribe(blob);
      if (epoch !== epochRef.current || !activeRef.current) return;
      if (
        !text ||
        isLikelyNoiseTranscript(text) ||
        isEchoOfAssistantSpeech(text, lastAssistantRef.current)
      ) {
        continue;
      }

      setChatBusy(true);
      const reply = await sendRef.current(text);
      setChatBusy(false);
      if (epoch !== epochRef.current || !activeRef.current) return;
      if (!reply?.trim()) continue;

      lastAssistantRef.current = reply;
      await v.speak(speakableText(reply));
    }
  }, [capped]);

  useEffect(() => {
    if (opts.blocked && activeRef.current) {
      onCap();
    }
  }, [opts.blocked, onCap]);

  useEffect(() => {
    return () => {
      epochRef.current += 1;
      activeRef.current = false;
      voice.cancelSpeak();
      void voice.stopRecording();
    };
    // Unmount only — voice identity is stable enough for teardown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = useCallback(() => {
    if (activeRef.current) exit();
    else void enter();
  }, [enter, exit]);

  const blocked = Boolean(opts.blocked) || capped;
  let phase: ChatVoicePhase = "idle";
  if (voice.state.speaking) phase = "speaking";
  else if (voice.state.recording || voice.state.autoCapturing) phase = "listening";
  else if (voice.state.transcribing || chatBusy) phase = "thinking";

  return {
    active,
    blocked,
    capped,
    phase,
    error: voice.state.error,
    toggle,
    exit,
    inputLevelRef: voice.inputLevelRef,
    playbackLevelRef: voice.playbackLevelRef,
  };
}
