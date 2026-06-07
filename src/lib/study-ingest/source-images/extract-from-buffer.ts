import type { IngestFormatKind } from "@/lib/study-ingest/formats";
import { extensionOfFileName } from "@/lib/study-ingest/formats";
import { extractDocxSourceImages } from "@/lib/study-ingest/source-images/extract-docx";
import { extractPdfSourceImages } from "@/lib/study-ingest/source-images/extract-pdf";
import { extractPptxSourceImages } from "@/lib/study-ingest/source-images/extract-pptx";
import {
  cropPngToFigure,
  parseNormalizedBbox,
} from "@/lib/study-ingest/source-images/crop-page-figure";
import { extractFigureBboxesFromPdfPagePng } from "@/lib/study-ingest/source-images/extract-pdf-page-tables";
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

async function cropRegionsFromRaster(input: {
  buffer: Buffer;
  mimeType: RawSourceImage["mimeType"];
  fileName: string;
  sourceFileName: string;
}): Promise<RawSourceImage[]> {
  const hits = await extractFigureBboxesFromPdfPagePng({
    buffer: input.buffer,
    pageNum: 1,
    sourceFileName: input.sourceFileName,
  });

  const crops: RawSourceImage[] = [];
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i]!;
    const bbox = parseNormalizedBbox(hit.bbox);
    if (!bbox) continue;
    const cropped = await cropPngToFigure(input.buffer, bbox);
    if (!cropped || cropped.length < 800) continue;
    crops.push({
      buffer: cropped,
      mimeType: "image/png",
      fileName: `${input.fileName.replace(/\.[^.]+$/i, "")}-region-${i + 1}.png`,
      sourceFileName: input.sourceFileName,
      label: hit.caption || `Figure ${i + 1}`,
      anchorType: "document",
      anchorIndex: i + 1,
    });
  }
  return crops;
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
      const crops = await cropRegionsFromRaster({
        buffer,
        mimeType,
        fileName,
        sourceFileName: fileName,
      });
      if (crops.length > 0) {
        images = crops;
      } else {
        images = [
          {
            buffer,
            mimeType,
            fileName,
            sourceFileName: fileName,
            label: fileName.replace(/\.[^.]+$/i, "") || "Uploaded figure",
            anchorType: "document",
            anchorIndex: 1,
          },
        ];
      }
    }
  }

  return images.slice(0, MAX_IMAGES_PER_FILE);
}
