/**
 * Maps Supabase Storage errors to human-readable guidance for lesson image uploads.
 */
export function describeStorageUploadFailure(message: string): string {
  const m = message.toLowerCase();

  if (
    m.includes("bucket") ||
    m.includes("not found") ||
    m.includes("does not exist")
  ) {
    return (
      "Image hosting isn’t configured yet. In Supabase: open SQL Editor and run " +
      "the migrations `010_study_material_images.sql` then `012_storage_image_policies_fix.sql` " +
      "from your project’s `supabase/migrations/` folder. That creates the `study-material-images` bucket and upload rules."
    );
  }

  if (
    m.includes("row-level security") ||
    m.includes("policy") ||
    m.includes("permission denied") ||
    m.includes("violates row-level security") ||
    m.includes("403")
  ) {
    return (
      "Upload was blocked by storage permissions. Run the migration SQL files " +
      "`010_study_material_images.sql` and `012_storage_image_policies_fix.sql` in the Supabase SQL Editor " +
      "(Dashboard → SQL → New query → paste → Run)."
    );
  }

  if (m.includes("payload too large") || m.includes("413")) {
    return "File is too large for storage limits.";
  }

  return (
    "Could not upload the image. If this keeps happening, confirm migrations 010 and 012 " +
    "have been applied in Supabase and try again."
  );
}
