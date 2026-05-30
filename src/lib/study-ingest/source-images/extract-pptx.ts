import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  attributeNamePrefix: "@_",
});

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;
const MIN_BYTES = 3_500;

function mimeFromPath(path: string): string | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return null;
}

function relTargets(relsXml: string): string[] {
  const parsed = parser.parse(relsXml) as {
    Relationships?: {
      Relationship?: unknown;
    };
  };
  const rel = parsed.Relationships?.Relationship;
  const rows = Array.isArray(rel) ? rel : rel ? [rel] : [];
  const out: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const type = String(rec["@_Type"] ?? "");
    const target = String(rec["@_Target"] ?? "");
    if (!type.includes("image") || !target) continue;
    out.push(target.replace(/^\.\.\//, ""));
  }
  return out;
}

async function readZipImage(
  zip: JSZip,
  mediaPath: string,
  meta: Omit<RawSourceImage, "buffer" | "mimeType" | "fileName">
): Promise<RawSourceImage | null> {
  const normalized = mediaPath.replace(/^\/+/, "");
  const candidates = [
    normalized,
    `ppt/${normalized}`,
    `word/${normalized}`,
  ];
  let file: JSZip.JSZipObject | null = null;
  for (const c of candidates) {
    const f = zip.file(c);
    if (f && !f.dir) {
      file = f;
      break;
    }
  }
  if (!file) return null;

  const mimeType = mimeFromPath(normalized);
  if (!mimeType) return null;

  const buffer = Buffer.from(await file.async("arraybuffer"));
  if (buffer.length < MIN_BYTES) return null;

  return {
    buffer,
    mimeType,
    fileName: normalized.split("/").pop() ?? "image",
    ...meta,
  };
}

/** Pull embedded images from a .pptx and map them to slide numbers. */
export async function extractPptxSourceImages(
  buffer: Buffer,
  sourceFileName: string
): Promise<RawSourceImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
    .sort((a, b) => {
      const na = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
      const nb = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
      return na - nb;
    });

  const out: RawSourceImage[] = [];
  const seen = new Set<string>();

  for (const slidePath of slideNames) {
    const slideNum = Number(slidePath.match(/slide(\d+)/i)?.[1] ?? 0);
    if (!slideNum) continue;
    const relPath = slidePath.replace("/slides/", "/slides/_rels/") + ".rels";
    const relXml = await zip.file(relPath)?.async("string");
    if (!relXml) continue;

    for (const target of relTargets(relXml)) {
      if (!IMAGE_EXT.test(target)) continue;
      const key = `${slideNum}:${target}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const img = await readZipImage(zip, target, {
        sourceFileName,
        label: `Slide ${slideNum}`,
        anchorType: "slide",
        anchorIndex: slideNum,
      });
      if (img) out.push(img);
    }
  }

  if (out.length === 0) {
    const mediaFiles = Object.keys(zip.files).filter((n) =>
      /^ppt\/media\/.+\.(png|jpe?g|gif|webp)$/i.test(n)
    );
    for (let i = 0; i < mediaFiles.length; i++) {
      const img = await readZipImage(zip, mediaFiles[i], {
        sourceFileName,
        label: `Slide figure ${i + 1}`,
        anchorType: "slide",
        anchorIndex: i + 1,
      });
      if (img) out.push(img);
    }
  }

  return out;
}
