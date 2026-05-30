import type { CourseModule } from "@/types/course";
import { lessonMarkdownHasImages } from "@/lib/lesson-content-layout";
import type { IngestSourceImageRecord } from "@/lib/study-ingest/source-images/types";

function maxAnchorIndex(
  images: IngestSourceImageRecord[],
  type: "slide" | "page"
): number {
  let max = 0;
  for (const img of images) {
    if (img.anchorType === type && img.anchorIndex > max) {
      max = img.anchorIndex;
    }
  }
  return max;
}

function moduleIndexForAnchor(
  anchorIndex: number,
  anchorMax: number,
  moduleCount: number
): number {
  if (moduleCount <= 0) return 0;
  if (anchorMax <= 0 || anchorIndex <= 0) return 0;
  const ratio = (anchorIndex - 1) / anchorMax;
  return Math.min(moduleCount - 1, Math.floor(ratio * moduleCount));
}

function markdownHasImage(content: string): boolean {
  return lessonMarkdownHasImages(content);
}

function embedImagesInLesson(
  content: string,
  images: IngestSourceImageRecord[]
): string {
  if (images.length === 0) return content;
  if (markdownHasImage(content)) return content;

  const blocks = images.map(
    (img) => `![${img.label} from ${img.sourceFileName}](${img.url})`
  );
  const trimmed = content.trim();
  if (!trimmed) return blocks.join("\n\n");
  return `${trimmed}\n\n${blocks.join("\n\n")}`;
}

/**
 * Embeds figures extracted from the student's upload into generated lessons,
 * mapped proportionally by slide/page number to course modules.
 */
export function embedSourceImagesInModules(
  modules: CourseModule[],
  sourceImages: IngestSourceImageRecord[]
): CourseModule[] {
  if (!sourceImages.length || !modules.length) return modules;

  const slideMax = maxAnchorIndex(sourceImages, "slide");
  const pageMax = maxAnchorIndex(sourceImages, "page");
  const moduleCount = modules.length;

  const byModule = new Map<number, IngestSourceImageRecord[]>();
  const docImages: IngestSourceImageRecord[] = [];

  for (const img of sourceImages) {
    let modIdx = 0;
    if (img.anchorType === "slide" && slideMax > 0) {
      modIdx = moduleIndexForAnchor(img.anchorIndex, slideMax, moduleCount);
    } else if (img.anchorType === "page" && pageMax > 0) {
      modIdx = moduleIndexForAnchor(img.anchorIndex, pageMax, moduleCount);
    } else {
      docImages.push(img);
      continue;
    }
    const arr = byModule.get(modIdx) ?? [];
    arr.push(img);
    byModule.set(modIdx, arr);
  }

  if (docImages.length > 0) {
    const per = Math.max(1, Math.ceil(docImages.length / moduleCount));
    for (let i = 0; i < docImages.length; i++) {
      const modIdx = Math.min(moduleCount - 1, Math.floor(i / per));
      const arr = byModule.get(modIdx) ?? [];
      arr.push(docImages[i]);
      byModule.set(modIdx, arr);
    }
  }

  return modules.map((mod, modIdx) => {
    const imgs = byModule.get(modIdx);
    if (!imgs?.length || !mod.lessons?.length) return mod;

    const lessons = mod.lessons.map((lesson, lessonIdx) => {
      if (lessonIdx !== 0) return lesson;
      return {
        ...lesson,
        content: embedImagesInLesson(lesson.content, imgs),
      };
    });

    return { ...mod, lessons };
  });
}
