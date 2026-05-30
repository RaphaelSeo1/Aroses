import JSZip from "jszip";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

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

/** Pull embedded images from a .docx (whole-document anchor). */
export async function extractDocxSourceImages(
  buffer: Buffer,
  sourceFileName: string
): Promise<RawSourceImage[]> {
  const zip = await JSZip.loadAsync(buffer);
  const mediaFiles = Object.keys(zip.files).filter((n) =>
    /^word\/media\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(n)
  );

  const out: RawSourceImage[] = [];
  for (let i = 0; i < mediaFiles.length; i++) {
    const path = mediaFiles[i];
    const mimeType = mimeFromPath(path);
    if (!mimeType) continue;
    const file = zip.file(path);
    if (!file) continue;
    const buf = Buffer.from(await file.async("arraybuffer"));
    if (buf.length < MIN_BYTES) continue;
    out.push({
      buffer: buf,
      mimeType,
      fileName: path.split("/").pop() ?? "image",
      sourceFileName,
      label: `Figure ${i + 1}`,
      anchorType: "document",
      anchorIndex: i + 1,
    });
  }
  return out;
}
