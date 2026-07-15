-- Sentinel — connected accounts (Gmail/Calendar data sources)
-- Run in Supabase SQL Editor. Separate from schema.sql (tasks).
--
-- Design: the browser can read mailbox METADATA (email, status) but NEVER the
-- OAuth tokens. Tokens live in account_tokens, which has RLS enabled and NO
-- policies — so anon/authenticated clients are fully denied; only Edge Functions
-- using the service role (which bypasses RLS) can read/write them.

-- Connected mailboxes — metadata the app is allowed to read.
create table if not exists public.connected_accounts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  provider   text not null default 'google',
  email      text not null,
  status     text not null default 'connected',   -- connected | error | revoked
  created_at timestamptz default now(),
  unique (user_id, email)
);

alter table public.connected_accounts enable row level security;

create policy "own accounts - select" on public.connected_accounts
  for select using (auth.uid() = user_id);
create policy "own accounts - delete" on public.connected_accounts
  for delete using (auth.uid() = user_id);
-- insert/update happen server-side via Edge Functions (service role).

-- OAuth tokens — never exposed to the browser.
create table if not exists public.account_tokens (
  account_id    uuid primary key references public.connected_accounts(id) on delete cascade,
  refresh_token text not null,
  access_token  text,
  expires_at    timestamptz,
  updated_at    timestamptz default now()
);

-- RLS on, no policies => locked to service role only (Edge Functions).
alter table public.account_tokens enable row level security;
