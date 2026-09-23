-- A shared canvas carries the owner's highlights, with the answers and
-- comments kept against them, so a viewer reads it the way it was annotated.
-- user_id is stripped as it is from nodes; nothing a viewer needs is in it.
--
-- Replaces the definition from 20260727000007 verbatim apart from the new key.
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
    ),
    'highlights', coalesce(
      (
        select jsonb_agg(to_jsonb(h) - 'user_id' order by h.created_at)
        from public.highlights h
        join public.nodes n on n.id = h.node_id
        where n.conversation_id = c.id
      ),
      '[]'::jsonb
    )
  )
  from public.conversations c
  where c.share_token = p_token;
$$;
