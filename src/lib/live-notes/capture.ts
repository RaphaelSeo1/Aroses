"use client";

/**
 * Live Notes capture layer — one MediaStream feeding three consumers:
 *
 *   1. Audio track → Deepgram (MediaRecorder on an audio-only tee)
 *   2. Video track → muted on-page lecture preview
 *   3. Video track → frame sampler → slide vision (on transitions only)
 *
 * Sources:
 *   1. "tab"    — getDisplayMedia, browser tab + "Also share tab audio"
 *   2. "system" — getDisplayMedia, entire screen + system audio (Win/ChromeOS)
 *   3. "mic"    — getUserMedia microphone (audio-only; vision/preview off)
 *
 * HARD RULE: never silently record video-without-audio. If the shared
 * surface has no audio track, the whole capture is stopped and an
 * explanatory, platform-aware error is thrown — session start is blocked.
 *
 * Video is optional: audio-only shares disable preview + vision cleanly.
 */

export type LiveCaptureSource = "tab" | "system" | "mic";

export type CapturePlatform = {
  isMac: boolean;
  /**
   * True when the browser can share tab audio at all. Chromium-only —
   * Safari and Firefox implement getDisplayMedia but never return an audio
   * track, so screen-lecture capture is impossible there.
   */
  captureAudioSupported: boolean;
  /**
   * True when the browser can share system (entire-screen) audio — Chromium
   * on Windows or ChromeOS. macOS/Linux browsers expose no system-audio
   * checkbox in the screen picker.
   */
  systemAudioSupported: boolean;
};

export type SharedSurface = "monitor" | "window" | "browser" | "unknown";

export type LectureCaptureResult = {
  /** Full stream: audio always; video when the share includes it. */
  stream: MediaStream;
  hasVideo: boolean;
  surface: SharedSurface;
};

export function detectCapturePlatform(): CapturePlatform {
  if (typeof navigator === "undefined") {
    return { isMac: false, captureAudioSupported: false, systemAudioSupported: false };
  }
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const platform = (uaData?.platform || navigator.platform || "").toLowerCase();
  const ua = navigator.userAgent.toLowerCase();

  const isMac = platform.includes("mac") || ua.includes("mac os");
  const isWindows = platform.includes("win") && !platform.includes("darwin");
  const isChromeOS = platform.includes("cros") || ua.includes(" cros ");
  // Chromium family (Chrome, Edge, Brave, …) — the only engines that can
  // capture tab/system audio via getDisplayMedia.
  const isChromium = Boolean(uaData) || /chrome|chromium|edg\//.test(ua);

  return {
    isMac,
    captureAudioSupported: isChromium,
    systemAudioSupported: (isWindows || isChromeOS) && isChromium,
  };
}

/** Thrown when capture is blocked; `message` is user-facing. */
export class LectureCaptureError extends Error {}

export function sharedSurfaceOf(display: MediaStream): SharedSurface {
  const settings = display.getVideoTracks()[0]?.getSettings() as
    | (MediaTrackSettings & { displaySurface?: string })
    | undefined;
  const s = settings?.displaySurface;
  return s === "monitor" || s === "window" || s === "browser" ? s : "unknown";
}

function noAudioMessage(
  source: Exclude<LiveCaptureSource, "mic">,
  platform: CapturePlatform,
  shared: SharedSurface
): string {
  // They DID pick a tab — the only thing missing is the audio toggle.
  if (shared === "browser") {
    return 'You shared a tab, but "Also share tab audio" was off, so recording was blocked. Try again and turn on the "Also share tab audio" toggle at the bottom of the picker.';
  }
  // A window never carries audio in any browser/OS.
  if (shared === "window") {
    return platform.systemAudioSupported
      ? 'You shared a window — windows never include audio, so recording was blocked. Pick the "Chrome Tab" pane and tick "Also share tab audio", or pick "Entire screen" and tick "Also share system audio".'
      : 'You shared a window — windows never include audio, so recording was blocked. Pick the "Chrome Tab" pane at the top of the picker, select your lecture tab, and tick "Also share tab audio".';
  }
  // Entire screen.
  if (shared === "monitor") {
    if (platform.systemAudioSupported) {
      return 'You shared your entire screen without audio, so recording was blocked. Try again and turn on "Also share system audio" at the bottom of the picker.';
    }
    return platform.isMac
      ? 'You shared your entire screen — on a Mac, screen sharing can never include audio, so recording was blocked. Pick the "Chrome Tab" pane at the top of the picker instead, select your lecture tab, and tick "Also share tab audio". (For the Zoom app, join from the browser instead — zoom.us → "Join from your browser" — or use the microphone.)'
      : 'You shared your entire screen, but this browser can\'t capture screen audio, so recording was blocked. Pick the "Chrome Tab" pane instead and tick "Also share tab audio".';
  }
  // Couldn't tell what was shared — fall back to source-based guidance.
  if (source === "tab") {
    return 'No tab audio was shared, so recording was blocked. In the picker choose the "Chrome Tab" pane, select your lecture tab, and turn on "Also share tab audio" — then try again.';
  }
  if (platform.isMac) {
    return "macOS doesn't let the browser capture system audio, so recording was blocked. To record a Zoom lecture on Mac, join from your browser instead of the Zoom app (zoom.us → \"Join from your browser\") and use Capture tab audio — or use the microphone.";
  }
  return 'No system audio was shared, so recording was blocked. In the picker choose "Entire screen" and turn on "Also share system audio", then try again.';
}

