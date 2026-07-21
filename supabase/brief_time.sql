-- Sentinel — configurable morning-brief send time.
--
-- brief_time : local wall-clock "HH:MM" the brief should send at (default 7:00 AM).
--              The tick compares it to the user's local time (via their timezone)
--              and fires once in a short window at or just after it.
alter table public.user_prefs add column if not exists brief_time text not null default '07:00';
