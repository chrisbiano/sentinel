-- Sentinel — reusable task templates ("blueprints").
--
-- A template stores the SHAPE of a recurring piece of work — title, duration,
-- subtasks, reminder settings — but never a date or time; those are chosen each
-- time it's used. Saved from the task form; applied as chips when adding a task.
create table if not exists public.task_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  title text not null,
  duration integer not null default 30,
  has_reminder boolean not null default false,
  reminder_lead_min integer not null default 0,
  reminder_repeat_min integer not null default 0,
  subtasks jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.task_templates enable row level security;

drop policy if exists "own templates" on public.task_templates;
create policy "own templates" on public.task_templates
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
