-- The generation moves off the response: the request that starts a run returns
-- while a detached task keeps writing the row. Two runs can now believe they
-- own the same card — a retry raced against a run that is still alive, or a
-- redelivery once a queue is involved — so every write from a run must prove it
-- still holds the card.
--
-- stream_token is that proof: minted when a run claims the card, checked by
-- every write the run makes. A write whose token no longer matches touches
-- zero rows and vanishes harmlessly.
--
-- cancel_requested is how Stop works once no connection ties the user to the
-- run: the client sets the flag, the run polls it and winds down. run_id is
-- reserved for a durable runtime's run identifier; nothing writes it yet.

alter table public.nodes
  add column if not exists stream_token uuid,
  add column if not exists run_id text,
  add column if not exists cancel_requested boolean not null default false;

-- The row is now the only thing a reconnecting client can read progress from,
-- so it has to be able to push. Idempotent: adding a table already in the
-- publication is an error, and this file is pushed by hand.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'nodes'
  ) then
    alter publication supabase_realtime add table public.nodes;
  end if;
end
$$;

-- Refines the trigger from 20260903000011, which could not have known about
-- cancel_requested. updated_at is the evidence a run is still alive, and the
-- stale sweep reads it as such — but a Stop flag is a message *to* a run, not
-- proof one is listening. Left as it was, pressing Stop on a card whose run had
-- already died would stamp the row fresh and push its only recovery out by
-- another full window, again on every press.
create or replace function public.touch_node()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Deliberately not "did the flag change": pressing Stop twice writes true over
  -- true, which changes nothing and must not count as a sign of life either.
  -- What matters is that nothing *else* moved.
  if to_jsonb(new) - 'cancel_requested' - 'updated_at'
     = to_jsonb(old) - 'cancel_requested' - 'updated_at'
  then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
