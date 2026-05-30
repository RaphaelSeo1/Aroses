import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  IngestSourceImageRecord,
  RawSourceImage,
} from "@/lib/study-ingest/source-images/types";

const BUCKET = "study-material-images";
const MAX_TOTAL = 40;

function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "bin";
  }
}

export async function uploadIngestSourceImages(input: {
  admin: SupabaseClient;
  userId: string;
  jobId: string;
  images: RawSourceImage[];
}): Promise<IngestSourceImageRecord[]> {
  const { admin, userId, jobId, images } = input;
  const out: IngestSourceImageRecord[] = [];

  for (let i = 0; i < images.length && out.length < MAX_TOTAL; i++) {
    const img = images[i];
    const ext = extForMime(img.mimeType);
    const path = `${userId}/ingest/${jobId}/${i + 1}-${crypto.randomUUID()}.${ext}`;

    const { error } = await admin.storage.from(BUCKET).upload(path, img.buffer, {
      contentType: img.mimeType,
      upsert: false,
    });
    if (error) {
      console.warn("[uploadIngestSourceImages]", path, error.message);
      continue;
    }

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
    const url = pub?.publicUrl?.trim();
    if (!url) continue;

    out.push({
      id: `${jobId}-${i + 1}`,
      url,
      sourceFileName: img.sourceFileName,
      label: img.label,
      anchorType: img.anchorType,
      anchorIndex: img.anchorIndex,
      mimeType: img.mimeType,
    });
  }

  return out;
}

export function parseIngestSourceImages(raw: unknown): IngestSourceImageRecord[] {
  if (!Array.isArray(raw)) return [];
  const out: IngestSourceImageRecord[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const url = typeof r.url === "string" ? r.url : "";
    if (!url) continue;
    const anchorType =
      r.anchorType === "slide" || r.anchorType === "page" || r.anchorType === "document"
        ? r.anchorType
        : "document";
    out.push({
      id: typeof r.id === "string" ? r.id : url,
      url,
      sourceFileName:
        typeof r.sourceFileName === "string" ? r.sourceFileName : "upload",
      label: typeof r.label === "string" ? r.label : "Figure",
      anchorType,
      anchorIndex:
        typeof r.anchorIndex === "number" && Number.isFinite(r.anchorIndex)
          ? r.anchorIndex
          : 0,
      mimeType:
        typeof r.mimeType === "string" ? r.mimeType : "image/png",
    });
  }
  return out;
}
