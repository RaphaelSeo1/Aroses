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

type InputMode = "hold" | "tap";

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
    a.pause();
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
  const messagesRef = useRef<StudyChatTurn[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const cleanupRecorder = useCallback(async () => {
    startPromiseRef.current = null;
    const mr = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop();
      } catch {
        /* ignore */
      }
    }
    const s = streamRef.current;
    streamRef.current = null;
    s?.getTracks().forEach((t) => t.stop());
  }, []);

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
    stopPlayback(audioRef);
    await cleanupRecorder();

    const mimeType = pickMimeType();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

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
  }, [cleanupRecorder]);

  const playMp3 = useCallback(async (buf: ArrayBuffer) => {
    stopPlayback(audioRef);
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
    const a = new Audio(url);
    audioRef.current = a;
    await new Promise<void>((resolve, reject) => {
      a.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };
      a.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Audio playback failed"));
      };
      void a.play().then(() => undefined).catch(reject);
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

  const runPipeline = useCallback(
    async (blob: Blob) => {
      if (blob.size < 256) {
        setError("Recording too short — try again.");
        return;
      }

      setBusy(true);
      setError(null);
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
          setError("Did not catch any speech — try speaking closer to the mic.");
          return;
        }

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
        await playMp3(audioBuf);
      } catch {
        setError("Network error — try again.");
      } finally {
        setBusy(false);
      }
    },
    [
      applyNavigation,
      courseId,
      materialId,
      moduleId,
      playMp3,
      quizOpen,
    ]
  );

  useEffect(() => {
    return () => {
      void cleanupRecorder();
      stopPlayback(audioRef);
    };
  }, [cleanupRecorder]);

  const micButtonClass =
    "flex min-w-[11rem] items-center justify-center gap-2 rounded-2xl border-2 px-5 py-3 text-sm font-semibold shadow-xl transition disabled:opacity-60 " +
    (tapRecording || holdRecording || busy
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
  }, [busy, cleanupRecorder, finalizeBlob, inputMode, runPipeline, startRecording, tapRecording]);

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
            className={`rounded-md px-2 py-0.5 transition ${
              inputMode === "hold"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
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
            className={`rounded-md px-2 py-0.5 transition ${
              inputMode === "tap"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            }`}
          >
            Tap
          </button>
        </div>
      </div>

      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        aria-pressed={inputMode === "hold" ? holdRecording : tapRecording}
        onPointerDown={inputMode === "hold" ? onPointerDownHold : undefined}
        onPointerUp={inputMode === "hold" ? onPointerUpHold : undefined}
        onPointerCancel={inputMode === "hold" ? onPointerUpHold : undefined}
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

      {error ? (
        <p className="max-w-[14rem] text-xs leading-snug text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        <p className="max-w-[14rem] text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
          {inputMode === "hold"
            ? "Hold the button, speak, release. Uses the same lesson context as chat (Claude + your materials)."
            : "Tap once to record, tap again to send."}
        </p>
      )}
    </div>
  );
}
