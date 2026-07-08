"use client";

/**
 * Live Notes capture layer — one audio-source abstraction for everything
 * downstream (Deepgram → notes → wrap-up), regardless of where the lecture
 * audio comes from:
 *
 *   1. "tab"    — getDisplayMedia, a specific browser tab + "Also share tab
 *                 audio". Primary path: YouTube, browser Zoom/Meet, any
 *                 in-browser lecture. Works on every desktop Chromium OS,
 *                 including macOS.
 *   2. "system" — getDisplayMedia, entire screen + system audio. For lectures
 *                 playing OUTSIDE the browser (e.g. the Zoom desktop app).
 *                 Chromium on Windows / ChromeOS only — macOS (and most
 *                 Linux) browsers cannot capture system audio at all.
 *   3. "mic"    — getUserMedia microphone, for in-person lectures. Slots into
 *                 the same abstraction: every source resolves to an
 *                 audio-only MediaStream, so the hook, Deepgram pipeline,
 *                 and wrap-up are identical for all three.
 *
 * HARD RULE: never silently record video-without-audio. If the shared
 * surface has no audio track, the whole capture is stopped and an
 * explanatory, platform-aware error is thrown — session start is blocked.
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

/**
 * What the user actually shared, read off the video track before teardown —
 * lets the no-audio error say exactly what to change instead of guessing.
 * Chrome reports "monitor" (entire screen), "window", or "browser" (a tab).
 */
type SharedSurface = "monitor" | "window" | "browser" | "unknown";

function sharedSurfaceOf(display: MediaStream): SharedSurface {
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
 * Resolve a capture source to an audio-only MediaStream.
 *
 * - Display captures request video too (Chrome's picker requires it) but the
 *   video track is stopped immediately — only audio leaves this function.
 * - Missing audio track ⇒ every acquired track is stopped and a
 *   `LectureCaptureError` with platform-specific guidance is thrown, so the
 *   caller can block session start instead of recording silence.
 */
export async function acquireLectureAudioStream(
  source: LiveCaptureSource,
  platform: CapturePlatform = detectCapturePlatform()
): Promise<MediaStream> {
  if (source === "mic") {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
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

  // Only the picker needs video; drop it so nothing visual is recorded.
  for (const t of display.getVideoTracks()) {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  }

  return new MediaStream(audioTracks);
}
