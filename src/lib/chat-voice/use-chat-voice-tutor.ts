"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelInFlightNotesRoseSpeech,
  createAsyncSentenceQueue,
  splitReplyIntoVoiceChunks,
  StreamingSpeechBuffer,
  type NotesRoseInterruptHint,
} from "@/lib/chat-voice/notes-rose-speech";
import {
  isEchoOfAssistantSpeech,
  isLikelyNoiseTranscript,
} from "@/lib/mentored/is-likely-noise-transcript";
import { useMentoredVoice } from "@/lib/mentored/use-mentored-voice";

export type ChatVoicePhase = "idle" | "listening" | "thinking" | "speaking";

export type ChatVoiceSendContext = {
  interruption?: NotesRoseInterruptHint;
  onReplyDelta?: (delta: string) => void;
  signal?: AbortSignal;
};

export type ChatVoiceInterruptReason = "send" | "stop";

type ActiveTurn = {
  buffer: StreamingSpeechBuffer;
  queue: ReturnType<typeof createAsyncSentenceQueue>;
  turnAc: AbortController;
};

export function useChatVoiceTutor(opts: {
  materialId?: string;
  sessionId?: string;
  sendAndWait: (
    text: string,
    ctx?: ChatVoiceSendContext
  ) => Promise<string | null>;
  /** Abort the in-flight notes/study chat request (coordinator.stop). */
  onVoiceInterrupt?: (reason: ChatVoiceInterruptReason) => void;
  /** Parent already knows the monthly cap is hit (e.g. live lecture banner). */
  blocked?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [capped, setCapped] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const activeRef = useRef(false);
  const epochRef = useRef(0);
  const lastAssistantRef = useRef("");
  const pendingHintRef = useRef<NotesRoseInterruptHint | undefined>(undefined);
  const pendingCaptureRef = useRef<Promise<Blob | null> | null>(null);
  const currentTurnRef = useRef<ActiveTurn | null>(null);
  const sendRef = useRef(opts.sendAndWait);
  const blockedRef = useRef(opts.blocked);
  const onVoiceInterruptRef = useRef(opts.onVoiceInterrupt);
  useEffect(() => {
    sendRef.current = opts.sendAndWait;
  }, [opts.sendAndWait]);
  useEffect(() => {
    blockedRef.current = opts.blocked;
  }, [opts.blocked]);
  useEffect(() => {
    onVoiceInterruptRef.current = opts.onVoiceInterrupt;
  }, [opts.onVoiceInterrupt]);

  const onCap = useCallback(() => {
    epochRef.current += 1;
    activeRef.current = false;
    setActive(false);
    setCapped(true);
    setChatBusy(false);
  }, []);

  const onBargeInRef = useRef<() => void>(() => {});
  const voice = useMentoredVoice({
    materialId: opts.materialId,
    sessionId: opts.sessionId,
    bargeInEnabled: true,
    onBargeIn: () => onBargeInRef.current(),
    onVoiceCapReached: onCap,
  });
  const voiceRef = useRef(voice);
  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  const interruptInFlight = useCallback((reason: ChatVoiceInterruptReason) => {
    const turn = currentTurnRef.current;
    if (turn) {
      pendingHintRef.current = turn.buffer.interruptHint(true);
      cancelInFlightNotesRoseSpeech({
        queue: turn.queue,
        abortTurn: () => turn.turnAc.abort(),
        cancelSpeak: () => voiceRef.current.cancelSpeak(),
      });
      currentTurnRef.current = null;
    } else {
      voiceRef.current.cancelSpeak();
    }
    onVoiceInterruptRef.current?.(reason);
    if (activeRef.current && !pendingCaptureRef.current) {
      pendingCaptureRef.current = voiceRef.current.recordUntilSilence();
    }
  }, []);

  useEffect(() => {
    onBargeInRef.current = () => interruptInFlight("send");
  }, [interruptInFlight]);

  const exit = useCallback(() => {
    epochRef.current += 1;
    activeRef.current = false;
    setActive(false);
    setChatBusy(false);
    pendingCaptureRef.current = null;
    pendingHintRef.current = undefined;
    const turn = currentTurnRef.current;
    if (turn) {
      cancelInFlightNotesRoseSpeech({
        queue: turn.queue,
        abortTurn: () => turn.turnAc.abort(),
        cancelSpeak: () => voiceRef.current.cancelSpeak(),
      });
      currentTurnRef.current = null;
    } else {
      voiceRef.current.cancelSpeak();
    }
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
      const capture = pendingCaptureRef.current;
      pendingCaptureRef.current = null;
      const blob = capture ? await capture : await v.recordUntilSilence();
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

      const buffer = new StreamingSpeechBuffer();
      const queue = createAsyncSentenceQueue();
      const turnAc = new AbortController();
      const turn: ActiveTurn = { buffer, queue, turnAc };
      currentTurnRef.current = turn;
      const interruption = pendingHintRef.current;
      pendingHintRef.current = undefined;

      setChatBusy(true);
      const sendP = sendRef
        .current(text, {
          interruption,
          signal: turnAc.signal,
          onReplyDelta: (delta) => {
            if (turnAc.signal.aborted || queue.closed) return;
            for (const chunk of buffer.pushDelta(delta)) {
              queue.push(chunk);
            }
          },
        })
        .then((reply) => {
          if (turnAc.signal.aborted || queue.closed) return reply;
          if (!buffer.generated && reply?.trim()) {
            for (const chunk of splitReplyIntoVoiceChunks(reply)) {
              queue.push(chunk);
            }
          } else {
            const tail = buffer.flush();
            if (tail) queue.push(tail);
          }
          queue.close();
          return reply;
        })
        .catch(() => {
          if (!queue.closed) {
            const tail = buffer.flush();
            if (tail) queue.push(tail);
            queue.close();
          }
          return null;
        })
        .finally(() => {
          setChatBusy(false);
        });

      await v.speakSentenceStream(queue, {
        onSentencePlaying: (chunk) => {
          buffer.markSpoken(chunk);
          lastAssistantRef.current = buffer.spoken;
        },
      });

      const barged = currentTurnRef.current !== turn || turnAc.signal.aborted;
      if (currentTurnRef.current === turn) currentTurnRef.current = null;
      if (!queue.closed) queue.close();

      if (epoch !== epochRef.current || !activeRef.current) {
        void sendP;
        return;
      }
      if (barged) {
        void sendP;
        continue;
      }

      const reply = await sendP;
      if (reply?.trim()) lastAssistantRef.current = reply;
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
      const turn = currentTurnRef.current;
      if (turn) {
        cancelInFlightNotesRoseSpeech({
          queue: turn.queue,
          abortTurn: () => turn.turnAc.abort(),
          cancelSpeak: () => voice.cancelSpeak(),
        });
        currentTurnRef.current = null;
      } else {
        voice.cancelSpeak();
      }
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
    interrupt: interruptInFlight,
    inputLevelRef: voice.inputLevelRef,
    playbackLevelRef: voice.playbackLevelRef,
  };
}
