-- Sentinel — remember that a "reply later" task was already made for an email,
-- so the "+ Task" button greys out and can't spawn duplicates (even after a
-- reload or the next day).

alter table public.email_verdicts
  add column if not exists task_created boolean not null default false;
