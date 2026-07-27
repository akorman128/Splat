-- Admit 'openrouter' as a third provider.
--
-- Both check constraints were declared inline in the initial schema, so
-- Postgres named them <table>_provider_check. They are dropped and recreated
-- rather than altered — a check constraint has no in-place edit.
--
-- nodes.model is deliberately left unconstrained: OpenRouter is a catalogue
-- provider, so the id stored there is whichever of its ~340 models the user
-- picked, and it is validated against the live catalogue in /api/chat.

alter table public.provider_creds
  drop constraint if exists provider_creds_provider_check;
alter table public.provider_creds
  add constraint provider_creds_provider_check
  check (provider in ('openai', 'anthropic', 'openrouter'));

alter table public.nodes
  drop constraint if exists nodes_provider_check;
alter table public.nodes
  add constraint nodes_provider_check
  check (provider in ('openai', 'anthropic', 'openrouter'));
