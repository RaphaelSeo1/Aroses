import { createClient } from "@/lib/supabase/client";

export const NOTE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const NOTE_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type NoteImageUploadResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/**
 * Upload a note image to the shared public images bucket and return its URL.
 * Paths are namespaced under `{uid}/notes/` so notes don't collide with forum posts.
 */
export async function uploadNoteImage(file: File): Promise<NoteImageUploadResult> {
  if (
    !NOTE_IMAGE_MIME_TYPES.includes(
      file.type as (typeof NOTE_IMAGE_MIME_TYPES)[number]
    )
  ) {
    return {
      ok: false,
      error: "Use a JPG, PNG, WebP, or GIF image.",
    };
  }
  if (file.size > NOTE_IMAGE_MAX_BYTES) {
    return { ok: false, error: "Image is too large (max 10 MB)." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "Sign in to add images." };
  }

  const extFromName = file.name.split(".").pop()?.toLowerCase();
  const extFromType = file.type.split("/")[1]?.replace("jpeg", "jpg");
  const ext = (extFromName && extFromName.length <= 5 ? extFromName : null) ||
    extFromType ||
    "png";
  const path = `${user.id}/notes/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("forum-images")
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) {
    return { ok: false, error: upErr.message || "Could not upload image." };
  }

  const { data: pub } = supabase.storage.from("forum-images").getPublicUrl(path);
  if (!pub?.publicUrl) {
    return { ok: false, error: "Could not get image URL." };
  }
  return { ok: true, url: pub.publicUrl };
}

/** Collect image files from a paste or drop DataTransfer. */
export function imageFilesFromDataTransfer(
  data: DataTransfer | null | undefined
): File[] {
  if (!data) return [];
  const out: File[] = [];
  if (data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) out.push(file);
    }
  }
  if (out.length === 0 && data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) out.push(file);
      }
    }
  }
  return out;
}
