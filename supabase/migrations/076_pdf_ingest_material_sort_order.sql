-- Preserve upload order for sections built from a multi-file upload.
--
-- Builds are kicked off in parallel and finalize in completion order, so
-- assigning study_materials.sort_order as max+1 at finalize scrambled the
-- sidebar (e.g. "Lecture 3" landing above "Lecture 1"). We now snapshot the
-- intended sort_order on the job at creation time (existing material count +
-- the client-provided upload index) and apply it at finalize.
alter table public.pdf_ingest_jobs
  add column if not exists material_sort_order int;
