-- Sentinel — subtasks attached to Google Calendar events.
--
-- Calendar access is read-only by design, so we never write back to Google.
-- These are Sentinel's own annotations, keyed to the event id we build in the
-- calendar-events function ("<account>:<calendar>:<googleEventId>"). For
-- recurring events, singleEvents expansion gives each instance its own id, so
-- checklists attach per-occurrence — prep for *today's* block, not all of them.

create table if not exists public.event_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  event_id   text not null,
  subtasks   jsonb not null default '[]'::jsonb,  -- [{ id, title, done }]
  updated_at timestamptz default now(),
  unique (user_id, event_id)
);

alter table public.event_notes enable row level security;

create policy "own event notes" on public.event_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