/**
 * Resolve a capture source to a MediaStream with audio (required) and
 * optional video (kept for preview + slide vision).
 *
 * Deepgram must receive an audio-only tee — use `audioOnlyStream(stream)`.
 * Missing audio track ⇒ every acquired track is stopped and a
 * `LectureCaptureError` with platform-specific guidance is thrown.
 */
export async function acquireLectureCaptureStream(
  source: LiveCaptureSource,
  platform: CapturePlatform = detectCapturePlatform()
): Promise<LectureCaptureResult> {
  if (source === "mic") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      return { stream, hasVideo: false, surface: "unknown" };
    } catch {
      throw new LectureCaptureError(
        "Could not access the microphone. Check the browser's mic permission for this site and try again."
      );
    }
  }

  // Blocked before the picker even opens — these browsers/OSes could only
  // ever produce video-without-audio.
  if (!platform.captureAudioSupported) {
    throw new LectureCaptureError(
      "This browser can't capture tab or screen audio. Open Rose in Google Chrome (or Edge) to record a screen lecture, or use the microphone instead."
    );
  }
  if (source === "system" && !platform.systemAudioSupported) {
    throw new LectureCaptureError(noAudioMessage("system", platform, "monitor"));
  }

  // Non-standard but widely supported Chromium options: steer the picker to
  // the right pane and surface the audio checkbox by default.
  const displayOptions = {
    video: {
      displaySurface: source === "tab" ? "browser" : "monitor",
    },
    audio: true,
    // Chrome ≥ 105: don't offer the Live Notes tab itself.
    selfBrowserSurface: "exclude",
    // Chrome ≥ 105 (Windows/ChromeOS): pre-tick "share system audio".
    ...(source === "system" ? { systemAudio: "include" } : {}),
  } as DisplayMediaStreamOptions;

  let display: MediaStream;
  try {
    display = await navigator.mediaDevices.getDisplayMedia(displayOptions);
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotAllowedError") {
      throw new LectureCaptureError(
        "Screen sharing was cancelled. Pick a source in the share dialog to start recording."
      );
    }
    throw new LectureCaptureError(
      source === "tab"
        ? "Could not start tab capture. Check the browser's screen-sharing permission and try again."
        : "Could not start screen capture. Check the browser's screen-sharing permission and try again."
    );
  }

  const audioTracks = display.getAudioTracks();
  if (audioTracks.length === 0) {
    // Never record video-without-audio: note what was shared, tear the
    // capture down, and explain exactly what to change.
    const shared = sharedSurfaceOf(display);
    for (const t of display.getTracks()) {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    }
    throw new LectureCaptureError(noAudioMessage(source, platform, shared));
  }

  const videoTracks = display.getVideoTracks();
  return {
    stream: display,
    hasVideo: videoTracks.length > 0 && videoTracks.some((t) => t.readyState === "live"),
    surface: sharedSurfaceOf(display),
  };
}

/** @deprecated Use acquireLectureCaptureStream — kept as a thin alias. */
export async function acquireLectureAudioStream(
  source: LiveCaptureSource,
  platform?: CapturePlatform
): Promise<MediaStream> {
  const result = await acquireLectureCaptureStream(source, platform);
  return result.stream;
}

/** Audio-only tee of the same track objects (for MediaRecorder → Deepgram). */
export function audioOnlyStream(stream: MediaStream): MediaStream {
  return new MediaStream(stream.getAudioTracks());
}
