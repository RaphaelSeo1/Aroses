import "server-only";

/**
 * Shared Deepgram credential handling. There is exactly ONE Deepgram
 * integration in the app: short-lived access tokens minted server-side via
 * `/v1/auth/grant`, consumed by a browser WebSocket to `/v1/listen`. Both the
 * voice-tutor token route and the Live Notes token route go through here so
 * key normalization and grant-error parsing never diverge.
 */

/** Grant TTL — only matters at connect time; sockets outlive it. */
export const DEEPGRAM_TOKEN_TTL_SECONDS = 120;

/**
 * Strip wrapping quotes and a leading `token`/`bearer` prefix from the env
 * value. Hardens against the classic production misconfig where the key is
 * pasted with quotes or with the auth-scheme prefix included.
 */
export function normalizeDeepgramKey(raw: string | undefined): string {
  let key = raw?.trim() ?? "";
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  return key.replace(/^(token|bearer)\s+/i, "").trim();
}

export type DeepgramTokenResult =
  | { ok: true; accessToken: string; expiresIn: number }
  | { ok: false; status: number; error: string };

/**
 * Mint a short-lived Deepgram access token. Returns a structured result so
 * callers can map it straight to an HTTP response (and `report()` failures).
 */
export async function mintDeepgramToken(): Promise<DeepgramTokenResult> {
  const deepgramKey = normalizeDeepgramKey(process.env.DEEPGRAM_API_KEY);
  if (!deepgramKey) {
    return {
      ok: false,
      status: 503,
      error: "Live transcription is not configured (missing DEEPGRAM_API_KEY).",
    };
  }

  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: {
      Authorization: `Token ${deepgramKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ttl_seconds: DEEPGRAM_TOKEN_TTL_SECONDS }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Deepgram token grant failed", res.status, text.slice(0, 400));
    let detail = "Deepgram rejected the live transcription token request.";
    try {
      const parsed = JSON.parse(text) as {
        err_msg?: unknown;
        message?: unknown;
        error?: unknown;
      };
      const raw =
        typeof parsed.err_msg === "string"
          ? parsed.err_msg
          : typeof parsed.message === "string"
            ? parsed.message
            : typeof parsed.error === "string"
              ? parsed.error
              : "";
      if (raw) detail = `Deepgram rejected the token request: ${raw}`;
    } catch {
      if (text.trim()) {
        detail = `Deepgram rejected the token request (${res.status}).`;
      }
    }
    return { ok: false, status: 502, error: detail };
  }

  const data = (await res.json()) as {
    access_token?: unknown;
    expires_in?: unknown;
  };
  if (typeof data.access_token !== "string") {
    return {
      ok: false,
      status: 502,
      error: "Deepgram did not return a token.",
    };
  }

  return {
    ok: true,
    accessToken: data.access_token,
    expiresIn:
      typeof data.expires_in === "number"
        ? data.expires_in
        : DEEPGRAM_TOKEN_TTL_SECONDS,
  };
}
