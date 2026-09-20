-- Folders: a way to group canvases in the sidebar. Flat on purpose: a folder
-- holds canvases and nothing else, so filing is one column on the conversation
-- rather than a tree to walk.

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now()
);

-- Case-insensitive per owner: the "Move to" menu lists folders by name, and
-- two that differ only in case are indistinguishable there.
create unique index folders_user_name_idx on public.folders (user_id, lower(name));

alter table public.folders enable row level security;

create policy "folders_all_own" on public.folders
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Deleting a folder empties it back to the top level rather than taking the
-- canvases with it.
alter table public.conversations
  add column folder_id uuid references public.folders (id) on delete set null;

create index conversations_folder_id_idx on public.conversations (folder_id);

-- The FK is checked as table owner and bypasses RLS, so without this a canvas
-- could be filed under another user's folder. Same gap, and same fix, as
-- nodes_all_own in the RLS hardening migration.
drop policy "conversations_all_own" on public.conversations;

create policy "conversations_all_own" on public.conversations
  for all
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (
      folder_id is null
      or exists (
        select 1 from public.folders f
        where f.id = conversations.folder_id
          and f.user_id = (select auth.uid())
      )
    )
  );
