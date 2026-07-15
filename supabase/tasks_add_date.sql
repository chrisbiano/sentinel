-- Sentinel — give tasks a date so the day can be planned ahead.
--
-- Tasks originally stored only a clock time ("09:00 AM"), which made every task
-- implicitly "today". Adding a date column (defaulting to current_date) backfills
-- existing rows to today, so nothing is orphaned.

alter table public.tasks
  add column if not exists date date not null default current_date;

-- Day views filter by (user_id, date).
create index if not exists tasks_user_date_idx on public.tasks (user_id, date);
