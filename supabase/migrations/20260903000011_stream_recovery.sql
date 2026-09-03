-- A card is marked streaming by the request that will fill it, and cleared by
-- that same request when it finishes. A run that dies without finishing — killed
-- at the function's ceiling, evicted, or crashed — leaves the row streaming for
-- good: the canvas spins, the retry button never appears (it needs `error`), and
-- /api/chat refuses a rerun because the card "is already streaming".
--
-- updated_at is what makes an abandoned run recognisable. The streaming write
-- path touches the row every couple of seconds, so one still streaming long
-- after its last write belongs to a request that cannot still be running.

alter table public.nodes
  add column if not exists updated_at timestamptz not null default now();

create or replace function public.touch_node()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists nodes_touch_updated_at on public.nodes;
create trigger nodes_touch_updated_at
  before update on public.nodes
  for each row execute function public.touch_node();

-- The rows already wedged by this. created_at is the only clock they carry, and
-- the cutoff keeps a card that happens to be streaming as this runs out of it.
update public.nodes
set status = 'error',
    error_message = 'Generation stopped before it finished. Retry to run it again.'
where status = 'streaming'
  and created_at < now() - interval '10 minutes';
