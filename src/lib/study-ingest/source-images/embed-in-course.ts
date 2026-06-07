import type { CourseModule } from "@/types/course";
import { assignFiguresToLessons, buildFiguresIndex, type FiguresIndex } from "@/lib/figure-attribution";
import { lessonMarkdownHasImages, splitLeadParagraph } from "@/lib/lesson-content-layout";
import { filterCroppedFiguresOnly } from "@/lib/study-ingest/source-images/is-page-render";
import type { SourceIndex } from "@/lib/source-attribution";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

function figureMarkdown(img: IngestSourceImageRecord): string {
  const locator =
    img.anchorType === "page"
      ? `page ${img.anchorIndex}`
      : img.anchorType === "slide"
        ? `slide ${img.anchorIndex}`
        : img.sourceFileName;
  const alt = img.label || `Table or figure from ${locator}`;
  return `**From your material** (${locator})\n\n![${alt}](${img.url})`;
}

/**
 * Insert figures after the opening paragraph so the lead intro stays readable
 * and visuals appear before the main body (LessonRichContent treats the first
 * markdown image as the primary sidebar figure).
 */
function embedImagesAfterLeadParagraph(
  content: string,
  images: IngestSourceImageRecord[]
): string {
  if (images.length === 0) return content;
  if (lessonMarkdownHasImages(content)) return content;

  const blocks = images.map(figureMarkdown);
  const trimmed = content.trim();
  if (!trimmed) return blocks.join("\n\n");

  const { lead, body } = splitLeadParagraph(trimmed);
  if (!lead) return blocks.join("\n\n");
  if (!body) return `${lead}\n\n${blocks.join("\n\n")}`;
  return `${lead}\n\n${blocks.join("\n\n")}\n\n${body}`;
}

export type EmbedSourceImagesResult = {
  modules: CourseModule[];
  figuresIndex: FiguresIndex | null;
};

/**
 * Embeds figures extracted from the student's upload into the lessons that
 * cover the matching slides/pages (via ingest plan + chunk positions).
 */
export function embedSourceImagesInModules(
  modules: CourseModule[],
  sourceImages: IngestSourceImageRecord[],
  sourceIndex?: SourceIndex | null
): EmbedSourceImagesResult {
  if (!sourceImages.length || !modules.length) {
    return { modules, figuresIndex: null };
  }

  const cropsOnly = filterCroppedFiguresOnly(sourceImages);
  if (!cropsOnly.length) {
    return { modules, figuresIndex: null };
  }

  const assignment = assignFiguresToLessons(
    modules,
    cropsOnly,
    sourceIndex ?? null
  );

  if (assignment.size === 0) {
    return { modules, figuresIndex: null };
  }

  const next = modules.map((mod) => {
    const lessons = mod.lessons.map((lesson, li) => {
      const imgs = assignment.get(`${mod.id}:${li}`);
      if (!imgs?.length) return lesson;
      return {
        ...lesson,
        content: embedImagesAfterLeadParagraph(lesson.content, imgs),
      };
    });
    return { ...mod, lessons };
  });

  return {
    modules: next,
    figuresIndex: buildFiguresIndex(modules, cropsOnly, assignment),
  };
}
