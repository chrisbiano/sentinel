-- Sentinel — manual ordering for the task list.
--
-- position : the drag-reordered slot of a task in the (untimed) to-do list. Null
--            until a task is first reordered; the app sorts by position with nulls
--            last, falling back to creation order — so new tasks append at the end.
alter table public.tasks add column if not exists position double precision;
