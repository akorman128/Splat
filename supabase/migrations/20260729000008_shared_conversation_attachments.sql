-- Attachments in the shared payload.
--
-- The canvas has drawn a card's files as pills since 20260727000007, and the
-- shared view reads them straight into the same store — but the RPC never
-- built the key, so the payload arrived without it and every shared canvas
-- came back with no pills on any card. Nothing errored: a missing key is
-- undefined, and undefined is an empty list.
--
-- Name-only, deliberately, which is what the payload already gives up
-- everywhere else. storage_path is dropped because the object policies are
-- `to authenticated` and a link-holder is not — the path would be a pointer
-- to bytes it cannot fetch. extracted_text is dropped because it is the
-- contents of the file, which is a great deal more than sharing a canvas was
-- ever meant to hand over. What is left is what a pill draws: a name, a kind,
-- a size, and whether the text came out.
--
-- The join to nodes does the scoping and the filtering at once: an attachment
-- with a null node_id is a draft in somebody's composer, and it has no card
-- to be a pill on.

create or replace function public.shared_conversation(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'conversation', jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'created_at', c.created_at,
      'updated_at', c.updated_at,
      'shared_at', c.shared_at
    ),
    'nodes', coalesce(
      (
        select jsonb_agg(to_jsonb(n) - 'user_id' order by n.created_at)
        from public.nodes n
        where n.conversation_id = c.id
      ),
      '[]'::jsonb
    ),
    'edges', coalesce(
      (
        select jsonb_agg(to_jsonb(e))
        from public.context_edges e
        join public.nodes n on n.id = e.node_id
        where n.conversation_id = c.id
      ),
      '[]'::jsonb
    ),
    'suggestions', coalesce(
      (
        select jsonb_agg(to_jsonb(s))
        from public.suggestions s
        join public.nodes n on n.id = s.node_id
        where n.conversation_id = c.id
      ),
      '[]'::jsonb
    ),
    'attachments', coalesce(
      (
        select jsonb_agg(
          to_jsonb(a) - 'user_id' - 'storage_path' - 'extracted_text'
          order by a.created_at
        )
        from public.attachments a
        join public.nodes n on n.id = a.node_id
        where n.conversation_id = c.id
      ),
      '[]'::jsonb
    )
  )
  from public.conversations c
  where c.share_token = p_token;
$$;

-- Replacing a function keeps its ACL, but the grants are restated so this file
-- describes the whole of what it leaves behind.
revoke all on function public.shared_conversation(text) from public;
grant execute on function public.shared_conversation(text) to anon, authenticated;
