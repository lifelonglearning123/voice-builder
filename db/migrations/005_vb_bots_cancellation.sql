-- Track "cancel at period end" so the SMB dashboard can show pending
-- cancellations honestly. The teardown logic (deleting Retell agents on
-- subscription end) already triggers correctly off subscription.deleted /
-- status=canceled, so this migration is purely additive for visibility.
--
-- Idempotent — re-running is safe.

alter table vb.bots
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists current_period_end   timestamptz;
