-- Public, read-only sharing of a conversation.
--
-- A shared conversation carries an opaque token; the link is the credential.
-- RLS stays exactly as it was — owner-only on every table — because anonymous
-- readers never touch the tables. They go through one security-definer
-- function that takes the token and returns the whole canvas as a single
-- payload. That keeps the "shared" predicate in one place (a token match) and
-- leaves no anon-visible policy that could be used to enumerate shared rows.
--
-- user_id is stripped from every node in the payload: a viewer needs the cards
-- and their geometry, never the owner's identity. provider_creds are untouched
-- by all of this and remain unreadable by anyone but their owner.

alter table public.conversations
  add column share_token text unique,
  add column shared_at timestamptz;

create function public.shared_conversation(p_token text)
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
    )
  )
  from public.conversations c
  where c.share_token = p_token;
$$;

-- A null share_token never equals anything, so an unshared conversation is
-- unreachable through this function no matter what is passed.
revoke all on function public.shared_conversation(text) from public;
grant execute on function public.shared_conversation(text) to anon, authenticated;
