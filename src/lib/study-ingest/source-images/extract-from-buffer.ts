import type { IngestFormatKind } from "@/lib/study-ingest/formats";
import { extensionOfFileName } from "@/lib/study-ingest/formats";
import { extractDocxSourceImages } from "@/lib/study-ingest/source-images/extract-docx";
import { extractPdfSourceImages } from "@/lib/study-ingest/source-images/extract-pdf";
import { extractPptxSourceImages } from "@/lib/study-ingest/source-images/extract-pptx";
import type { RawSourceImage } from "@/lib/study-ingest/source-images/types";

const MAX_IMAGES_PER_FILE = 25;

function mimeFromFileName(fileName: string): string | null {
  const ext = extensionOfFileName(fileName);
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg" || ext === "heic" || ext === "heif") {
    return "image/jpeg";
  }
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return null;
}

/** Extract embeddable figures from an uploaded source buffer. */
export async function extractSourceImagesFromBuffer(input: {
  buffer: Buffer;
  fileName: string;
  kind: IngestFormatKind;
}): Promise<RawSourceImage[]> {
  const { buffer, fileName, kind } = input;
  let images: RawSourceImage[] = [];

  if (kind === "slides") {
    images = await extractPptxSourceImages(buffer, fileName);
  } else if (kind === "word") {
    images = await extractDocxSourceImages(buffer, fileName);
  } else if (kind === "pdf") {
    images = await extractPdfSourceImages(buffer, fileName);
  } else if (kind === "image") {
    const mimeType = mimeFromFileName(fileName);
    if (mimeType && buffer.length >= 500) {
      images = [
        {
          buffer,
          mimeType,
          fileName,
          sourceFileName: fileName,
          label: "Source image",
          anchorType: "document",
          anchorIndex: 1,
        },
      ];
    }
  }

  return images.slice(0, MAX_IMAGES_PER_FILE);
}
