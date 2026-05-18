/**
 * Wikimedia Commons image search.
 *
 * We hit the public Commons API (no key required, but identify
 * ourselves with a User-Agent per their etiquette guidelines) and
 * pick the highest-quality candidate matching the query.
 *
 * Strategy:
 *   1. `action=query&list=search&srnamespace=6` — file-namespace
 *      search by relevance.
 *   2. For each candidate, pull `imageinfo` (url, thumb, mime, size,
 *      extmetadata for attribution).
 *   3. Filter:
 *        - reject SVGs only when imageType !== 'diagram' (SVGs are
 *          ideal for diagrams, less so for photo lessons),
 *        - reject anything < 400px on the long edge (placeholders),
 *        - reject anything whose canonical title screams "logo" /
 *          "icon" / "flag" unless the query actually wanted one.
 *   4. Return the first survivor's url + thumb + attribution.
 *
 * Returns `null` when Wikimedia has nothing useful — per spec the
 * caller continues without an image (never a broken placeholder).
 */

export type WikimediaResult = {
  imageUrl: string;
  thumbUrl: string;
  sourcePageUrl: string;
  attribution: string;
};

export type WikimediaImageType = "diagram" | "photo" | "illustration";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = "Aroses/1.0 (https://aroses.app; mentored-learning) Node";

type SearchHit = { title: string };
type ImageInfo = {
  url?: string;
  thumburl?: string;
  width?: number;
  height?: number;
  mime?: string;
  descriptionurl?: string;
  extmetadata?: {
    Artist?: { value?: string };
    LicenseShortName?: { value?: string };
    UsageTerms?: { value?: string };
    Credit?: { value?: string };
  };
};
type CommonsPage = {
  title?: string;
  missing?: boolean;
  imageinfo?: ImageInfo[];
};

function htmlToText(s: string | undefined): string {
  if (!s) return "";
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAttribution(info: ImageInfo): string {
  const m = info.extmetadata ?? {};
  const artist = htmlToText(m.Artist?.value);
  const license = htmlToText(m.LicenseShortName?.value);
  const parts: string[] = [];
  if (artist) parts.push(`by ${artist}`);
  if (license) parts.push(license);
  parts.push("via Wikimedia Commons");
  return parts.join(" · ").slice(0, 280);
}

function titleLooksUnusable(title: string, query: string): boolean {
  const t = title.toLowerCase();
  const q = query.toLowerCase();
  const badTerms = ["logo", "icon", "flag", "coat of arms", "seal of"];
  for (const term of badTerms) {
    if (t.includes(term) && !q.includes(term)) return true;
  }
  return false;
}

export async function searchWikimediaImage(
  query: string,
  imageType: WikimediaImageType
): Promise<WikimediaResult | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // Step 1: relevance search in the File: namespace.
  const searchUrl = new URL(COMMONS_API);
  searchUrl.searchParams.set("action", "query");
  searchUrl.searchParams.set("format", "json");
  searchUrl.searchParams.set("list", "search");
  searchUrl.searchParams.set("srnamespace", "6");
  searchUrl.searchParams.set("srlimit", "10");
  searchUrl.searchParams.set("srsearch", trimmed);
  searchUrl.searchParams.set("origin", "*");

  let searchJson: { query?: { search?: SearchHit[] } };
  try {
    const res = await fetch(searchUrl.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    searchJson = (await res.json()) as typeof searchJson;
  } catch {
    return null;
  }

  const hits = searchJson.query?.search ?? [];
  if (hits.length === 0) return null;

  const candidateTitles = hits
    .map((h) => h.title)
    .filter((t) => !titleLooksUnusable(t, trimmed))
    .slice(0, 6);
  if (candidateTitles.length === 0) return null;

  // Step 2: fetch imageinfo for the candidates in one batch.
  const infoUrl = new URL(COMMONS_API);
  infoUrl.searchParams.set("action", "query");
  infoUrl.searchParams.set("format", "json");
  infoUrl.searchParams.set("prop", "imageinfo");
  infoUrl.searchParams.set(
    "iiprop",
    "url|size|mime|extmetadata|user"
  );
  infoUrl.searchParams.set("iiurlwidth", "1024");
  infoUrl.searchParams.set("titles", candidateTitles.join("|"));
  infoUrl.searchParams.set("origin", "*");

  let infoJson: { query?: { pages?: Record<string, CommonsPage> } };
  try {
    const res = await fetch(infoUrl.toString(), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    infoJson = (await res.json()) as typeof infoJson;
  } catch {
    return null;
  }

  const pages = Object.values(infoJson.query?.pages ?? {});
  // Preserve the relevance order from step 1.
  const orderedPages = candidateTitles
    .map((t) => pages.find((p) => p.title === t))
    .filter((p): p is CommonsPage => Boolean(p));

  for (const page of orderedPages) {
    if (page.missing) continue;
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;

    // Quality filters.
    const longEdge = Math.max(info.width ?? 0, info.height ?? 0);
    if (longEdge > 0 && longEdge < 400) continue;

    const mime = (info.mime ?? "").toLowerCase();
    // SVGs render great in <img> via Wikimedia's rasterized
    // `thumburl`, so we accept them as diagrams. For photo-style
    // requests we prefer raster.
    if (mime.includes("svg") && imageType !== "diagram") continue;
    // Always reject audio / video / pdf / other non-image types
    // even though they shouldn't show up in namespace 6 searches
    // for image queries.
    if (
      mime &&
      !mime.startsWith("image/") &&
      !mime.includes("svg")
    ) {
      continue;
    }

    return {
      imageUrl: info.thumburl ?? info.url,
      thumbUrl: info.thumburl ?? info.url,
      sourcePageUrl:
        info.descriptionurl ??
        `https://commons.wikimedia.org/wiki/${encodeURIComponent(
          page.title ?? ""
        )}`,
      attribution: buildAttribution(info),
    };
  }

  return null;
}
