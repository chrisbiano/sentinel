-- Sentinel — soft-delete for tasks.
--
-- deleted_at : set when a task is deleted instead of destroying the row. Deleted
--              tasks are hidden everywhere, listed under "Recently deleted" with
--              a Restore for 30 days, then purged for real.
alter table public.tasks add column if not exists deleted_at timestamptz;
