-- Highlights: a quote a reader marked inside a card's response, and the model
-- answer they chose to keep against it.
--
-- The quote is anchored the way the W3C annotation model anchors one — the
-- exact text, the characters either side of it, and the offset it sat at — and
-- not as a DOM path or a markdown source range. The response is rendered
-- markdown, so a source offset is not something the browser can point at, and a
-- DOM path breaks on any re-render. Text does not: re-finding a quote inside the
-- rendered plain text costs a string search, survives a react-markdown upgrade,
-- and degrades honestly. A regenerate rewrites nodes.response under a card's
-- existing highlights, and one whose quote is gone from the new answer simply
-- stops matching — it is left in place rather than deleted, because the same
-- card regenerated a second time may well bring the sentence back.
--
-- note is the saved model response, nullable because a highlight is worth
-- keeping on its own: discarding a draft answer, or deleting a saved one, must
-- leave the quote highlighted. That is a column rather than a second table
-- because the relationship is exactly one-to-one — a highlight has at most one
-- kept answer — and a table would have bought a join and a second RLS policy
-- to enforce what a nullable column enforces by construction.
-- ---------------------------------------------------------------------------

-- Which colour new highlights are made in. One setting, not a per-highlight
-- pick: the reader chooses a colour once and every highlight after it lands in
-- that colour, so highlights.color below is a snapshot of what this said at the
-- time rather than a live read.
alter table public.profiles
  add column highlight_color text not null default 'yellow'
    check (highlight_color in ('yellow', 'green', 'blue', 'pink', 'purple'));

create table public.highlights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,
  node_id uuid not null references public.nodes (id) on delete cascade,
  -- The selected text exactly as the DOM held it, newlines and all. Capped
  -- because a quote is a quote: selecting a whole answer and asking about it is
  -- what the prompt box is for.
  quote text not null check (length(quote) between 1 and 2000),
  -- Enough of either side to tell two identical sentences apart. Empty at the
  -- very start or end of a response, which is why neither is null.
  prefix text not null default '',
  suffix text not null default '',
  -- Where the quote started in the rendered plain text when it was made. A hint,
  -- not the anchor: it is checked first because it is O(1) and almost always
  -- still right, and prefix/suffix decide it when it is not.
  text_offset integer not null check (text_offset >= 0),
  color text not null default 'yellow'
    check (color in ('yellow', 'green', 'blue', 'pink', 'purple')),
  note text check (note is null or length(note) <= 20000),
  -- Which model wrote the kept answer, snapshotted: the account's provider key
  -- can be swapped afterwards, and the note should still say where it came from.
  note_model text,
  note_created_at timestamptz,
  -- Set only once a reader has rewritten the answer by hand, so the badge can
  -- say whether it is still the model's words.
  note_edited_at timestamptz,
  created_at timestamptz not null default now(),
  -- Every note column arrives and leaves together with the note itself.
  constraint highlights_note_provenance check (
    (note is null and note_model is null and note_created_at is null
      and note_edited_at is null)
    or (note is not null and note_model is not null
      and note_created_at is not null)
  )
);

create index highlights_node_id_idx on public.highlights (node_id);

alter table public.highlights enable row level security;

-- Owning the row is not enough on write: the card has to be yours too, which is
-- the same rule attachments_insert_own applies for the same reason.
create policy "highlights_select_own" on public.highlights
  for select using (user_id = (select auth.uid()));

create policy "highlights_insert_own" on public.highlights
  for insert with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.nodes n
      where n.id = highlights.node_id and n.user_id = (select auth.uid())
    )
  );

create policy "highlights_update_own" on public.highlights
  for update
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.nodes n
      where n.id = highlights.node_id and n.user_id = (select auth.uid())
    )
  );

create policy "highlights_delete_own" on public.highlights
  for delete using (user_id = (select auth.uid()));

-- A highlight never moves between cards: the quote it anchors is that card's
-- text, and re-pointing the row at another card would keep an anchor that
-- cannot match. Nothing in the app writes node_id after the insert; this is the
-- backstop, matching check_attachment_claim.
create function public.check_highlight_node()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.node_id is distinct from old.node_id then
    raise exception 'a highlight cannot be moved between cards';
  end if;
  return new;
end;
$$;

create trigger highlights_check
  before update on public.highlights
  for each row execute function public.check_highlight_node();
