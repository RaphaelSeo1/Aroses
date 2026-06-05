-- Allow users to leave group chats and admins to remove members.

grant delete on public.conversation_participants to authenticated;

drop policy if exists "Users leave or admins remove participants" on public.conversation_participants;

create policy "Users leave or admins remove participants"
  on public.conversation_participants for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
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
  );
