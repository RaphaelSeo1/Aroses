-- Creators must read a conversation they just created (INSERT … RETURNING) and
-- the participant-insert policy checks conversations.created_by = auth.uid().

drop policy if exists "Participants read conversations" on public.conversations;

create policy "Participants read conversations"
  on public.conversations for select to authenticated
  using (
    public.is_conversation_participant(id)
    or created_by = auth.uid()
  );
