import "server-only";
import https from "node:https";

/**
 * Shared Deepgram credential handling. There is exactly ONE Deepgram
 * integration in the app: short-lived access tokens minted server-side via
 * `/v1/auth/grant`, consumed by a browser WebSocket to `/v1/listen`. Both the
 * voice-tutor token route and the Live Notes token route go through here so
 * key normalization and grant-error parsing never diverge.
 */

/** Grant TTL — only matters at connect time; sockets outlive it. */
export const DEEPGRAM_TOKEN_TTL_SECONDS = 120;

/** Hard cap so a hung Deepgram grant can't stall Live Notes. */
const GRANT_TIMEOUT_MS = 8_000;
const GRANT_RETRIES = 2;

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
 * Use Node's https module (IPv4) instead of undici `fetch`.
 * On some networks undici hangs ~40s on api.deepgram.com while curl/https
 * with `family: 4` returns in ~1s — that hang surfaced as Live Notes 500s /
 * "Deepgram connection timed out".
 */
function grantViaHttps(deepgramKey: string): Promise<{
  status: number;
  text: string;
}> {
  const body = JSON.stringify({ ttl_seconds: DEEPGRAM_TOKEN_TTL_SECONDS });
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.deepgram.com",
        path: "/v1/auth/grant",
        method: "POST",
        family: 4,
        headers: {
          Authorization: `Token ${deepgramKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
        },
        timeout: GRANT_TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c as Buffer));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("Deepgram grant timed out"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function grantOnce(deepgramKey: string): Promise<DeepgramTokenResult> {
  let status = 0;
  let text = "";
  try {
    const res = await grantViaHttps(deepgramKey);
    status = res.status;
    text = res.text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = /timed out|timeout/i.test(msg);
    console.error("Deepgram token grant error", timedOut ? "timeout" : msg);
    return {
      ok: false,
      status: 502,
      error: timedOut
        ? "Deepgram took too long to issue a token. Check your network and try again."
        : "Could not reach Deepgram to issue a transcription token. Check your network and try again.",
    };
  }

  if (status < 200 || status >= 300) {
    console.error("Deepgram token grant failed", status, text.slice(0, 400));
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
        detail = `Deepgram rejected the token request (${status}).`;
      }
    }
    return { ok: false, status: 502, error: detail };
  }

  let data: { access_token?: unknown; expires_in?: unknown };
  try {
    data = JSON.parse(text) as typeof data;
  } catch {
    return {
      ok: false,
      status: 502,
      error: "Deepgram returned an invalid token response.",
    };
  }
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

/**
 * Mint a short-lived Deepgram access token. Returns a structured result so
 * callers can map it straight to an HTTP response (and `report()` failures).
 * Retries once on timeout/network blips — never throws (avoids opaque 500s).
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

  let last: DeepgramTokenResult = {
    ok: false,
    status: 502,
    error: "Could not reach Deepgram to issue a transcription token.",
  };
  for (let attempt = 0; attempt < GRANT_RETRIES; attempt++) {
    last = await grantOnce(deepgramKey);
    if (last.ok) return last;
    // Don't retry auth/config rejections — only timeouts / reachability.
    if (
      !last.error.includes("took too long") &&
      !last.error.includes("Could not reach Deepgram")
    ) {
      return last;
    }
  }
  return last;
}
