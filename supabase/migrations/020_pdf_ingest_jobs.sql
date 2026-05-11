-- Tracks async PDF → AI → study_materials builds (Vercel returns 202 quickly; client polls).

create table if not exists public.pdf_ingest_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete cascade,
  exam_group_id uuid not null references public.exam_groups (id) on delete cascade,
  storage_path text not null,
  original_file_name text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'complete', 'failed')),
  error_message text,
  material_id uuid references public.study_materials (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdf_ingest_jobs_user_created_idx
  on public.pdf_ingest_jobs (user_id, created_at desc);

alter table public.pdf_ingest_jobs enable row level security;

drop policy if exists "pdf_ingest_jobs_select_own" on public.pdf_ingest_jobs;
create policy "pdf_ingest_jobs_select_own"
  on public.pdf_ingest_jobs
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "pdf_ingest_jobs_insert_own" on public.pdf_ingest_jobs;
create policy "pdf_ingest_jobs_insert_own"
  on public.pdf_ingest_jobs
  for insert
  to authenticated
  with check (auth.uid() = user_id);
