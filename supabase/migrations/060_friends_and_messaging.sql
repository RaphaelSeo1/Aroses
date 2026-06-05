-- Friends + messaging (1:1 DMs, group threads, course-linked context).

-- ── Friendships ───────────────────────────────────────────────────────────────

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'blocked')),
  blocked_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz,
  constraint friendships_no_self_chk check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_uidx
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

create index if not exists friendships_addressee_pending_idx
  on public.friendships (addressee_id, status)
  where status = 'pending';

create index if not exists friendships_requester_idx
  on public.friendships (requester_id, status);

-- ── Conversations ─────────────────────────────────────────────────────────────

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('direct', 'group')),
  title text,
  course_id uuid references public.courses (id) on delete set null,
  created_by uuid not null references auth.users (id) on delete cascade,
  last_message_at timestamptz,
  last_message_preview text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint conversations_group_title_chk check (
    type <> 'group' or (title is not null and char_length(trim(title)) > 0)
  )
);

create index if not exists conversations_last_message_idx
  on public.conversations (last_message_at desc nulls last);

create index if not exists conversations_course_idx
  on public.conversations (course_id)
  where course_id is not null;

-- ── Participants ──────────────────────────────────────────────────────────────

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id, joined_at desc);

-- ── Messages ──────────────────────────────────────────────────────────────────

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null,
  sender_display_name text,
  sender_username text,
  context_course_id uuid references public.courses (id) on delete set null,
  context_material_id uuid references public.study_materials (id) on delete set null,
  context_module_id int,
  context_lesson_index int,
  context_label text,
  created_at timestamptz not null default now(),
  constraint messages_body_len_chk check (
    char_length(trim(body)) > 0 and char_length(body) <= 8000
  )
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- ── Helpers ───────────────────────────────────────────────────────────────────

create or replace function public.users_are_friends(
  p_user_id uuid,
  p_other_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.friendships f
    where f.status = 'accepted'
      and (
        (f.requester_id = p_user_id and f.addressee_id = p_other_id)
        or (f.requester_id = p_other_id and f.addressee_id = p_user_id)
      )
  );
$$;

create or replace function public.is_conversation_participant(
  p_conversation_id uuid,
  p_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and cp.user_id = p_user_id
  );
$$;

create or replace function public.lookup_profile_by_username(
  p_username text
)
returns table (
  id uuid,
  display_name text,
  username text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.username, p.avatar_url
  from public.profiles p
  where p.username is not null
    and lower(trim(p.username)) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.users_are_friends(uuid, uuid) from public;
grant execute on function public.users_are_friends(uuid, uuid) to authenticated;

revoke all on function public.is_conversation_participant(uuid, uuid) from public;
grant execute on function public.is_conversation_participant(uuid, uuid) to authenticated;

revoke all on function public.lookup_profile_by_username(text) from public;
grant execute on function public.lookup_profile_by_username(text) to authenticated;

-- Bump conversation preview on new message.
create or replace function public.messages_bump_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
  set
    last_message_at = new.created_at,
    last_message_preview = left(trim(new.body), 240),
    updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists messages_bump_conversation_trg on public.messages;
create trigger messages_bump_conversation_trg
  after insert on public.messages
  for each row
  execute function public.messages_bump_conversation();

-- ── RLS: friendships ──────────────────────────────────────────────────────────

alter table public.friendships enable row level security;

create policy "Users read own friendship rows"
  on public.friendships for select to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy "Users send friend requests"
  on public.friendships for insert to authenticated
  with check (requester_id = auth.uid() and status = 'pending');

create policy "Users respond to friend requests"
  on public.friendships for update to authenticated
  using (addressee_id = auth.uid() or requester_id = auth.uid())
  with check (addressee_id = auth.uid() or requester_id = auth.uid());

create policy "Users delete own friendship rows"
  on public.friendships for delete to authenticated
  using (requester_id = auth.uid() or addressee_id = auth.uid());

-- ── RLS: profiles — friends can read each other ───────────────────────────────

create policy "Friends read friend profiles"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.users_are_friends(auth.uid(), id)
  );

-- ── RLS: conversations ────────────────────────────────────────────────────────

alter table public.conversations enable row level security;

create policy "Participants read conversations"
  on public.conversations for select to authenticated
  using (public.is_conversation_participant(id));

create policy "Authenticated users create conversations"
  on public.conversations for insert to authenticated
  with check (created_by = auth.uid());

create policy "Participants update conversations"
  on public.conversations for update to authenticated
  using (public.is_conversation_participant(id))
  with check (public.is_conversation_participant(id));

-- ── RLS: conversation_participants ────────────────────────────────────────────

alter table public.conversation_participants enable row level security;

create policy "Participants read roster"
  on public.conversation_participants for select to authenticated
  using (public.is_conversation_participant(conversation_id));

create policy "Creators and admins manage participants"
  on public.conversation_participants for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (
          c.created_by = auth.uid()
          or exists (
            select 1 from public.conversation_participants cp
            where cp.conversation_id = conversation_id
              and cp.user_id = auth.uid()
              and cp.role = 'admin'
          )
        )
    )
    or user_id = auth.uid()
  );

create policy "Users update own participant row"
  on public.conversation_participants for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── RLS: messages ─────────────────────────────────────────────────────────────

alter table public.messages enable row level security;

create policy "Participants read messages"
  on public.messages for select to authenticated
  using (public.is_conversation_participant(conversation_id));

create policy "Participants send messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and public.is_conversation_participant(conversation_id)
  );

grant select, insert, update, delete on public.friendships to authenticated;
grant select, insert, update on public.conversations to authenticated;
grant select, insert, update on public.conversation_participants to authenticated;
grant select, insert on public.messages to authenticated;

comment on table public.friendships is 'Friend requests and accepted friendships between users.';
comment on table public.conversations is 'Direct and group message threads.';
comment on table public.messages is 'User messages with optional course/lesson context.';
