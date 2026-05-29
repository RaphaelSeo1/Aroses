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

/** Guidance when direct PDF upload to Storage (ingest bucket) fails. */
export function describePdfIngestUploadFailure(message: string): string {
  const m = message.toLowerCase();

  if (
    m.includes("bucket") ||
    m.includes("not found") ||
    m.includes("does not exist")
  ) {
    return (
      "PDF ingest storage isn’t set up yet. In Supabase SQL Editor, run migration " +
      "`019_study_pdf_ingest_bucket.sql` from your repo’s `supabase/migrations/` folder " +
      "(creates the `study-pdf-ingest` bucket and policies)."
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
      "PDF upload was blocked by storage permissions. Apply migration " +
      "`019_study_pdf_ingest_bucket.sql` in the Supabase SQL Editor, then try again."
    );
  }

  if (m.includes("payload too large") || m.includes("413")) {
    return "File is too large for the configured storage limit (150 MB max).";
  }

  if (
    m.includes("mime") ||
    m.includes("content type") ||
    m.includes("not allowed") ||
    m.includes("invalidrequest")
  ) {
    return (
      "This file type isn't allowed by storage yet. In Supabase SQL Editor, run migration " +
      "`039_study_ingest_multi_format.sql` to enable Word, slides, images, audio, and video uploads."
    );
  }

  return (
    "Could not upload the PDF to storage. Confirm migration `019_study_pdf_ingest_bucket.sql` " +
    "is applied and try again."
  );
}
