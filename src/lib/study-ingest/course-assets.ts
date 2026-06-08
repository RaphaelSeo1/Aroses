import {
  cosineSimilarity,
  embedText,
  embedTextsBatch,
} from "@/lib/embeddings/text-similarity";
import { sanitizeTableMarkdown } from "@/lib/study-ingest/table-text";
import type { IngestPageArtifacts } from "@/lib/study-ingest/inject-pdf-tables-into-module";
import { pageFigureCropKey, pageTableKey } from "@/lib/study-ingest/source-images/page-table-keys";
import type { CourseModule } from "@/types/course";

export type CourseAssetType = "table" | "figure" | "image";

export type CourseAsset = {
  assetId: string;
  type: CourseAssetType;
  url: string;
  sourcePage: number;
  sourceFileName: string;
  caption: string;
  /** GFM markdown for tables; omitted for figures. */
  markdown?: string;
  embedding: number[];
  /** Normalized bbox [ymin,xmin,ymax,xmax] on 0–1000 scale when available. */
  bbox?: [number, number, number, number];
  teachingPurpose?: string;
  whenToUse?: string;
};

export type CourseAssetManifest = {
  version: 1;
  assets: CourseAsset[];
};

export type CourseAssetSummary = Pick<
  CourseAsset,
  | "assetId"
  | "type"
  | "url"
  | "caption"
  | "sourcePage"
  | "markdown"
  | "bbox"
  | "teachingPurpose"
>;

function sanitizeStem(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/i, "")
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28)
    .toLowerCase() || "doc";
}

export function tableAssetId(sourceFileName: string, pageNum: number): string {
  return `tbl_${sanitizeStem(sourceFileName)}_p${pageNum}`;
}

export function figureAssetId(
  sourceFileName: string,
  pageNum: number,
  figureIndex: number
): string {
  return `fig_${sanitizeStem(sourceFileName)}_p${pageNum}_${figureIndex}`;
}

function captionFromTableMarkdown(markdown: string, pageNum: number): string {
  const firstLine = markdown
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("|"));
  if (firstLine && firstLine.length > 6) return firstLine.slice(0, 160);
  const header = markdown
    .split("\n")
    .find((l) => l.includes("|"));
  if (header) {
    const cells = header
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length > 0) {
      return `Table (page ${pageNum}): ${cells.slice(0, 4).join(", ")}`.slice(
        0,
        160
      );
    }
  }
  return `Table from page ${pageNum}`;
}

export function parseCourseAssetManifest(raw: unknown): CourseAssetManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.assets)) return null;
  const assets: CourseAsset[] = [];
  for (const row of o.assets) {
    if (!row || typeof row !== "object") continue;
    const a = row as Record<string, unknown>;
    if (
      typeof a.assetId !== "string" ||
      typeof a.caption !== "string" ||
      !Array.isArray(a.embedding)
    ) {
      continue;
    }
    const type =
      a.type === "table" || a.type === "figure" || a.type === "image"
        ? a.type
        : "figure";
    assets.push({
      assetId: a.assetId,
      type,
      url: typeof a.url === "string" ? a.url : "",
      sourcePage:
        typeof a.sourcePage === "number" && Number.isFinite(a.sourcePage)
          ? a.sourcePage
          : 0,
      sourceFileName:
        typeof a.sourceFileName === "string" ? a.sourceFileName : "",
      caption: a.caption,
      markdown: typeof a.markdown === "string" ? a.markdown : undefined,
      embedding: a.embedding.filter(
        (n): n is number => typeof n === "number" && Number.isFinite(n)
      ),
      bbox: Array.isArray(a.bbox) && a.bbox.length === 4
        ? (a.bbox as [number, number, number, number])
        : undefined,
      teachingPurpose:
        typeof a.teachingPurpose === "string" ? a.teachingPurpose : undefined,
      whenToUse: typeof a.whenToUse === "string" ? a.whenToUse : undefined,
    });
  }
  return assets.length > 0 ? { version: 1, assets } : null;
}

