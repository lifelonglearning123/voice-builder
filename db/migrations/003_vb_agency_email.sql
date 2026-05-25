-- Voice Builder schema — M2 follow-up: per-agency email branding
--
-- We're bypassing Supabase Auth's built-in email sender (it's project-wide,
-- can only have one From). Instead we generate magic-link URLs via the
-- admin API and send the emails ourselves via Resend, using each agency's
-- branded sender. This migration adds the per-agency email fields.
--
-- Idempotent — re-running is safe.

alter table vb.agencies
  add column if not exists from_email text,
  add column if not exists from_name  text;

-- Seed Macaws's defaults so the migration to per-agency email is non-breaking.
update vb.agencies
   set from_email = coalesce(from_email, 'noreply@macaws.ai'),
       from_name  = coalesce(from_name,  'Macaws')
 where slug = 'macaws';
