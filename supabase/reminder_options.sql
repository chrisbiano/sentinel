-- Sentinel — reminder lead time + repeat.
--
-- reminder_lead_min : fire this many minutes BEFORE the task's time (0 = at time).
--                     Baked into remind_at client-side, so the tick is unchanged
--                     for the first ping.
-- reminder_repeat_min : re-buzz every N minutes until the task is done (0 = once).
--                     The tick reads this to decide when to fire again.
alter table public.tasks add column if not exists reminder_lead_min   integer not null default 0;
alter table public.tasks add column if not exists reminder_repeat_min integer not null default 0;

-- The tick now scans reminders regardless of fired-state (repeats fire again after
-- reminder_fired_at), so index the reminder rows in a due window broadly.
create index if not exists tasks_remind_scan_idx
  on public.tasks (remind_at)
  where has_reminder and remind_at is not null and not completed;
