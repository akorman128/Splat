-- Meetings: Granola transcripts imported to be listened back to.
--
-- Granola is reached through its MCP server, which only takes a browser
-- sign-in. encrypted_session is the OAuth client registration and token set,
-- encrypted by the app layer like provider_creds.encrypted_key; it is not a
-- provider_creds row because every reader of that table takes a row to mean a
-- model the composer can send to.

create table public.granola_connections (
  user_id uuid primary key default auth.uid()
    references auth.users (id) on delete cascade,
  encrypted_session text not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.granola_connections enable row level security;

create policy "granola_connections_all_own" on public.granola_connections
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- transcript is the meeting's lines in order, each { speaker, text }, with the
-- speaker already resolved to the label the player shows. It is written once,
-- on import: the speech route turns a section index back into text from it, so
-- the audio a browser cached for an index stays the audio of that passage.
create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  granola_meeting_id text not null,
  title text not null,
  met_at timestamptz not null,
  transcript jsonb not null check (jsonb_typeof(transcript) = 'array'),
  created_at timestamptz not null default now(),
  unique (user_id, granola_meeting_id)
);

create index meetings_user_met_at_idx on public.meetings (user_id, met_at desc);

alter table public.meetings enable row level security;

create policy "meetings_all_own" on public.meetings
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
