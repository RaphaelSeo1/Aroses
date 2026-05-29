"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { IngestMediaMeta, IngestTranscriptSegment } from "@/types/ingest-media";

function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function IngestMediaPanel({
  materialId,
  media,
}: {
  materialId: string;
  media: IngestMediaMeta;
}) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [segments, setSegments] = useState<IngestTranscriptSegment[]>(
    media.transcriptSegments ?? []
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [activeSegment, setActiveSegment] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(
          `/api/study-materials/${materialId}/ingest-media`
        );
        const body = (await res.json().catch(() => ({}))) as {
          url?: string;
          error?: string;
          transcriptSegments?: IngestTranscriptSegment[];
        };
        if (cancelled) return;
        if (!res.ok || !body.url) {
          setLoadError(body.error ?? "Could not load media.");
          return;
        }
        setSignedUrl(body.url);
        if (Array.isArray(body.transcriptSegments) && body.transcriptSegments.length) {
          setSegments(body.transcriptSegments);
        }
      } catch {
        if (!cancelled) setLoadError("Network error loading media.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  const seekTo = useCallback((sec: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, sec);
    void el.play().catch(() => {});
  }, []);

  useEffect(() => {
    const el = mediaRef.current;
    if (!el || segments.length === 0) return;

    const onTime = () => {
      const t = el.currentTime;
      let idx: number | null = null;
      for (let i = 0; i < segments.length; i++) {
        if (t >= segments[i].startSec) idx = i;
        else break;
      }
      setActiveSegment(idx);
    };

    el.addEventListener("timeupdate", onTime);
    return () => el.removeEventListener("timeupdate", onTime);
  }, [segments, signedUrl]);

  useEffect(() => {
    const el = mediaRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate, signedUrl]);

  if (loadError) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
        {loadError}
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {media.kind === "video" ? "Lecture recording" : "Audio recording"}
        </h2>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
          {media.fileName}
        </p>
      </div>

      <div className="p-4">
        {!signedUrl ? (
          <p className="text-sm text-zinc-500">Loading player…</p>
        ) : media.kind === "video" ? (
          <video
            ref={mediaRef as React.RefObject<HTMLVideoElement>}
            src={signedUrl}
            controls
            playsInline
            className="w-full max-h-[420px] rounded-xl bg-black"
            preload="metadata"
          />
        ) : (
          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={signedUrl}
            controls
            className="w-full"
            preload="metadata"
          />
        )}

        {signedUrl ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Speed
            </span>
            {PLAYBACK_RATES.map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setPlaybackRate(rate)}
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  playbackRate === rate
                    ? "bg-brand text-white dark:bg-brand-soft"
                    : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {segments.length > 0 ? (
        <div className="border-t border-zinc-100 dark:border-zinc-800">
          <div className="px-4 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Transcript
            </h3>
            <p className="mt-0.5 text-xs text-zinc-400 dark:text-zinc-500">
              Click any line to jump to that moment.
            </p>
          </div>
          <ul className="max-h-64 overflow-y-auto px-2 pb-3">
            {segments.map((seg, i) => (
              <li key={`${seg.startSec}-${i}`}>
                <button
                  type="button"
                  onClick={() => seekTo(seg.startSec)}
                  className={`flex w-full gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                    activeSegment === i
                      ? "bg-brand-blush/80 text-zinc-900 dark:bg-brand-blush/15 dark:text-zinc-100"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900"
                  }`}
                >
                  <span className="shrink-0 font-mono text-xs text-zinc-400 dark:text-zinc-500">
                    {formatTimestamp(seg.startSec)}
                  </span>
                  <span className="min-w-0">{seg.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
