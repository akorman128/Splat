-- RLS hardening. Three gaps in the initial schema:
--
-- 1. `nodes_all_own` checked only `user_id = auth.uid()`, so a node could be
--    inserted into *another* user's conversation: user_id defaults to
--    auth.uid() (migration 2) and so satisfied the with-check, while the FK to
--    conversations is enforced as table owner and bypasses RLS. The
--    `security definer` touch_conversation trigger then bumped the victim's
--    conversations.updated_at, reordering a sidebar they own.
-- 2. `suggestions` had no delete policy, so /api/suggestions' "replace any
--    prior generation" delete silently matched zero rows and the follow-up
--    insert tripped `unique (node_id, position)` — every regeneration 500'd.
-- 3. touch_conversation is security definer and scoped only by
--    conversation_id; it now also matches on owner as defence in depth.
--
-- Note: this migration adds no data cleanup. If any cross-tenant node rows
-- were created before it was applied they remain, and must be removed
-- deliberately rather than by a blanket delete here.

-- ---------------------------------------------------------------------------
-- 1. nodes: the conversation must belong to the caller, not just the row.
-- ---------------------------------------------------------------------------
drop policy "nodes_all_own" on public.nodes;

create policy "nodes_all_own" on public.nodes
  for all
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = nodes.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 2. suggestions: allow the owner to delete, mirroring the select/insert
--    policies. Without this the regenerate path cannot clear prior rows.
-- ---------------------------------------------------------------------------
create policy "suggestions_delete_own" on public.suggestions
  for delete using (
    exists (
      select 1 from public.nodes n
      where n.id = suggestions.node_id and n.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. touch_conversation: scope the definer-rights update by owner too, so it
--    can never touch a conversation the inserting user does not own.
-- ---------------------------------------------------------------------------
create or replace function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set updated_at = now()
    where id = new.conversation_id
      and user_id = new.user_id;
  return new;
end;
$$;
