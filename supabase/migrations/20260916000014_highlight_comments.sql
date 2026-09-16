-- A reader's own words against a highlight, beside the model's. One column
-- for the same reason note is one: a highlight holds at most one comment, and
-- a comment on its own is a reason to keep the quote highlighted.
alter table public.highlights
  add column comment text check (comment is null or length(comment) between 1 and 20000);
