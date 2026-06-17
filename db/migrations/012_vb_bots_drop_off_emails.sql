-- Migration 012: drop-off recovery email tracking on bots
--
-- The wizard auto-saves drafts as soon as the user touches anything, so
-- "abandoned" drafts pile up in vb.bots with status='draft'. This
-- migration adds three timestamp columns so a daily cron can send a
-- recovery email at the 24h / 72h / 7d marks once and only once per
-- draft.
--
-- We don't gate by the email having actually delivered — Resend / GHL
-- bounces are tracked at the provider end. The point of these columns
-- is to make the cron query trivial and the dedupe guarantee airtight.
--
-- Existing drafts at migration time are not back-filled. They will start
-- receiving recovery emails on the first cron run after their age crosses
-- each threshold, which is the intended behaviour — old abandoned drafts
-- are exactly who this feature is for.
--
-- Idempotent — re-running is safe.

alter table vb.bots
  add column if not exists drop_off_email_24h_sent_at timestamptz,
  add column if not exists drop_off_email_72h_sent_at timestamptz,
  add column if not exists drop_off_email_7d_sent_at  timestamptz;

-- Partial indexes scoped to (status='draft', email NULL) so the cron's
-- per-interval "who needs the X-hour email" query is a cheap index scan
-- even when the table has thousands of historical drafts.
create index if not exists vb_bots_drop_off_24h_idx
  on vb.bots (created_at)
  where status = 'draft' and drop_off_email_24h_sent_at is null;

create index if not exists vb_bots_drop_off_72h_idx
  on vb.bots (created_at)
  where status = 'draft' and drop_off_email_72h_sent_at is null;

create index if not exists vb_bots_drop_off_7d_idx
  on vb.bots (created_at)
  where status = 'draft' and drop_off_email_7d_sent_at is null;
