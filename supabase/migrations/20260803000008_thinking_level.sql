-- Per-card thinking level, so a retry or a regenerate replays the card as it
-- was sent. Null means no level was asked for and none was sent, which is every
-- card older than this column and every card sent to a model that cannot reason.
-- The levels are the app's own vocabulary, mapped per provider at send time.

alter table public.nodes
  add column thinking_level text
  check (thinking_level in ('off', 'low', 'medium', 'high', 'max'));
