-- 035_lesson_images.sql
--
-- Caches Wikimedia Commons images on a per-lesson basis. The first
-- time a lesson is rendered (Free Exploration or Mentored) we run the
-- AI classifier + image search and persist the result here. Every
-- subsequent render for that lesson — by ANY student — reads the
-- cached row instead of re-classifying / re-searching.
--
-- Lessons themselves live inside `study_materials.payload` JSONB, so
-- we key by (material_id, module_id, lesson_idx) rather than a
-- foreign key. The classifier's verdict is recorded even when no
-- image was wanted, so we don't re-run the AI call repeatedly for
-- lessons that don't benefit from a visual.

create table if not exists public.lesson_images (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.study_materials(id) on delete cascade,
  module_id integer not null,
  lesson_idx integer not null,

  -- AI verdict: should this lesson have an image at all?
  needs_image boolean not null,
  -- The query we sent to Wikimedia. Cached for debugging + so the
  -- on-demand request matcher can dedupe by intent.
  search_query text,
  -- 'diagram' | 'photo' | 'illustration' | null when needs_image is
  -- false. Stored as text (not an enum) so we can extend later.
  image_type text,

  -- Resolved image. NULL when needs_image is false OR when search
  -- returned nothing useful.
  image_url text,
  image_thumb_url text,
  -- Source page on Wikimedia (for attribution link).
  source_page_url text,
  -- Plain-text attribution string ("by Photographer X, CC BY-SA 4.0,
  -- via Wikimedia Commons"). Required by licensing.
  attribution text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique(material_id, module_id, lesson_idx)
);

create index if not exists lesson_images_material_idx
  on public.lesson_images (material_id);

alter table public.lesson_images enable row level security;

-- Lesson images aren't user-scoped (the same image is reused for
-- every student looking at this lesson) but we still gate reads by
-- whether the caller has access to the underlying material. The
-- access check also happens in the API route via
-- `canAccessStudyMaterial` before we expose any row; RLS here is a
-- defense-in-depth backstop against direct anon reads.
create policy "Anyone with material access can read lesson images"
  on public.lesson_images for select
  using (
    exists (
      select 1
      from public.study_materials sm
      join public.courses c on c.id = sm.course_id
      where sm.id = lesson_images.material_id
        and (sm.user_id = auth.uid() or c.is_public = true)
    )
  );

-- Inserts/updates only via the service role (server-side classifier
-- + searcher). No client-side writes.
create policy "Service role manages lesson images"
  on public.lesson_images for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.lesson_images is
  'Per-(material, module, lesson) cached Wikimedia Commons image + attribution. Lazily populated on first lesson render via the lesson-image API.';

-- ---------------------------------------------------------------------------
-- mentored_image_requests — on-demand image searches from Rose
-- ---------------------------------------------------------------------------
--
-- Separate table for the Mentored Learning on-demand path: Rose
-- decides (or the student asks) for a specific visual mid-session.
-- Keyed by (material_id, normalized_query) so multiple students
-- asking "show me the heart" share the same cached result.

create table if not exists public.mentored_image_requests (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.study_materials(id) on delete cascade,

  -- Lowercase, trimmed query the student/Rose asked for. Cache key.
  query text not null,
  image_type text,

  image_url text,
  image_thumb_url text,
  source_page_url text,
  attribution text,

  -- True when Wikimedia had nothing usable — we still cache the
  -- "miss" so we don't spam the API for the same query.
  not_found boolean not null default false,

  created_at timestamptz not null default now(),

  unique(material_id, query)
);

create index if not exists mentored_image_requests_material_idx
  on public.mentored_image_requests (material_id);

alter table public.mentored_image_requests enable row level security;

create policy "Anyone with material access can read mentored image requests"
  on public.mentored_image_requests for select
  using (
    exists (
      select 1
      from public.study_materials sm
      join public.courses c on c.id = sm.course_id
      where sm.id = mentored_image_requests.material_id
        and (sm.user_id = auth.uid() or c.is_public = true)
    )
  );

create policy "Service role manages mentored image requests"
  on public.mentored_image_requests for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

comment on table public.mentored_image_requests is
  'Per-(material, query) cached on-demand image lookups for Mentored Learning. Shared across students so identical asks dont re-hit Wikimedia.';
