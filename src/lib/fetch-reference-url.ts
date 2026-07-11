import "server-only";

import { normalizeReferenceUrl } from "@/lib/normalize-reference-url";

/**
 * Fetch a public http(s) URL and extract readable plain text for use as
 * tutor / course reference material. Blocks obvious SSRF targets.
 */

const MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_TEXT_CHARS = 80_000;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "metadata.google.internal",
]);

export type FetchedReferenceUrl = {
  url: string;
  title: string;
  hostname: string;
  text: string;
};

export { normalizeReferenceUrl };

function isPrivateOrReservedHost(host: string): boolean {
  if (host === "localhost") return true;
  // IPv4
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }
  // IPv6 bare / bracketed forms we already blocked ::1; reject link-local / ULA prefixes
  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "").toLowerCase();
    if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe80")) {
      return true;
    }
  }
  return false;
}

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : "";
    });
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m?.[1]) return "";
  return decodeBasicEntities(m[1].replace(/\s+/g, " ")).trim().slice(0, 200);
}

function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  s = s
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  s = decodeBasicEntities(s);
  return s
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Download and extract text from a public URL.
 * Throws Error with a user-facing message on failure.
 */
export async function fetchReferenceUrl(
  rawUrl: string
): Promise<FetchedReferenceUrl> {
  const url = normalizeReferenceUrl(rawUrl);
  if (!url) {
    throw new Error("Enter a valid http(s) link.");
  }

  const parsed = new URL(url);
  const host = parsed.hostname.toLowerCase();
  if (
    BLOCKED_HOSTS.has(host) ||
    host.endsWith(".local") ||
    isPrivateOrReservedHost(host)
  ) {
    throw new Error("That link isn't allowed.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain,application/pdf,*/*",
        "User-Agent": "ArosesReferenceBot/1.0 (+https://aroses.app)",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error("That link took too long to load.");
    }
    throw new Error("Couldn't reach that link.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Couldn't fetch that link (${res.status}).`);
  }

  const finalUrl = res.url || url;
  const finalHost = new URL(finalUrl).hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(finalHost) || isPrivateOrReservedHost(finalHost)) {
    throw new Error("That link isn't allowed.");
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (contentLength > MAX_BYTES) {
    throw new Error("That page is too large to use as reference material.");
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error("That page is too large to use as reference material.");
  }

  let title = "";
  let text = "";

  if (
    contentType.includes("application/pdf") ||
    parsed.pathname.toLowerCase().endsWith(".pdf")
  ) {
    const { extractPdfText } = await import("@/lib/pdf-text/extract");
    text = (await extractPdfText(buf)).slice(0, MAX_TEXT_CHARS);
    title =
      decodeURIComponent(parsed.pathname.split("/").pop() || "document.pdf") ||
      "PDF";
  } else if (
    contentType.includes("text/plain") ||
    contentType.includes("text/markdown")
  ) {
    text = buf.toString("utf8").slice(0, MAX_TEXT_CHARS);
    title = parsed.hostname;
  } else {
    // Treat as HTML (or unknown — best-effort strip).
    const html = buf.toString("utf8");
    title = extractTitle(html) || parsed.hostname;
    text = htmlToPlainText(html).slice(0, MAX_TEXT_CHARS);
  }

  text = text.trim();
  if (text.length < 40) {
    throw new Error(
      "Couldn't extract enough text from that link. Try a different page, or upload a file instead."
    );
  }

  return {
    url: finalUrl,
    title: title.slice(0, 200) || parsed.hostname,
    hostname: parsed.hostname,
    text,
  };
}
