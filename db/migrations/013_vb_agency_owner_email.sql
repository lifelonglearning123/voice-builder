-- Migration 013: pre-designated agency owner email
--
-- Onboarding a new agency used to need a second manual SQL step: the owner
-- signed up on their custom domain, landed as an auto-provisioned *client*
-- (post-signin route), then waited for the operator to promote them to
-- 'owner' in vb.agency_members. This column removes the wait. The operator
-- sets owner_email in the same INSERT that creates the agency row; when a
-- user whose magic-link-verified email matches it signs in, post-signin
-- provisions (or upgrades) them straight to role 'owner'.
--
-- Trust boundary is unchanged: only the operator can set owner_email, and
-- magic-link sign-in already proves the user controls that address.

alter table vb.agencies
  add column if not exists owner_email text;