/** Build a global asset manifest from ingest page artifacts. */
export async function buildCourseAssetManifest(
  artifacts: IngestPageArtifacts
): Promise<CourseAssetManifest> {
  const drafts: Omit<CourseAsset, "embedding">[] = [];

  const tableMarkdownByPage = new Map<string, string>();
  for (const [key, markdown] of Object.entries(artifacts.tables)) {
    if (markdown?.trim()) tableMarkdownByPage.set(key, markdown);
  }

  const figByPage = new Map<string, number>();
  const tblByPage = new Map<string, number>();
  for (const fig of artifacts.figures) {
    if (fig.kind === "table") {
      const ti = tblByPage.get(`${fig.sourceFileName}::${fig.pageNum}`) ?? 0;
      tblByPage.set(`${fig.sourceFileName}::${fig.pageNum}`, ti + 1);
      const pageKey = pageTableKey(fig.sourceFileName, fig.pageNum);
      drafts.push({
        assetId: fig.key || `${tableAssetId(fig.sourceFileName, fig.pageNum)}_${ti}`,
        type: "table",
        url: fig.url,
        sourcePage: fig.pageNum,
        sourceFileName: fig.sourceFileName,
        caption: fig.caption?.trim() || `Table on page ${fig.pageNum}`,
        markdown: tableMarkdownByPage.get(pageKey),
      });
      continue;
    }

    const pageKey = `${fig.sourceFileName}::${fig.pageNum}`;
    const fi = figByPage.get(pageKey) ?? 0;
    figByPage.set(pageKey, fi + 1);
    drafts.push({
      assetId:
        fig.key ||
        figureAssetId(fig.sourceFileName, fig.pageNum, fi) ||
        pageFigureCropKey(fig.sourceFileName, fig.pageNum, fi),
      type: "figure",
      url: fig.url,
      sourcePage: fig.pageNum,
      sourceFileName: fig.sourceFileName,
      caption: fig.caption?.trim() || `Figure on page ${fig.pageNum}`,
    });
  }

  const captions = drafts.map((d) => d.caption);
  const embeddings = await embedTextsBatch(captions);
  const assets = drafts.map((d, i) => ({
    ...d,
    embedding: embeddings[i] ?? [],
  }));

  return { version: 1, assets };
}

export function assetManifestById(
  manifest: CourseAssetManifest
): Map<string, CourseAsset> {
  return new Map(manifest.assets.map((a) => [a.assetId, a]));
}

export function formatAssetManifestForPrompt(assets: CourseAsset[]): string {
  if (assets.length === 0) return "";
  const lines = assets.map((a) => {
    const kind = a.type === "table" ? "table" : "figure";
    const page =
      a.sourcePage > 0 ? ` (page ${a.sourcePage})` : "";
    const purpose = a.teachingPurpose ? ` — use when: ${a.teachingPurpose}` : "";
    return `[asset:${a.assetId}] ${kind}${page} — ${a.caption}${purpose}`;
  });
  return `AVAILABLE PDF TABLES (from the student's upload):
${lines.join("\n")}

TABLE PLACEMENT (required when a table matches lesson content):
- Reproduce each matching table as a **full GitHub-flavored markdown table** in that lesson's "content" (header + |---| + every row). Use the table's markdown from TABLE DATA blocks when present.
- Do NOT summarize table rows into prose only — include the complete grid.
- Do NOT use {{asset:...}} tokens — students read markdown tables in the lesson body.`;
}

