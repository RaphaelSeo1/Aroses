/**
 * Wikimedia Commons image search — DISABLED.
 *
 * Wikimedia images have been removed across the product (mentored
 * learning, tutor sessions, and course/study lessons). This module is
 * kept only so existing imports keep compiling; `searchWikimediaImage`
 * always resolves to `null`, which every caller already treats as
 * "no image — continue without one".
 *
 * Do not re-enable network calls here without product sign-off.
 */

export type WikimediaResult = {
  imageUrl: string;
  thumbUrl: string;
  sourcePageUrl: string;
  attribution: string;
};

export type WikimediaImageType = "diagram" | "photo" | "illustration";

export async function searchWikimediaImage(
  _query: string,
  _imageType: WikimediaImageType
): Promise<WikimediaResult | null> {
  return null;
}
