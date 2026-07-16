-- Sentinel — let Chris correct and flag triaged mail.
--
-- flagged:         a star. Flagged mail floats to the top of its bucket so an
--                  important thread doesn't scroll away.
-- manual_override: set when Chris moves an email to a different bucket by hand,
--                  so we know that bucket is his call, not Claude's — and never
--                  quietly re-sort it out from under him later.

alter table public.email_verdicts
  add column if not exists flagged boolean not null default false,
  add column if not exists manual_override boolean not null default false;
