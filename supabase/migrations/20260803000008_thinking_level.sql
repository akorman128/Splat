-- Per-card thinking level, so a retry or a regenerate replays the card as it
-- was sent rather than at whatever the provider defaults to today.
--
-- Nullable, and null is the common case: it means the card was sent without
-- asking for a level at all. Every card written before this column existed is
-- that, and so is every card sent to a model that answers the parameter with a
-- 400 — the picker lists whatever the key can reach, which includes models with
-- no reasoning stage.
--
-- The levels are the app's own vocabulary, mapped per provider at send time
-- (anthropic: thinking + output_config.effort, openai/openrouter: reasoning.effort).

alter table public.nodes
  add column thinking_level text
  check (thinking_level in ('off', 'low', 'medium', 'high', 'max'));
