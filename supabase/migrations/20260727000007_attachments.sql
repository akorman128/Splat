-- Attachments: files the composer sends alongside a prompt.
--
-- Bytes live in a private Storage bucket; this schema owns the metadata and the
-- text extracted from the file at upload time. Extraction happens once, on
-- upload, because the context picker has to price a file in tokens before the
-- prompt is ever sent — a number that cannot exist until the text does.
--
-- attachments.node_id is the owning card: what a card displays, and what the
-- delete cascade follows. node_attachments is the per-turn record: what a
-- request actually sent. The split is the same one nodes/context_edges makes,
-- for the same reason — a descendant may replay an ancestor's file without
-- replaying the ancestor's card, so the relationship is many-to-many and
-- ordered. node_id is nullable because the file is uploaded while the user is
-- still typing: an attachment with node_id null is a draft, claimed by
-- /api/chat when the card it was typed against is created.
--
-- Unlike node_skills, which snapshots a skill's instructions so a card outlives
-- the skill behind it, node_attachments only snapshots display metadata. A
-- skill's instructions are a short text blob; an attachment's extracted text
-- runs to hundreds of thousands of characters and its bytes sit in object
-- storage, so copying the payload per card would duplicate megabytes and still
-- leave nothing to re-send. Instead a sent attachment is immutable: it can be
-- removed while it is a draft and never afterwards, so it lives exactly as long
-- as its owning card. The per-turn rows outlive it: they keep their snapshot
-- with a null attachment_id, so a descendant still reports what it sent.

-- ---------------------------------------------------------------------------
-- Storage bucket. Private. The first path segment is the owner's uid, which is
-- what makes the object policies below a pure prefix match.
-- Path convention: <user_id>/<conversation_id>/<attachment_id><ext>
--
-- Text-ish files, including source code, are always uploaded as text/plain.
-- The MIME database maps .ts to video/mp2t, so a browser reports a TypeScript
-- file as video; the route classifies by extension first and normalises, and
-- this list has no video types in it precisely so that mismatch cannot slip
-- through.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attachments', 'attachments', false, 26214400,
  array[
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "attachments_objects_select_own" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments_objects_insert_own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "attachments_objects_delete_own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'attachments'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- attachments
-- ---------------------------------------------------------------------------
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  conversation_id uuid not null
    references public.conversations (id) on delete cascade,
  node_id uuid references public.nodes (id) on delete cascade,
  storage_path text not null unique,
  filename text not null,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0),
  kind text not null
    check (kind in ('image', 'pdf', 'document', 'spreadsheet', 'text')),
  image_width integer,
  image_height integer,
  -- 'empty' is a parse that succeeded and found nothing — a scanned PDF with no
  -- text layer. It is worth distinguishing from 'failed' so the composer can say
  -- the model won't see the contents rather than implying the upload broke.
  extract_status text not null default 'pending'
    check (extract_status in ('pending', 'ok', 'empty', 'failed', 'skipped')),
  extract_error text,
  extracted_text text,
  truncated boolean not null default false,
  -- Precomputed so the context picker can price a file without loading its text.
  est_tokens integer not null default 0,
  created_at timestamptz not null default now()
);

create index attachments_node_id_idx on public.attachments (node_id);
create index attachments_conversation_id_idx
  on public.attachments (conversation_id);
-- Drives the sweep that reclaims composers abandoned before send.
create index attachments_drafts_idx
  on public.attachments (created_at) where node_id is null;

alter table public.attachments enable row level security;

-- Mirrors the hardened nodes policy from 20260726000003: owning the row is not
-- enough on insert, the conversation has to be yours as well. Split per command
-- rather than `for all` because delete is the one that needs a narrower rule.
create policy "attachments_select_own" on public.attachments
  for select using (user_id = (select auth.uid()));

create policy "attachments_insert_own" on public.attachments
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = attachments.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create policy "attachments_update_own" on public.attachments
  for update
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.conversations c
      where c.id = attachments.conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- The immutability the header promises, enforced rather than assumed: a claimed
-- row is not deletable at all, so losing a card's provenance takes deleting the
-- card. Cascades from nodes and conversations do not consult RLS, so the owning
-- card still takes its attachments with it.
create policy "attachments_delete_own" on public.attachments
  for delete using (user_id = (select auth.uid()) and node_id is null);

-- A draft is claimed exactly once and never moves between cards, and the card
-- claiming it has to live in the attachment's own conversation.
create function public.check_attachment_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  node_conversation uuid;
begin
  if tg_op = 'UPDATE'
     and old.node_id is not null
     and new.node_id is distinct from old.node_id then
    raise exception 'an attachment cannot be moved between cards';
  end if;

  if new.node_id is not null then
    select conversation_id into node_conversation
      from public.nodes where id = new.node_id;
    if node_conversation is null then
      raise exception 'attachment references a missing node';
    end if;
    if node_conversation <> new.conversation_id then
      raise exception 'attachment card belongs to a different conversation';
    end if;
  end if;

  return new;
end;
$$;

create trigger attachments_check
  before insert or update on public.attachments
  for each row execute function public.check_attachment_claim();

