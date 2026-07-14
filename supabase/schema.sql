-- Sentinel — database schema
-- Run this in the Supabase dashboard (SQL Editor) after creating the project.
-- Row-level security ensures each signed-in user only sees their own tasks.

create table if not exists public.tasks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  time        text,                       -- e.g. "09:00 AM"
  duration    integer default 30,         -- minutes
  has_reminder boolean default false,
  is_urgent   boolean default false,
  completed   boolean default false,
  subtasks    jsonb default '[]'::jsonb,  -- [{ id, title, done }]
  created_at  timestamptz default now()
);

alter table public.tasks enable row level security;

-- Each user can only read/write their own rows.
create policy "own tasks - select" on public.tasks
  for select using (auth.uid() = user_id);
create policy "own tasks - insert" on public.tasks
  for insert with check (auth.uid() = user_id);
create policy "own tasks - update" on public.tasks
  for update using (auth.uid() = user_id);
create policy "own tasks - delete" on public.tasks
  for delete using (auth.uid() = user_id);
