-- Account-level default for the per-card web search toggle, settable in
-- Settings. True for accounts that predate the column too: on-by-default is
-- the point of the setting, and anyone who minds turns it off once instead of
-- turning search on card by card.

alter table public.profiles
  add column web_search boolean not null default true;