-- ---------------------------------------------------------------------------
-- node_attachments: which files a turn actually sent, in order. The same
-- attachment appears here once for its owning card and once more for every
-- descendant that re-checked it in the context picker.
--
-- filename/mime_type/kind are snapshotted for the same reason node_skills
-- snapshots a skill's name: a card should be able to say what it sent without
-- a join that may no longer resolve. The payload deliberately is not — see the
-- header comment.
-- ---------------------------------------------------------------------------
create table public.node_attachments (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  -- set null, not cascade: deleting the owning card must not reach sideways and
  -- delete a surviving descendant's record of having sent the file. The row
  -- keeps its snapshot and loses only the ability to re-send.
  attachment_id uuid
    references public.attachments (id) on delete set null,
  filename text not null,
  mime_type text not null,
  kind text not null,
  position integer not null,
  unique (node_id, position),
  unique (node_id, attachment_id)
);

create index node_attachments_node_id_idx on public.node_attachments (node_id);
create index node_attachments_attachment_id_idx
  on public.node_attachments (attachment_id);

alter table public.node_attachments enable row level security;

create policy "node_attachments_select_own" on public.node_attachments
  for select using (
    exists (
      select 1 from public.nodes n
      where n.id = node_attachments.node_id and n.user_id = auth.uid()
    )
  );

create policy "node_attachments_insert_own" on public.node_attachments
  for insert with check (
    exists (
      select 1 from public.nodes n
      where n.id = node_attachments.node_id and n.user_id = auth.uid()
    )
    and exists (
      select 1 from public.attachments a
      where a.id = node_attachments.attachment_id and a.user_id = auth.uid()
    )
  );

create policy "node_attachments_delete_own" on public.node_attachments
  for delete using (
    exists (
      select 1 from public.nodes n
      where n.id = node_attachments.node_id and n.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Every card reachable by walking up from p_node, over the union of parent
-- edges and context edges, including p_node itself.
--
-- Both trigger functions below need this walk and had a copy each, so a new
-- edge type would have had to be added to both or the two invariants would
-- silently diverge. Bounded by conversation, which the callers already know:
-- the inline copies joined all of nodes to all of context_edges on every
-- recursion step, re-materialising the caller's whole graph across every
-- conversation they own, per level, per row inserted.
-- ---------------------------------------------------------------------------
create function public.node_ancestors(p_node uuid, p_conversation uuid)
returns setof uuid
language sql
stable
set search_path = ''
as $$
  with recursive anc(id) as (
    select p_node
    union
    select e.src from (
      select n.id as dst, n.parent_id as src
        from public.nodes n
        where n.conversation_id = p_conversation and n.parent_id is not null
      union all
      select ce.node_id as dst, ce.source_node_id as src
        from public.context_edges ce
        join public.nodes n on n.id = ce.node_id
        where n.conversation_id = p_conversation
    ) e
    join anc on e.dst = anc.id
  )
  select id from anc;
$$;

-- Replaces the definition from 20260725000001 to call the shared walk. The
-- rejection is unchanged: walk up from the source, and if the consumer is
-- reachable the edge would close a cycle.
create or replace function public.check_context_edge()
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
    select 1
      from public.node_ancestors(new.source_node_id, source_conversation) a(id)
      where a.id = new.node_id
  ) then
    raise exception 'context edge would create a cycle';
  end if;
  return new;
end;
$$;

-- The mirror image of check_context_edge. That one walks up from the source and
-- rejects when the consumer is reachable, because that would be a cycle. This
-- one walks up from the consumer and rejects when the owning card is not
-- reachable: you may replay a file owned by yourself or by an ancestor, over the
-- same union of parent edges and context edges, and nothing else. No node-to-node
-- edge is created here, so the acyclicity invariant that trigger protects is
-- untouched.
create function public.check_node_attachment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  node_conversation uuid;
  attachment_conversation uuid;
  owner_node uuid;
begin
  -- The owning attachment going away nulls this column, which is an update and
  -- so arrives here. There is nothing left to check.
  if new.attachment_id is null then
    return new;
  end if;

  select conversation_id into node_conversation
    from public.nodes where id = new.node_id;
  select conversation_id, node_id into attachment_conversation, owner_node
    from public.attachments where id = new.attachment_id;

  if node_conversation is null or attachment_conversation is null then
    raise exception 'node attachment references a missing row';
  end if;
  if node_conversation <> attachment_conversation then
    raise exception 'node attachment crosses conversations';
  end if;

  -- An unclaimed draft has no owner to walk up from. Returning early here would
  -- let the two writes be inverted — record the send first, claim the draft for
  -- an unrelated card second — and the walk below would never run for either.
  -- /api/chat claims before it records, so only that inversion is rejected.
  if owner_node is null then
    raise exception 'node attachment references an unclaimed attachment';
  end if;

  -- A card sending its own freshly claimed upload needs no ancestor walk.
  if owner_node = new.node_id then
    return new;
  end if;

  if not exists (
    select 1
      from public.node_ancestors(new.node_id, node_conversation) a(id)
      where a.id = owner_node
  ) then
    raise exception 'attachment is not owned by this card or one of its ancestors';
  end if;

  return new;
end;
$$;

create trigger node_attachments_check
  before insert or update on public.node_attachments
  for each row execute function public.check_node_attachment();

-- ---------------------------------------------------------------------------
-- Shared canvases. A card whose prompt says "summarise this" reads as nonsense
-- if the file it came with is invisible, so the share payload carries the
-- display metadata of every claimed attachment — and nothing else. storage_path
-- and extracted_text stay behind, and the object policies above are
-- `to authenticated`, so an anonymous viewer could not mint a signed URL even
-- holding a path. Shared attachments are name-only pills by construction.
--
-- Replaces the definition from 20260727000005 verbatim apart from the new key.
-- ---------------------------------------------------------------------------
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
