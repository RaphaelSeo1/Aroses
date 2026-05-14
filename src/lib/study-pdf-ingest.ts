/** Private Supabase Storage bucket for PDFs before `study_materials` row exists. */
export const STUDY_PDF_INGEST_BUCKET = "study-pdf-ingest";

/** Same cap as `/api/process-pdf` (Storage bucket + server memory). */
export const MAX_STUDY_PDF_BYTES = 150 * 1024 * 1024;
