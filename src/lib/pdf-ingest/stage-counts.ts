export type PdfAssetExtractCounts = {
  pagesRendered: number;
  rasterImages: number;
  vectorDiagrams: number;
  tablesFound: number;
  cropsUploaded: number;
};

export type PdfAssetClassifyCounts = {
  kept: number;
  discarded: number;
};

export type PdfAssetPlaceCounts = {
  assetsAvailable: number;
  assetsInjected: number;
  lessonsReceiving: number;
};

export type PdfAssetStageCounts = {
  extract: PdfAssetExtractCounts;
  classify: PdfAssetClassifyCounts;
  place: PdfAssetPlaceCounts;
};

export function logExtractCounts(
  jobId: string | undefined,
  counts: PdfAssetExtractCounts
): void {
  const tag = jobId ? `[pdf-asset-pipeline:${jobId}]` : "[pdf-asset-pipeline]";
  console.info(`${tag} EXTRACT pagesRendered=${counts.pagesRendered}`);
  console.info(`${tag} EXTRACT rasterImages=${counts.rasterImages}`);
  console.info(`${tag} EXTRACT vectorDiagrams=${counts.vectorDiagrams}`);
  console.info(`${tag} EXTRACT tablesFound=${counts.tablesFound}`);
  console.info(`${tag} EXTRACT cropsUploaded=${counts.cropsUploaded}`);
}

export function logClassifyCounts(
  jobId: string | undefined,
  counts: PdfAssetClassifyCounts
): void {
  const tag = jobId ? `[pdf-asset-pipeline:${jobId}]` : "[pdf-asset-pipeline]";
  console.info(`${tag} CLASSIFY kept=${counts.kept}`);
  console.info(`${tag} CLASSIFY discarded=${counts.discarded}`);
}

export function logPlaceCounts(
  jobId: string | undefined,
  counts: PdfAssetPlaceCounts,
  lessonTitles: string[]
): void {
  const tag = jobId ? `[pdf-asset-pipeline:${jobId}]` : "[pdf-asset-pipeline]";
  console.info(`${tag} PLACE assetsAvailable=${counts.assetsAvailable}`);
  console.info(`${tag} PLACE assetsInjected=${counts.assetsInjected}`);
  console.info(`${tag} PLACE lessonsReceiving=${counts.lessonsReceiving}`);
  if (lessonTitles.length > 0) {
    console.info(`${tag} PLACE lessonTitles=${lessonTitles.join(" | ")}`);
  }
}