export function mergeManifestWithDbAssets(
  manifest: CourseAssetManifest | null,
  dbRows: import("@/lib/pdf-ingest/persist-course-assets").CourseAssetRow[],
  sourceFileName: string
): CourseAssetManifest | null {
  const assets: CourseAsset[] = (manifest?.assets ?? []).map((a) => ({ ...a }));
  const seen = new Set(assets.map((a) => a.assetId));

  for (const row of dbRows) {
    const url = row.asset_url?.trim() ?? "";
    if (!url && !row.markdown?.trim()) continue;

    const match = assets.find(
      (a) =>
        a.sourcePage === row.source_page &&
        (a.caption === row.caption || (url && a.url === url))
    );
    if (match) {
      if (!match.url && url) match.url = url;
      if (!match.embedding.length && row.caption_embedding?.length) {
        match.embedding = row.caption_embedding;
      }
      if (row.teaching_purpose && !match.teachingPurpose) {
        match.teachingPurpose = row.teaching_purpose;
      }
      continue;
    }

    if (seen.has(row.id)) continue;
    seen.add(row.id);
    assets.push({
      assetId: row.id,
      type: row.type,
      url,
      sourcePage: row.source_page,
      sourceFileName,
      caption: row.caption || `Visual page ${row.source_page}`,
      markdown: row.markdown ?? undefined,
      embedding: row.caption_embedding ?? [],
      teachingPurpose: row.teaching_purpose ?? undefined,
    });
  }

  return assets.length > 0 ? { version: 1, assets } : null;
}

export async function retrieveAssetsForQuery(
  manifest: CourseAssetManifest,
  query: string,
  limit = 8
): Promise<CourseAsset[]> {
  if (!manifest.assets.length || !query.trim()) return [];
  const qEmb = await embedText(query);
  return manifest.assets
    .map((asset) => ({
      asset,
      score: cosineSimilarity(qEmb, asset.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.asset);
}

export async function retrieveAssetsForModuleOutline(input: {
  manifest: CourseAssetManifest;
  moduleTitle: string;
  lessonTitles: string[];
  limit?: number;
}): Promise<CourseAsset[]> {
  const query = `${input.moduleTitle}\n${input.lessonTitles.join("\n")}`;
  return retrieveAssetsForQuery(
    input.manifest,
    query,
    input.limit ?? 10
  );
}

export function resolveAssetTokensInContent(
  content: string,
  byId: Map<string, CourseAsset>
): string {
  return content.replace(/\{\{asset:([^}]+)\}\}/g, (_match, rawId: string) => {
    const id = rawId.trim();
    const asset = byId.get(id);
    if (!asset) return "";
    // Figures attach via visual_assets only — never inline PNGs in lesson text.
    if (asset.url) {
      return "";
    }
    if (asset.type === "table" && asset.markdown?.trim()) {
      return `\n\n${sanitizeTableMarkdown(asset.markdown).trim()}\n\n`;
    }
    return "";
  });
}

export function resolveAssetTokensInModules(
  modules: CourseModule[],
  manifest: CourseAssetManifest | null
): CourseModule[] {
  if (!manifest || manifest.assets.length === 0) return modules;
  const byId = assetManifestById(manifest);
  return modules.map((mod) => ({
    ...mod,
    lessons: mod.lessons.map((lesson) => ({
      ...lesson,
      content: resolveAssetTokensInContent(lesson.content ?? "", byId),
    })),
  }));
}

export function summarizeAssetsForMentored(
  assets: CourseAssetSummary[]
): string {
  if (assets.length === 0) return "";
  return assets
    .map(
      (a) =>
        `- ${a.assetId} (${a.type}, page ${a.sourcePage}): ${a.caption}`
    )
    .join("\n");
}

export function assetToSourceImageRecord(
  asset: CourseAssetSummary
): import("@/lib/study-ingest/source-images/types").IngestSourceImageRecord {
  return {
    id: asset.assetId,
    url: asset.url,
    sourceFileName: "upload.pdf",
    label: asset.caption,
    anchorType: "page",
    anchorIndex: asset.sourcePage,
    mimeType: asset.type === "table" ? "image/png" : "image/png",
  };
}
