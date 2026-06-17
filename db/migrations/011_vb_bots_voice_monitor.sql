-- Migration 011: Voice Monitor handoff tracking on bots
--
-- Voice Monitor is a separate product the agency provides to its clients
-- so they can review every call and refine the AI receptionist over time.
-- It is positioned as a free, included white-glove service — the SMB
-- doesn't sign up for it directly; the agency reaches out and grants
-- access after the client goes live.
--
-- This migration adds three columns to vb.bots so we can:
--   1. Track whether the handoff is pending / in_progress / complete.
--   2. Record when the agency completed the handoff (timestamp).
--   3. Dedupe the one-time "client went live" agency notification email.
--
-- Existing live bots predate this feature, so they're back-filled to
-- 'complete' on first run — they shouldn't generate retroactive
-- "Action needed" badges in the agency dashboard. The back-fill is gated
-- so a re-run of the migration after newly activated bots exist won't
-- stomp on their 'pending' status.
--
-- Idempotent — re-running is safe.

alter table vb.bots
  add column if not exists voice_monitor_handoff_status text not null default 'pending'
    check (voice_monitor_handoff_status in ('pending', 'in_progress', 'complete')),
  add column if not exists voice_monitor_handoff_completed_at timestamptz,
  add column if not exists voice_monitor_handoff_notified_at  timestamptz;

create index if not exists vb_bots_voice_monitor_pending_idx
  on vb.bots (agency_id)
  where status = 'live' and voice_monitor_handoff_status = 'pending';

-- One-time back-fill: only runs when no bot has a non-null
-- voice_monitor_handoff_completed_at, i.e. before this feature has ever
-- written real data. Once any real activity exists the DO block no-ops.
do $$
begin
  if not exists (
    select 1 from vb.bots where voice_monitor_handoff_completed_at is not null
  ) then
    update vb.bots
       set voice_monitor_handoff_status = 'complete',
           voice_monitor_handoff_completed_at = updated_at
     where status = 'live'
       and voice_monitor_handoff_status = 'pending';
  end if;
end $$;
