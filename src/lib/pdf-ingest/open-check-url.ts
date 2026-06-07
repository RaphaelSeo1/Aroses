/**
 * Verify a public storage URL returns non-empty image bytes.
 * Logs loudly on failure; does not throw (upload already succeeded).
 */
export async function openCheckPublicUrl(
  url: string,
  label = "asset"
): Promise<number> {
  const trimmed = url.trim();
  if (!trimmed) {
    console.error(`[pdf-asset-pipeline] OPEN-CHECK ${label}: empty URL`);
    return 0;
  }

  try {
    const res = await fetch(trimmed, {
      method: "GET",
      headers: { Range: "bytes=0-4095" },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok && res.status !== 206) {
      console.error(
        `[pdf-asset-pipeline] OPEN-CHECK ${label}: HTTP ${res.status} for ${trimmed}`
      );
      return 0;
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 32) {
      console.error(
        `[pdf-asset-pipeline] OPEN-CHECK ${label}: response too small (${buf.length} bytes) for ${trimmed}`
      );
      return 0;
    }

    console.info(
      `[pdf-asset-pipeline] OPEN-CHECK ok ${label}: ${trimmed} (${buf.length} bytes sampled)`
    );
    return buf.length;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(
      `[pdf-asset-pipeline] OPEN-CHECK ${label}: fetch failed for ${trimmed} — ${msg}`
    );
    return 0;
  }
}
