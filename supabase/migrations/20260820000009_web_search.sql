-- Per-card web search, so a retry or a regenerate replays the card as it was
-- sent. False rather than null for every card older than this column: they were
-- sent without it, which is the same thing as having it turned off.

alter table public.nodes
  add column web_search boolean not null default false;
