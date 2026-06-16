-- Migration 009: capture SMB client name + phone at signup
--
-- Up to now signup only collected an email. Agencies need at least a name
-- and phone to actually contact a new client — without them every fresh
-- signup row shows up as an opaque email address with no human attached.
--
-- Schema-wise we add two nullable text columns to vb.agency_clients. Phone
-- is intentionally free-form text (E.164 strings, formatted national
-- numbers, etc. — agencies operate across jurisdictions and we don't want
-- to bounce a valid number because of formatting). Validation happens at
-- the form layer.
--
-- Nullable so existing rows aren't broken; new signups always populate
-- both via /api/auth/post-signin.

alter table vb.agency_clients
  add column if not exists full_name text,
  add column if not exists phone text;
