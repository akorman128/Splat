-- Graph-native AI chat canvas: initial schema.
-- Supabase is the source of truth for graph semantics; tldraw only owns geometry
-- (persisted back onto nodes.canvas_*).

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (id = auth.uid());
create policy "profiles_insert_own" on public.profiles
  for insert with check (id = auth.uid());
create policy "profiles_update_own" on public.profiles
  for update using (id = auth.uid());

-- Auto-create a profile row on signup.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- provider_creds: BYOK API keys, encrypted at rest by the app layer
-- (AES-256-GCM; the encryption key never leaves server env). RLS keeps rows
-- private to their owner; the ciphertext is useless without the server key.
-- ---------------------------------------------------------------------------
create table public.provider_creds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openai', 'anthropic')),
  encrypted_key text not null,
  key_last4 text not null,
  label text,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.provider_creds enable row level security;

create policy "provider_creds_all_own" on public.provider_creds
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.conversations enable row level security;

create policy "conversations_all_own" on public.conversations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- nodes: one prompt/response card. parent_id is the structural spine;
-- context_edges (below) records the semantic input set. They are not the same.
-- ---------------------------------------------------------------------------
create table public.nodes (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  parent_id uuid references public.nodes (id) on delete cascade,
  title text,
  prompt text not null,
  response text not null default '',
  provider text not null check (provider in ('openai', 'anthropic')),
  model text not null,
  status text not null default 'pending'
    check (status in ('pending', 'streaming', 'complete', 'error')),
  error_message text,
  prompt_tokens integer,
  completion_tokens integer,
  canvas_x double precision not null default 0,
  canvas_y double precision not null default 0,
  canvas_w double precision not null default 380,
  canvas_h double precision not null default 340,
  created_at timestamptz not null default now()
);

create index nodes_conversation_id_idx on public.nodes (conversation_id);
create index nodes_parent_id_idx on public.nodes (parent_id);

alter table public.nodes enable row level security;

create policy "nodes_all_own" on public.nodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Parent must live in the same conversation. Inserts cannot create parent
-- cycles (a fresh id has no descendants) and parent_id is never re-written by
-- the app, but guard updates anyway.
create function public.check_node_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_conversation uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  if new.parent_id = new.id then
    raise exception 'node cannot be its own parent';
  end if;
  select conversation_id into parent_conversation
    from public.nodes where id = new.parent_id;
  if parent_conversation is null then
    raise exception 'parent node not found';
  end if;
  if parent_conversation <> new.conversation_id then
    raise exception 'parent node belongs to a different conversation';
  end if;
  if exists (
    with recursive anc(id) as (
      select new.parent_id
      union
      select n.parent_id from public.nodes n join anc on n.id = anc.id
        where n.parent_id is not null
    )
    select 1 from anc where id = new.id
  ) then
    raise exception 'parent assignment would create a cycle';
  end if;
  return new;
end;
$$;

create trigger nodes_check_parent
  before insert or update of parent_id on public.nodes
  for each row execute function public.check_node_parent();

-- Touch the conversation whenever a node is added, so the sidebar can sort by
-- recent activity.
create function public.touch_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations set updated_at = now()
    where id = new.conversation_id;
  return new;
end;
$$;

create trigger nodes_touch_conversation
  after insert on public.nodes
  for each row execute function public.touch_conversation();

-- ---------------------------------------------------------------------------
-- context_edges: the explicit record of which ancestor cards were sent as
-- context for a node, in topological order. Written once at node creation.
-- ---------------------------------------------------------------------------
create table public.context_edges (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  source_node_id uuid not null references public.nodes (id) on delete cascade,
  position integer not null,
  check (node_id <> source_node_id),
  unique (node_id, source_node_id)
);

create index context_edges_node_id_idx on public.context_edges (node_id);
create index context_edges_source_node_id_idx on public.context_edges (source_node_id);

alter table public.context_edges enable row level security;

create policy "context_edges_select_own" on public.context_edges
  for select using (
    exists (
      select 1 from public.nodes n
      where n.id = context_edges.node_id and n.user_id = auth.uid()
    )
  );
create policy "context_edges_insert_own" on public.context_edges
  for insert with check (
    exists (
      select 1 from public.nodes n
      where n.id = context_edges.node_id and n.user_id = auth.uid()
    )
    and exists (
      select 1 from public.nodes s
      where s.id = context_edges.source_node_id and s.user_id = auth.uid()
    )
  );

-- DB-level acyclicity backstop. The API layer already restricts context
-- sources to ancestors of the new node (acyclic by construction); this trigger
-- guards against any other write path. Walks the union graph of parent edges
-- and context edges upward from the proposed source; if the consumer is
-- reachable, the edge would close a cycle.
create function public.check_context_edge()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  node_conversation uuid;
  source_conversation uuid;
begin
  select conversation_id into node_conversation
    from public.nodes where id = new.node_id;
  select conversation_id into source_conversation
    from public.nodes where id = new.source_node_id;
  if node_conversation is null or source_conversation is null then
    raise exception 'context edge references a missing node';
  end if;
  if node_conversation <> source_conversation then
    raise exception 'context edge crosses conversations';
  end if;
  if exists (
    with recursive anc(id) as (
      select new.source_node_id
      union
      select e.src from (
        select n.id as dst, n.parent_id as src
          from public.nodes n where n.parent_id is not null
        union all
        select ce.node_id as dst, ce.source_node_id as src
          from public.context_edges ce
      ) e
      join anc on e.dst = anc.id
    )
    select 1 from anc where id = new.node_id
  ) then
    raise exception 'context edge would create a cycle';
  end if;
  return new;
end;
$$;

create trigger context_edges_check
  before insert or update on public.context_edges
  for each row execute function public.check_context_edge();

-- ---------------------------------------------------------------------------
-- suggestions: exactly three follow-ups per node, generated by the utility
-- model after the response completes. taken_at marks the one that was clicked.
-- ---------------------------------------------------------------------------
create table public.suggestions (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  text text not null,
  position integer not null check (position between 0 and 2),
  taken_at timestamptz,
  unique (node_id, position)
);

create index suggestions_node_id_idx on public.suggestions (node_id);

alter table public.suggestions enable row level security;

create policy "suggestions_select_own" on public.suggestions
  for select using (
    exists (
      select 1 from public.nodes n
      where n.id = suggestions.node_id and n.user_id = auth.uid()
    )
  );
create policy "suggestions_insert_own" on public.suggestions
  for insert with check (
    exists (
      select 1 from public.nodes n
      where n.id = suggestions.node_id and n.user_id = auth.uid()
    )
  );
create policy "suggestions_update_own" on public.suggestions
  for update using (
    exists (
      select 1 from public.nodes n
      where n.id = suggestions.node_id and n.user_id = auth.uid()
    )
  );
