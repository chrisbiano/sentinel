-- Sentinel — Claude's triage verdict for a single email, cached.
--
-- Classifying costs money and takes a second, so we only ever ask Claude about
-- mail it hasn't seen. One row per Gmail message id; a page load reads these
-- and only sends the leftovers to the model.
--
-- `action` is what Chris would DO with the message, which is the whole point:
--   reply       — a specific person is blocked on a response from him
--   read        — real information, nothing to do about it
--   unsubscribe — recurring bulk mail he doesn't engage with
--   junk        — noise, safe to trash
--
-- Nothing here acts on its own. This table is Claude's opinion; the actions in
-- gmail-action only ever run because Chris clicked something.

create table if not exists public.email_verdicts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,

  -- Gmail's own ids. account_email tells us which mailbox to act against later,
  -- since the same person has six of them.
  message_id    text not null,
  thread_id     text,
  account_email text not null,

  -- Enough of the message to render the list without re-fetching Gmail.
  sender        text,
  sender_email  text,
  subject       text,
  snippet       text,
  received_at   timestamptz,

  -- Claude's call, plus its one-line reasoning. `reason` is shown in the UI on
  -- purpose: a verdict you can't interrogate is a verdict you can't trust.
  action        text not null check (action in ('reply', 'read', 'unsubscribe', 'junk')),
  reason        text,
  model         text,             -- which model judged it, so a prompt/model change is traceable

  -- The RFC 8058 one-click endpoint, when the sender offers one. Null means
  -- we fall back to opening their unsubscribe page in a tab.
  unsubscribe_url text,

  -- Set once Chris acts, so a handled message doesn't reappear in the list.
  handled_at    timestamptz,
  classified_at timestamptz default now(),

  -- Scoped to the mailbox, not just the user: Gmail message ids are unique
  -- *per mailbox*, not globally. With six accounts, keying on message_id alone
  -- would let two mailboxes collide and silently overwrite each other's mail.
  unique (user_id, account_email, message_id)
);

alter table public.email_verdicts enable row level security;

create policy "own email verdicts" on public.email_verdicts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The list view is always "my unhandled mail, newest first".
create index if not exists email_verdicts_inbox_idx
  on public.email_verdicts (user_id, handled_at, received_at desc);
