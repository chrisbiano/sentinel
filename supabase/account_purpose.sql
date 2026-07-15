-- Sentinel — what each mailbox is FOR, in Chris's own words.
--
-- Triage is worthless without this. "Needs a reply" means something different
-- per mailbox: a venue asking about March is critical on the band's address and
-- cold outreach on the business one. Without context, Claude only knows the
-- generic shape of an email and will confidently mis-sort the things that
-- matter most — the band inquiry that looks like a stranger's pitch, the
-- personal note that looks like chatter.
--
-- Free text on purpose. This is fed to a model, not parsed by code, so the
-- right primitive is a sentence, not a dropdown. "Nobody outside my family
-- writes here, so anything from a human is worth reading" is not expressible
-- as an enum, and it is exactly the kind of thing that makes triage correct.

alter table public.connected_accounts
  add column if not exists purpose text;

-- Chris edits these from Settings. Rows are still his own only — the existing
-- select/delete policies already scope to auth.uid(); this adds update.
-- Tokens are untouched by this: they live in account_tokens, which has RLS on
-- and no policies at all, so the browser still can't read them.
drop policy if exists "own accounts - update" on public.connected_accounts;
create policy "own accounts - update" on public.connected_accounts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
