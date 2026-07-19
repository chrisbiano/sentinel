-- Sentinel — scheduling for task reminders + the morning brief.
--
-- Both are delivered by the scheduler-tick Edge Function, which Supabase Cron
-- pings every minute. This migration adds the columns/table it reads.

-- 1. Task reminders.
--    remind_at is the absolute UTC instant the reminder should fire. It's computed
--    on the client from the task's LOCAL date+time (so the tick needs no timezone
--    math — it just fires anything whose remind_at has passed). reminder_fired_at
--    guards against firing the same reminder every minute.
alter table public.tasks add column if not exists remind_at         timestamptz;
alter table public.tasks add column if not exists reminder_fired_at timestamptz;

-- Fast "what's due right now?" scan for the tick.
create index if not exists tasks_remind_due_idx
  on public.tasks (remind_at)
  where has_reminder and remind_at is not null and reminder_fired_at is null and not completed;

-- 2. Per-user scheduling prefs.
--    timezone lets the morning brief land at 7am THEIR time; last_brief_on guards
--    against sending it twice in a day.
create table if not exists public.user_prefs (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  timezone      text,                          -- IANA, e.g. 'America/Chicago'
  morning_brief boolean not null default true,
  last_brief_on date,                          -- local date the brief last sent
  updated_at    timestamptz default now()
);

alter table public.user_prefs enable row level security;

-- The browser reads/writes its own prefs; the scheduler uses the service role.
create policy "own prefs" on public.user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
