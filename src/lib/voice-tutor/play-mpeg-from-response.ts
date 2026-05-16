"use client";

import type { MutableRefObject } from "react";

const AUDIO_CONTEXTS = new WeakMap<MutableRefObject<HTMLAudioElement | null>, AudioContext>();
const AUDIO_TAILS = new WeakMap<MutableRefObject<HTMLAudioElement | null>, number>();

function getAudioContext(
  audioRef: MutableRefObject<HTMLAudioElement | null>
): AudioContext {
  let ctx = AUDIO_CONTEXTS.get(audioRef);
  const AC: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
  if (!ctx || ctx.state === "closed") {
    if (!AC) throw new Error("AudioContext is not supported");
    ctx = new AC();
    AUDIO_CONTEXTS.set(audioRef, ctx);
    AUDIO_TAILS.set(audioRef, 0);
  }
  return ctx;
}

async function playDecodedBuffer(
  buf: ArrayBuffer,
  opts: {
    signal: AbortSignal;
    playbackRate: number;
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    onFirstPlay?: () => void;
  }
): Promise<void> {
  if (opts.signal.aborted) return;
  const ctx = getAudioContext(opts.audioRef);
  if (ctx.state === "suspended") {
    await ctx.resume().catch(() => undefined);
  }
  const decoded = await ctx.decodeAudioData(buf.slice(0));
  if (opts.signal.aborted) return;

  const source = ctx.createBufferSource();
  source.buffer = decoded;
  source.playbackRate.value = opts.playbackRate;

  const now = ctx.currentTime;
  const previousTail = AUDIO_TAILS.get(opts.audioRef) ?? 0;
  const startAt = Math.max(now + 0.04, previousTail + 0.01);
  const duration = decoded.duration / Math.max(0.1, opts.playbackRate);
  AUDIO_TAILS.set(opts.audioRef, startAt + duration);
  opts.onFirstPlay?.();

  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    source.onended = finish;
    const gain = ctx.createGain();
    source.disconnect();
    source.connect(gain);
    gain.connect(ctx.destination);
    const fadeIn = Math.min(0.01, duration / 6);
    gain.gain.setValueAtTime(0.4, startAt);
    gain.gain.linearRampToValueAtTime(1, startAt + fadeIn);
    opts.signal.addEventListener(
      "abort",
      () => {
        try {
          source.stop();
        } catch {
          /* ignore */
        }
        resolve();
      },
      { once: true }
    );
    source.start(startAt);
  });
}

export function mseSupportsMpegPlayback(): boolean {
  if (typeof MediaSource === "undefined") return false;
  return (
    MediaSource.isTypeSupported('audio/mpeg; codecs="mp3"') ||
    MediaSource.isTypeSupported("audio/mpeg")
  );
}

function pickMseMime(): string | null {
  if (typeof MediaSource === "undefined") return null;
  if (MediaSource.isTypeSupported('audio/mpeg; codecs="mp3"')) {
    return 'audio/mpeg; codecs="mp3"';
  }
  if (MediaSource.isTypeSupported("audio/mpeg")) return "audio/mpeg";
  return null;
}

async function waitSourceBufferQuiet(sb: SourceBuffer): Promise<void> {
  await new Promise<void>((resolve) => {
    if (!sb.updating) resolve();
    else sb.addEventListener("updateend", () => resolve(), { once: true });
  });
}

async function playMpegArrayBuffer(
  buf: ArrayBuffer,
  opts: {
    signal: AbortSignal;
    playbackRate: number;
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    onFirstPlay?: () => void;
  }
): Promise<void> {
  try {
    await playDecodedBuffer(buf, opts);
    return;
  } catch {
    // Fall back to HTMLAudioElement if decodeAudioData cannot handle the MP3.
  }
  if (opts.signal.aborted) return;
  const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
  const a = new Audio(url);
  a.playbackRate = opts.playbackRate;
  opts.audioRef.current = a;
  let first = true;
  await new Promise<void>((resolve) => {
    const finish = () => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      if (opts.audioRef.current === a) opts.audioRef.current = null;
      resolve();
    };
    a.onended = finish;
    a.onerror = finish;
    void a.play().then(() => {
      if (first) {
        first = false;
        opts.onFirstPlay?.();
      }
    });
  });
}

/**
 * Plays an MP3 HTTP response. Uses MSE incremental append when supported so
 * playback can start before the full body downloads; otherwise buffers the
 * full clip first.
 */
export async function playMpegFromResponse(
  response: Response,
  opts: {
    signal: AbortSignal;
    playbackRate: number;
    audioRef: MutableRefObject<HTMLAudioElement | null>;
    onFirstPlay?: () => void;
  }
): Promise<void> {
  if (!response.ok || !response.body) {
    throw new Error("Invalid audio response");
  }

  const fallbackCopy = response.clone();

  const mime = pickMseMime();
  if (!mime) {
    try {
      await fallbackCopy.body?.cancel();
    } catch {
      /* ignore */
    }
    const buf = await response.arrayBuffer();
    await playMpegArrayBuffer(buf, opts);
    return;
  }

  const mediaSource = new MediaSource();
  const objectUrl = URL.createObjectURL(mediaSource);
  const audio = new Audio();
  audio.src = objectUrl;
  audio.playbackRate = opts.playbackRate;
  opts.audioRef.current = audio;

  const detach = () => {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      /* ignore */
    }
    if (opts.audioRef.current === audio) opts.audioRef.current = null;
  };

  try {
    await new Promise<void>((resolve, reject) => {
      mediaSource.addEventListener(
        "sourceopen",
        () => {
          void (async () => {
            try {
              const sb = mediaSource.addSourceBuffer(mime);
              const reader = response.body!.getReader();
              let started = false;

              while (!opts.signal.aborted) {
                const { done, value } = await reader.read();
                if (opts.signal.aborted) {
                  try {
                    await reader.cancel();
                  } catch {
                    /* ignore */
                  }
                  break;
                }
                if (done) {
                  await waitSourceBufferQuiet(sb);
                  if (mediaSource.readyState === "open") {
                    try {
                      mediaSource.endOfStream();
                    } catch {
                      /* ignore */
                    }
                  }
                  break;
                }
                if (!value.byteLength) continue;
                await waitSourceBufferQuiet(sb);
                if (opts.signal.aborted) break;
                sb.appendBuffer(value);
                if (!started) {
                  started = true;
                  opts.onFirstPlay?.();
                  void audio.play().catch(() => {
                    /* ignore autoplay blocks */
                  });
                }
              }

              await new Promise<void>((rEnd) => {
                const end = () => rEnd();
                audio.addEventListener("ended", end, { once: true });
                audio.addEventListener("error", end, { once: true });
              });
              resolve();
            } catch (e) {
              reject(e);
            }
          })();
        },
        { once: true }
      );

      mediaSource.addEventListener(
        "error",
        () => reject(new Error("MediaSource error")),
        { once: true }
      );
    });
  } catch {
    detach();
    try {
      await fallbackCopy.body?.cancel();
    } catch {
      /* ignore */
    }
    const buf = await fallbackCopy.arrayBuffer();
    await playMpegArrayBuffer(buf, opts);
    return;
  }

  try {
    await fallbackCopy.body?.cancel();
  } catch {
    /* ignore */
  }
  detach();
}
