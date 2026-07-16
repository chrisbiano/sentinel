-- Sentinel — Web Push subscriptions, one row per device.
--
-- When Chris turns on notifications on a device (phone, laptop), the browser
-- hands us a push subscription: an endpoint URL the push service listens on,
-- plus two keys used to encrypt the payload so only that device can read it.
-- We store them here; the push-send function reads them (service role) to
-- deliver reminders.
--
-- The keys here are NOT account secrets — they only authorize sending a push to
-- this one browser, and can't read mail or anything else. Still per-user via
-- RLS, and the browser only ever sees its own row.

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,

  endpoint   text not null,          -- the push service URL for this device
  p256dh     text not null,          -- device public key (payload encryption)
  auth       text not null,          -- device auth secret (payload encryption)
  user_agent text,                   -- so Chris can tell "iPhone" from "MacBook"

  created_at timestamptz default now(),

  -- Same device re-subscribing updates in place rather than duplicating.
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

-- The browser manages its own device rows; the send path uses the service role.
create policy "own push subs" on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
