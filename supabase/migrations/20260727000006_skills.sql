-- Skills: reusable instruction blocks the composer attaches to a prompt.
--
-- A skill is the user's own text and stays private to them. node_skills records
-- what was actually sent with a card and snapshots the name and instructions as
-- they were at that moment, so a card's provenance survives editing or deleting
-- the skill behind it. skill_id is kept for the live path: regenerating a card
-- picks up the current text while the skill exists, and falls back to the
-- snapshot once it doesn't.

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Case-insensitive per owner: the composer's "/" menu matches on name, and two
-- skills that differ only in case are indistinguishable there.
create unique index skills_user_name_idx on public.skills (user_id, lower(name));

alter table public.skills enable row level security;

create policy "skills_all_own" on public.skills
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create function public.touch_skill()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger skills_touch_updated_at
  before update on public.skills
  for each row execute function public.touch_skill();

-- ---------------------------------------------------------------------------
-- node_skills: which skills went into a card, in the order they were sent.
-- ---------------------------------------------------------------------------
create table public.node_skills (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.nodes (id) on delete cascade,
  skill_id uuid references public.skills (id) on delete set null,
  name text not null,
  instructions text not null,
  position integer not null,
  unique (node_id, position)
);

create index node_skills_node_id_idx on public.node_skills (node_id);
create unique index node_skills_node_skill_idx
  on public.node_skills (node_id, skill_id)
  where skill_id is not null;

alter table public.node_skills enable row level security;

create policy "node_skills_select_own" on public.node_skills
  for select using (
    exists (
      select 1 from public.nodes n
      where n.id = node_skills.node_id and n.user_id = auth.uid()
    )
  );
create policy "node_skills_insert_own" on public.node_skills
  for insert with check (
    exists (
      select 1 from public.nodes n
      where n.id = node_skills.node_id and n.user_id = auth.uid()
    )
    and (
      node_skills.skill_id is null
      or exists (
        select 1 from public.skills s
        where s.id = node_skills.skill_id and s.user_id = auth.uid()
      )
    )
  );
create policy "node_skills_delete_own" on public.node_skills
  for delete using (
    exists (
      select 1 from public.nodes n
      where n.id = node_skills.node_id and n.user_id = auth.uid()
    )
  );
