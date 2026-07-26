-- Default owner columns to the authenticated user so inserts through
-- PostgREST/route handlers don't have to repeat auth.uid() and can never
-- claim another user's id (RLS with-check still enforces the match).
alter table public.conversations alter column user_id set default auth.uid();
alter table public.nodes alter column user_id set default auth.uid();
alter table public.provider_creds alter column user_id set default auth.uid();
