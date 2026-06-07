import type {
  IngestSourceImageRecord,
  RawSourceImage,
} from "@/lib/study-ingest/source-images/types";

/** Full-page PNG renders — never embed these in lessons; use vision crops instead. */
export function isFullPageRenderImage(img: {
  label?: string;
  fileName?: string;
}): boolean {
  const label = (img.label ?? "").trim();
  if (/^Page \d+$/i.test(label)) return true;
  if (/^page \d+ snapshot$/i.test(label)) return true;
  if (/full page/i.test(label)) return true;

  const fileName = (img.fileName ?? "").trim();
  if (/page-\d+-render\.png$/i.test(fileName)) return true;
  if (/page_snapshot/i.test(fileName)) return true;

  return false;
}

export function filterCroppedFiguresOnly(
  images: IngestSourceImageRecord[]
): IngestSourceImageRecord[] {
  return images.filter((img) => img.url && !isFullPageRenderImage({ label: img.label }));
}

export function filterRawCropsOnly(images: RawSourceImage[]): RawSourceImage[] {
  return images.filter(
    (img) => !isFullPageRenderImage({ label: img.label, fileName: img.fileName })
  );
}
